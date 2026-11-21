// Solara Bay — the game itself: the loop, the player on foot and in cars,
// traffic and police AI, the wanted level, combat, pickups, the save, and
// the deterministic screenshot staging the ?shot= modes use.
import {
  CAR_LENGTH, CAR_WIDTH, CASH_PICKUP_VALUE, MAX_WANTED, PALETTE, PLAYER_HEALTH,
  PLAYER_RADIUS, ROAD_COUNT, SAND_TOP, STEP, VIEW_H, VIEW_W, WALK_SPEED,
  WANTED_DECAY_SECONDS, WORLD_H, WORLD_W, roadCenter,
} from './config.js';
import { angleDiff, clamp, dist2, makeRng } from './random.js';
import { findRoute, lanePoint, nearestNode, nodeXY, onRoad, roadDistance, snapToRoad } from './nav.js';
import {
  buildCity, circleHitsRect, makeCar, resolveBuildingCollision, spawnParked,
  spawnPedestrians, spawnPickups, spawnTraffic,
} from './world.js';
import {
  MISSION_TYPES, payoutFor, startMission, updateMission, jobMarkerPos,
} from './missions.js';
import {
  ensureAudio, isMuted, playCrash, playFail, playHorn, playJingle, playPickup,
  playPunch, toggleMute, updateAudio,
} from './audio.js';
import { bindInput, endFrame, isDown, wasPressed } from './input.js';
import { drawGameOver, drawHUD, drawPause, drawTitle, drawWorld } from './render.js';
import { stageShot } from './shots.js';

const SAVE_KEY = 'solara-bay-save-v1';

export function loadSave() {
  try {
    const raw = window.localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const save = JSON.parse(raw);
    if (typeof save.cash !== 'number') return null;
    return { cash: save.cash, jobs: save.jobs || 0, bestHaul: save.bestHaul || 0 };
  } catch {
    return null;
  }
}

export function writeSave(game) {
  try {
    window.localStorage.setItem(SAVE_KEY, JSON.stringify({
      cash: game.cash,
      jobs: game.stats.jobs,
      bestHaul: game.stats.bestHaul,
    }));
  } catch {
    // Storage may be unavailable; the game plays on without it.
  }
}

export function createGame(seed) {
  const rng = makeRng(seed);
  const city = buildCity(seed);
  const jobPos = jobMarkerPos(city);
  const game = {
    seed,
    rng,
    city,
    jobPos,
    traffic: spawnTraffic(seed),
    parked: spawnParked(seed, city.buildings),
    police: [],
    peds: spawnPedestrians(seed),
    pickups: spawnPickups(seed),
    beachProps: [],
    particles: [],
    player: {
      x: city.plaza.x,
      y: city.plaza.y + 90,
      angle: -Math.PI / 2,
      health: PLAYER_HEALTH,
      car: null,
      punchCooldown: 0,
      carHitCooldown: 0,
      bustedTimer: 0,
    },
    wanted: 0,
    heatTimer: 0,
    cash: 0,
    mission: null,
    missionIndex: 0,
    stats: { jobs: 0, bestHaul: 0 },
    save: null,
    screen: 'title',
    overKind: null,
    toast: null,
    toastTimer: 0,
    hintText: '',
    muted: false,
    time: 0,
    auto: null, // Shots set this: {up,down,left,right,enter,punch}
    shotName: null,
  };
  for (let i = 0; i < 12; i += 1) {
    game.beachProps.push({
      x: rng.range(80, WORLD_W - 80),
      y: rng.range(SAND_TOP + 30, 3500),
      color: rng.pick(['#ff6b6b', '#ffd23d', '#4fb3d9', '#ff9d00']),
    });
  }
  const save = loadSave();
  if (save) {
    game.save = save;
    game.cash = save.cash;
    game.stats.jobs = save.jobs;
    game.stats.bestHaul = save.bestHaul;
  }
  return game;
}

function setToast(game, text, seconds = 3) {
  game.toast = text;
  game.toastTimer = seconds;
}

function spawnParticles(game, x, y, n, color) {
  for (let i = 0; i < n; i += 1) {
    const a = game.rng.range(0, Math.PI * 2);
    const s = game.rng.range(40, 180);
    game.particles.push({
      x, y,
      vx: Math.cos(a) * s,
      vy: Math.sin(a) * s,
      life: game.rng.range(0.3, 0.7),
      maxLife: 0.7,
      size: game.rng.range(2, 5),
      color,
    });
  }
  if (game.particles.length > 240) game.particles.splice(0, game.particles.length - 240);
}

export function addWanted(game, n) {
  if (n <= 0) return;
  game.wanted = Math.min(MAX_WANTED, game.wanted + n);
  game.heatTimer = 0;
  if (game.wanted >= 1 && game.police.length === 0) {
    setToast(game, 'The Bay PD is on you — lose them or lie low!');
  }
}

function readControls(game) {
  if (game.auto) {
    return {
      up: !!game.auto.up,
      down: !!game.auto.down,
      left: !!game.auto.left,
      right: !!game.auto.right,
      enter: !!game.auto.enter,
      punch: !!game.auto.punch,
    };
  }
  return {
    up: isDown('up'),
    down: isDown('down'),
    left: isDown('left'),
    right: isDown('right'),
    enter: wasPressed('enter'),
    punch: isDown('punch'),
  };
}

// ------------------------------------------------------------ driving ----

function nearestEnterableCar(game, x, y, maxD) {
  let best = null;
  let bestD = maxD;
  const consider = (car) => {
    if (car.kind === 'police' || car.wrecked) return;
    const d = Math.hypot(car.x - x, car.y - y);
    if (d < bestD) {
      bestD = d;
      best = car;
    }
  };
  for (const car of game.parked) consider(car);
  for (const car of game.traffic) {
    if (Math.abs(car.speed) < 60) consider(car);
  }
  return best;
}

function enterCar(game, car) {
  const list = game.parked.includes(car) ? game.parked : game.traffic;
  const idx = list.indexOf(car);
  if (idx !== -1) list.splice(idx, 1);
  car.kind = 'player';
  game.player.car = car;
  game.player.x = car.x;
  game.player.y = car.y;
  addWanted(game, 1);
  setToast(game, 'Nice ride. That one was somebody else’s.');
  playHorn();
}

function exitCar(game) {
  const car = game.player.car;
  if (!car) return;
  car.speed = 0;
  car.kind = 'parked';
  const side = { x: car.x + Math.cos(car.angle + Math.PI / 2) * 34, y: car.y + Math.sin(car.angle + Math.PI / 2) * 34 };
  game.parked.push(car);
  game.player.car = null;
  game.player.x = side.x;
  game.player.y = side.y;
  game.player.angle = car.angle;
}

function stepCarPhysics(game, car, ctl, dt) {
  const handbrake = ctl.punch;
  if (ctl.up) car.speed += car.accel * dt;
  if (ctl.down) car.speed -= (car.speed > 0 ? 520 : 300) * dt;
  if (!ctl.up && !ctl.down) car.speed -= car.speed * 1.1 * dt;
  if (handbrake) car.speed -= car.speed * 4.5 * dt;
  const maxF = car.maxSpeed;
  const maxR = -170;
  car.speed = clamp(car.speed, maxR, maxF);
  if (Math.abs(car.speed) < 4 && !ctl.up && !ctl.down) car.speed = 0;
  const steer = (ctl.left ? -1 : 0) + (ctl.right ? 1 : 0);
  const grip = handbrake ? 1.7 : 1;
  // The nose can always swing a little, even from a standstill, so a driver
  // (or the autopilot) never gets stuck facing the wrong way with no throttle.
  const turnRate = 2.3 * grip * clamp(Math.abs(car.speed) / 140, 0.35, 1);
  car.angle += steer * turnRate * dt * (car.speed >= 0 ? 1 : -1);
  const prevX = car.x;
  const prevY = car.y;
  car.x += Math.cos(car.angle) * car.speed * dt;
  car.y += Math.sin(car.angle) * car.speed * dt;
  if (car === game.player.car) {
    game.player.x = car.x;
    game.player.y = car.y;
  }
  car.x = clamp(car.x, 30, WORLD_W - 30);
  car.y = clamp(car.y, 30, WORLD_H - 30);
  // Buildings stop cars hard. The collision probe is pushed back out to the
  // nearest legal spot, so a shove from another car can never leave a car
  // sitting on a roof.
  const speedBefore = car.speed;
  const probe = { x: car.x, y: car.y };
  const hitWall = resolveBuildingCollision(probe, CAR_LENGTH / 2 - 4, game.city.buildings);
  if (hitWall) {
    car.x = probe.x;
    car.y = probe.y;
    if (Math.abs(speedBefore) > 120) {
      car.health -= Math.abs(speedBefore) * 0.06;
      spawnParticles(game, car.x, car.y, 10, '#ffb400');
      if (car === game.player.car) playCrash(Math.abs(speedBefore) / 400);
    }
    car.speed *= -0.22;
  }
  if (car.health <= 0 && !car.wrecked) {
    car.wrecked = true;
    car.speed = 0;
    spawnParticles(game, car.x, car.y, 24, '#666666');
    if (car === game.player.car) {
      gameOver(game, 'wrecked');
    }
  }
}

function stepPlayerOnFoot(game, ctl, dt) {
  const p = game.player;
  const mx = (ctl.right ? 1 : 0) - (ctl.left ? 1 : 0);
  const my = (ctl.down ? 1 : 0) - (ctl.up ? 1 : 0);
  if (mx !== 0 || my !== 0) {
    const len = Math.hypot(mx, my);
    p.angle = Math.atan2(my / len, mx / len);
    p.x += (mx / len) * WALK_SPEED * dt;
    p.y += (my / len) * WALK_SPEED * dt;
  }
  p.x = clamp(p.x, 20, WORLD_W - 20);
  p.y = clamp(p.y, 20, WORLD_H - 20);
  resolveBuildingCollision(p, PLAYER_RADIUS, game.city.buildings);
  p.punchCooldown = Math.max(0, p.punchCooldown - dt);
  if (ctl.punch && p.punchCooldown <= 0) {
    p.punchCooldown = 0.45;
    punch(game);
  }
}

function punch(game) {
  const p = game.player;
  const fx = p.x + Math.cos(p.angle) * 30;
  const fy = p.y + Math.sin(p.angle) * 30;
  playPunch();
  spawnParticles(game, fx, fy, 6, '#ffffff');
  let hitSomething = false;
  for (const ped of game.peds) {
    if (Math.hypot(ped.x - fx, ped.y - fy) < 42) {
      ped.state = 'flee';
      ped.fleeX = ped.x - p.x;
      ped.fleeY = ped.y - p.y;
      hitSomething = true;
    }
  }
  for (const car of [...game.parked, ...game.traffic]) {
    if (Math.hypot(car.x - fx, car.y - fy) < 46) {
      car.health -= 10;
      spawnParticles(game, car.x, car.y, 8, '#9fb3c8');
      hitSomething = true;
    }
  }
  if (hitSomething) addWanted(game, 1);
}

// ------------------------------------------------------------- traffic ----

function stepTrafficCar(game, car, dt) {
  if (car.wrecked) return;
  if (car.wait > 0) {
    car.wait -= dt;
    return;
  }
  if (!car.route || car.routeIndex >= car.route.length) {
    const from = nearestNode(car.x, car.y);
    const to = game.rng.int(0, ROAD_COUNT * ROAD_COUNT - 1);
    car.route = findRoute(from, to);
    car.routeIndex = 1;
  }
  const targetNode = car.route[car.routeIndex];
  const node = nodeXY(targetNode);
  const prevNode = nodeXY(car.route[car.routeIndex - 1]);
  const lane = lanePoint(prevNode.x, prevNode.y, node.x, node.y);
  const dx = lane.x - car.x;
  const dy = lane.y - car.y;
  const d = Math.hypot(dx, dy);
  // Move on once the car reaches the lane point or has passed it along the
  // segment, so it never circles a point it overshot.
  const segDx = node.x - prevNode.x;
  const segDy = node.y - prevNode.y;
  const segLen = Math.hypot(segDx, segDy) || 1;
  const along = ((car.x - lane.x) * segDx + (car.y - lane.y) * segDy) / segLen;
  if (d < 26 || along > 0) {
    car.routeIndex += 1;
    return;
  }
  const desired = Math.atan2(dy, dx);
  const diff = angleDiff(car.angle, desired);
  car.angle += clamp(diff, -2.4 * dt, 2.4 * dt);
  // Slow for the car ahead.
  let targetSpeed = car.maxSpeed * 0.75;
  for (const other of [...game.traffic, ...game.parked, ...game.police]) {
    if (other === car || other.wrecked) continue;
    const ox = other.x - car.x;
    const oy = other.y - car.y;
    const ahead = ox * Math.cos(car.angle) + oy * Math.sin(car.angle);
    const side = Math.abs(-ox * Math.sin(car.angle) + oy * Math.cos(car.angle));
    if (ahead > 0 && ahead < 78 && side < 30) {
      targetSpeed = Math.min(targetSpeed, Math.max(0, other.speed - 40));
    }
  }
  if (game.player.car && game.player.car !== car) {
    const pc = game.player.car;
    const ox = pc.x - car.x;
    const oy = pc.y - car.y;
    const ahead = ox * Math.cos(car.angle) + oy * Math.sin(car.angle);
    const side = Math.abs(-ox * Math.sin(car.angle) + oy * Math.cos(car.angle));
    if (ahead > 0 && ahead < 78 && side < 30) targetSpeed = Math.min(targetSpeed, Math.max(0, pc.speed - 40));
  }
  car.speed += clamp(targetSpeed - car.speed, -420 * dt, 300 * dt);
  car.x += Math.cos(car.angle) * car.speed * dt;
  car.y += Math.sin(car.angle) * car.speed * dt;
  const probe = { x: car.x, y: car.y };
  if (resolveBuildingCollision(probe, CAR_LENGTH / 2 - 4, game.city.buildings)) {
    car.x = probe.x;
    car.y = probe.y;
    car.speed *= -0.2;
    car.routeIndex += 1;
  }
}

function stepPedestrian(game, ped, dt) {
  if (ped.state === 'flee') {
    const len = Math.hypot(ped.fleeX, ped.fleeY) || 1;
    ped.angle = Math.atan2(ped.fleeY / len, ped.fleeX / len);
    ped.x += Math.cos(ped.angle) * 150 * dt;
    ped.y += Math.sin(ped.angle) * 150 * dt;
    ped.x = clamp(ped.x, 20, WORLD_W - 20);
    ped.y = clamp(ped.y, 20, WORLD_H - 20);
    resolveBuildingCollision(ped, 8, game.city.buildings);
    if (game.rng.chance(dt * 0.5)) ped.state = 'walk';
    return;
  }
  // Walk toward a nearby sidewalk point; pick a new one on arrival.
  if (!ped.target || Math.hypot(ped.target.x - ped.x, ped.target.y - ped.y) < 24) {
    const near = nearestNode(ped.x, ped.y);
    const n = nodeXY(near);
    ped.target = {
      x: clamp(n.x + game.rng.range(-220, 220), 30, WORLD_W - 30),
      y: clamp(n.y + game.rng.range(-220, 220), 30, WORLD_H - 30),
    };
  }
  const dx = ped.target.x - ped.x;
  const dy = ped.target.y - ped.y;
  const d = Math.hypot(dx, dy) || 1;
  ped.angle = Math.atan2(dy, dx);
  ped.x += (dx / d) * ped.speed * dt;
  ped.y += (dy / d) * ped.speed * dt;
  ped.x = clamp(ped.x, 20, WORLD_W - 20);
  ped.y = clamp(ped.y, 20, WORLD_H - 20);
  resolveBuildingCollision(ped, 8, game.city.buildings);
  // Flee a fast car bearing down on them.
  const pc = game.player.car;
  if (pc && Math.abs(pc.speed) > 120) {
    const dd = Math.hypot(ped.x - pc.x, ped.y - pc.y);
    if (dd < 130) {
      ped.state = 'flee';
      ped.fleeX = ped.x - pc.x;
      ped.fleeY = ped.y - pc.y;
    }
  }
}

// -------------------------------------------------------------- police ----

function syncPolice(game) {
  const want = game.wanted;
  while (game.police.length < want) {
    const p = game.player;
    const px = p.car ? p.car.x : p.x;
    const py = p.car ? p.car.y : p.y;
    let node = game.rng.int(0, ROAD_COUNT * ROAD_COUNT - 1);
    let pos = nodeXY(node);
    let guard = 0;
    while (Math.hypot(pos.x - px, pos.y - py) < 650 && guard < 20) {
      guard += 1;
      node = game.rng.int(0, ROAD_COUNT * ROAD_COUNT - 1);
      pos = nodeXY(node);
    }
    const cruiser = makeCar(game.rng, pos.x, pos.y, 0, {
      kind: 'police', color: PALETTE.police, maxSpeed: 470, state: 'pursue',
    });
    cruiser.route = [];
    cruiser.routeIndex = 0;
    cruiser.routeTimer = 0;
    game.police.push(cruiser);
  }
  while (game.police.length > want) {
    // Drop the cruiser farthest from the player.
    const p = game.player;
    const px = p.car ? p.car.x : p.x;
    const py = p.car ? p.car.y : p.y;
    let far = 0;
    let farD = -1;
    game.police.forEach((c, i) => {
      const d = dist2(c.x, c.y, px, py);
      if (d > farD) {
        farD = d;
        far = i;
      }
    });
    game.police.splice(far, 1);
  }
}

function stepPoliceCar(game, car, dt) {
  const p = game.player;
  const px = p.car ? p.car.x : p.x;
  const py = p.car ? p.car.y : p.y;
  car.ramCooldown = Math.max(0, car.ramCooldown - dt);
  car.backoff = Math.max(0, car.backoff - dt);
  const distToPlayer = Math.hypot(px - car.x, py - car.y);

  if (car.backoff > 0) {
    // Reverse away after a ram, then come back for more.
    car.speed = Math.max(car.speed - 500 * dt, -160);
    car.x += Math.cos(car.angle) * car.speed * dt;
    car.y += Math.sin(car.angle) * car.speed * dt;
    return;
  }

  if (!p.car) {
    // On foot: a cruiser that pulls up alongside starts the bust. The timer
    // itself is advanced once per step in stepGame, so several cruisers
    // cannot cancel each other out.
    if (distToPlayer < 52) {
      car.speed = 0;
      game.bustedNear = true;
      return;
    }
  } else if (Math.abs(p.car.speed) < 12 && distToPlayer < 70) {
    // Boxed in while barely moving: the bust closes in too.
    game.bustedNear = true;
  }

  // Route toward the player's nearest intersection, refreshed each second.
  car.routeTimer = (car.routeTimer || 0) - dt;
  if (car.routeTimer <= 0 || !car.route || car.routeIndex >= car.route.length) {
    car.routeTimer = 1;
    const from = nearestNode(car.x, car.y);
    const to = nearestNode(px, py);
    car.route = findRoute(from, to);
    car.routeIndex = 1;
  }
  let target;
  if (roadDistance(car.x, car.y) > 55) {
    // A cruiser that got shoved off the asphalt heads back to the nearest
    // road first instead of ploughing through a block after the player.
    target = snapToRoad(car.x, car.y);
  } else if (distToPlayer < 130 || car.routeIndex >= car.route.length) {
    target = { x: px, y: py };
  } else {
    const node = nodeXY(car.route[car.routeIndex]);
    const prev = nodeXY(car.route[car.routeIndex - 1]);
    target = lanePoint(prev.x, prev.y, node.x, node.y);
    if (Math.hypot(node.x - car.x, node.y - car.y) < 40) car.routeIndex += 1;
  }
  const desired = Math.atan2(target.y - car.y, target.x - car.x);
  const diff = angleDiff(car.angle, desired);
  car.angle += clamp(diff, -2.8 * dt, 2.8 * dt);
  const targetSpeed = distToPlayer > 500 ? car.maxSpeed : Math.min(car.maxSpeed, 300 + distToPlayer * 0.4);
  car.speed += clamp(targetSpeed - car.speed, -520 * dt, 380 * dt);
  car.x += Math.cos(car.angle) * car.speed * dt;
  car.y += Math.sin(car.angle) * car.speed * dt;
  const probe = { x: car.x, y: car.y };
  if (resolveBuildingCollision(probe, CAR_LENGTH / 2 - 4, game.city.buildings)) {
    car.x = probe.x;
    car.y = probe.y;
    car.speed *= -0.2;
  }
  // Ram the player's car on contact, then back off.
  if (p.car && distToPlayer < 56 && car.ramCooldown <= 0) {
    car.ramCooldown = 2;
    car.backoff = 1.1;
    p.car.health -= 12;
    p.car.speed *= 0.55;
    const push = Math.atan2(p.car.y - car.y, p.car.x - car.x);
    p.car.x += Math.cos(push) * 26;
    p.car.y += Math.sin(push) * 26;
    spawnParticles(game, p.car.x, p.car.y, 12, '#ffb400');
    playCrash(0.7);
    if (p.car.health <= 0 && !p.car.wrecked) {
      p.car.wrecked = true;
      gameOver(game, 'wrecked');
    }
  }
}

// ------------------------------------------------------------ collisions ----

function stepCarCollisions(game, dt) {
  const all = [...game.traffic, ...game.parked, ...game.police];
  if (game.player.car) all.push(game.player.car);
  for (let i = 0; i < all.length; i += 1) {
    for (let j = i + 1; j < all.length; j += 1) {
      const a = all[i];
      const b = all[j];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const d = Math.hypot(dx, dy);
      if (d >= 42 || d === 0) continue;
      const push = (42 - d) / 2;
      const nx = dx / d;
      const ny = dy / d;
      a.x -= nx * push;
      a.y -= ny * push;
      b.x += nx * push;
      b.y += ny * push;
      const closing = Math.abs(a.speed - b.speed);
      if (closing > 140) {
        a.health -= closing * 0.03;
        b.health -= closing * 0.03;
        if (a === game.player.car || b === game.player.car) {
          playCrash(closing / 500);
          spawnParticles(game, (a.x + b.x) / 2, (a.y + b.y) / 2, 8, '#ffb400');
        }
        a.speed *= 0.7;
        b.speed *= 0.7;
      }
      if (a.health <= 0 && !a.wrecked) {
        a.wrecked = true;
        a.speed = 0;
        if (a === game.player.car) gameOver(game, 'wrecked');
      }
      if (b.health <= 0 && !b.wrecked) {
        b.wrecked = true;
        b.speed = 0;
        if (b === game.player.car) gameOver(game, 'wrecked');
      }
    }
  }
  // The player's car vs pedestrians: a hit at speed is a crime.
  const pc = game.player.car;
  const p = game.player;
  if (pc && Math.abs(pc.speed) > 70) {
    for (const ped of game.peds) {
      if (ped.hitCooldown > 0) continue;
      if (Math.hypot(ped.x - pc.x, ped.y - pc.y) < 30) {
        ped.hitCooldown = 5;
        ped.state = 'flee';
        ped.fleeX = ped.x - pc.x;
        ped.fleeY = ped.y - pc.y;
        addWanted(game, 1);
        spawnParticles(game, ped.x, ped.y, 8, '#ff5252');
      }
    }
  }
  // Any fast car vs the player on foot hurts.
  if (!pc) {
    p.carHitCooldown = Math.max(0, p.carHitCooldown - dt);
    for (const car of [...game.traffic, ...game.police]) {
      if (Math.abs(car.speed) < 60) continue;
      if (Math.hypot(car.x - p.x, car.y - p.y) < 30 && p.carHitCooldown <= 0) {
        p.carHitCooldown = 1;
        p.health -= 22;
        const push = Math.atan2(p.y - car.y, p.x - car.x);
        p.x += Math.cos(push) * 40;
        p.y += Math.sin(push) * 40;
        spawnParticles(game, p.x, p.y, 10, '#ff5252');
        playCrash(0.5);
        if (p.health <= 0) gameOver(game, 'down');
      }
    }
  }
  for (const ped of game.peds) ped.hitCooldown = Math.max(0, (ped.hitCooldown || 0) - dt);
}

// -------------------------------------------------------------- missions ----

function maybeStartMission(game) {
  if (game.mission) return;
  const p = game.player;
  const px = p.car ? p.car.x : p.x;
  const py = p.car ? p.car.y : p.y;
  if (Math.hypot(px - game.jobPos.x, py - game.jobPos.y) > 80) return;
  const type = MISSION_TYPES[game.missionIndex % MISSION_TYPES.length];
  const round = game.stats.jobs + 1;
  const mission = startMission(type, round, game.rng, { x: px, y: py });
  if (type === 'hotwheels') {
    // The marked car waits at the target, gold and fast.
    const car = makeCar(game.rng, mission.target.x, mission.target.y, 0, {
      kind: 'target', color: '#ffd23d', maxSpeed: 540,
    });
    game.parked.push(car);
    mission.car = car;
  }
  if (type === 'hotwheels') addWanted(game, 1);
  game.mission = mission;
  setToast(game, `${mission.title} — ${mission.brief}`, 4);
  playHorn();
}

function finishMission(game, event) {
  const m = game.mission;
  if (!m) return;
  if (event === 'complete') {
    const total = m.payout + (m.tip || 0);
    game.cash += total;
    game.stats.jobs += 1;
    game.stats.bestHaul = Math.max(game.stats.bestHaul, total);
    setToast(game, `${m.title} complete! +$${total}${m.tip ? ` (tip $${m.tip})` : ''}`, 4);
    playJingle();
    writeSave(game);
  } else {
    const reason = event === 'timeout' ? 'Time ran out' : 'Job blown';
    setToast(game, `${m.title} failed — ${reason}. Rico will call again.`, 4);
    playFail();
  }
  game.missionIndex += 1;
  game.mission = null;
}

// --------------------------------------------------------------- game over ----

function gameOver(game, kind) {
  if (game.screen === 'over') return;
  game.screen = 'over';
  game.overKind = kind;
  writeSave(game);
  playFail();
}

// ------------------------------------------------------------------ step ----

export function stepGame(game, dt) {
  game.time += dt;
  if (game.toastTimer > 0) {
    game.toastTimer -= dt;
    if (game.toastTimer <= 0) game.toast = null;
  }
  for (const pt of game.particles) {
    pt.x += pt.vx * dt;
    pt.y += pt.vy * dt;
    pt.life -= dt;
  }
  game.particles = game.particles.filter((pt) => pt.life > 0);

  if (game.screen === 'title' || game.screen === 'pause') {
    // The city idles behind the menu.
    for (const car of game.traffic) stepTrafficCar(game, car, dt);
    for (const ped of game.peds) stepPedestrian(game, ped, dt);
    return;
  }
  if (game.screen !== 'play') return;

  const ctl = readControls(game);
  const p = game.player;

  if (ctl.enter) {
    if (p.car) {
      exitCar(game);
    } else {
      const car = nearestEnterableCar(game, p.x, p.y, 64);
      if (car) {
        enterCar(game, car);
      } else {
        maybeStartMission(game);
      }
    }
  }

  if (p.car) stepCarPhysics(game, p.car, ctl, dt);
  else stepPlayerOnFoot(game, ctl, dt);

  for (const car of game.traffic) stepTrafficCar(game, car, dt);
  for (const ped of game.peds) stepPedestrian(game, ped, dt);
  syncPolice(game);
  game.bustedNear = false;
  for (const car of game.police) stepPoliceCar(game, car, dt);
  // The bust timer advances once per step, however many cruisers are near.
  if (game.bustedNear) {
    p.bustedTimer += dt;
    const limit = p.car ? 3 : 1.5;
    if (p.bustedTimer >= limit) gameOver(game, 'busted');
  } else {
    p.bustedTimer = Math.max(0, p.bustedTimer - dt * 2);
  }
  stepCarCollisions(game, dt);

  // Cash pickups.
  const px = p.car ? p.car.x : p.x;
  const py = p.car ? p.car.y : p.y;
  for (const pk of game.pickups) {
    if (pk.taken) continue;
    if (Math.hypot(pk.x - px, pk.y - py) < 34) {
      pk.taken = true;
      game.cash += CASH_PICKUP_VALUE;
      setToast(game, `Found $${CASH_PICKUP_VALUE} in loose bills!`, 2);
      playPickup();
      spawnParticles(game, pk.x, pk.y, 10, '#7de07d');
    }
  }

  // Mission progress.
  if (game.mission) {
    const event = updateMission(game.mission, game, dt);
    if (event === 'complete' || event === 'timeout') finishMission(game, event);
    else if (event === 'stolen') {
      addWanted(game, 1);
      setToast(game, 'It’s hot now — get it to the garage!', 3);
    } else if (event === 'picked') {
      setToast(game, game.mission.type === 'fare' ? 'Passenger aboard — drive smooth!' : 'Package secured — go!', 3);
      playPickup();
    }
  }

  // Wanted decays when Sol keeps her nose clean and the cops lose her.
  if (game.wanted > 0) {
    game.heatTimer += dt;
    const nearCop = game.police.some((c) => Math.hypot(c.x - px, c.y - py) < 500);
    if (game.heatTimer > WANTED_DECAY_SECONDS && !nearCop) {
      game.wanted -= 1;
      game.heatTimer = 0;
      if (game.wanted === 0) setToast(game, 'Heat’s off. For now.', 2);
    }
  } else {
    game.heatTimer = 0;
  }

  // Player health regen, slowly, out of trouble.
  if (!p.car && p.health < PLAYER_HEALTH && game.wanted === 0) {
    p.health = Math.min(PLAYER_HEALTH, p.health + 2 * dt);
  }

  updateHint(game);
  updateAudio(dt, p.car ? p.car.speed : 0, game.wanted, !!p.car);
}

function updateHint(game) {
  const p = game.player;
  if (p.car) {
    game.hintText = 'WASD drive • SPACE handbrake • E get out • P pause • M mute';
    return;
  }
  const nearCar = nearestEnterableCar(game, p.x, p.y, 64);
  if (nearCar) {
    game.hintText = 'E — take the car (it’s a steal: +★) • SPACE — punch';
    return;
  }
  if (!game.mission && Math.hypot(p.x - game.jobPos.x, p.y - game.jobPos.y) < 80) {
    game.hintText = 'E — take a job from Rico Delgado';
    return;
  }
  if (game.mission) {
    game.hintText = 'Follow the gold arrow • E — enter a car • SPACE — punch';
    return;
  }
  game.hintText = 'WASD move • E enter car / take job • SPACE punch • P pause • M mute';
}

// ------------------------------------------------------------------ boot ----

export function startPlaying(game) {
  game.screen = 'play';
  ensureAudio();
  playHorn();
}

export function boot() {
  const params = new URLSearchParams(window.location.search);
  const shot = params.get('shot');
  const seed = Number(params.get('seed') || 7);
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  const game = createGame(seed);
  game.muted = isMuted();

  const loop = () => {
    if (game.screen === 'play' && wasPressed('pause')) {
      game.screen = 'pause';
    } else if (game.screen === 'pause' && wasPressed('pause')) {
      game.screen = 'play';
    }
    if (wasPressed('mute')) {
      game.muted = toggleMute();
    }
    if (game.screen === 'title' && wasPressed('start')) startPlaying(game);
    else if (game.screen === 'over' && wasPressed('start')) {
      const fresh = createGame(game.seed);
      Object.assign(game, fresh);
      game.screen = 'play';
    }
    stepGame(game, STEP);
    drawWorld(ctx, game);
    if (game.screen === 'title') drawTitle(ctx, game);
    else if (game.screen === 'pause') drawPause(ctx, game);
    else if (game.screen === 'over') drawGameOver(ctx, game);
    else drawHUD(ctx, game);
    endFrame();
    requestAnimationFrame(loop);
  };

  bindInput(canvas, () => {
    ensureAudio();
    if (game.screen === 'title') startPlaying(game);
    else if (game.screen === 'pause') game.screen = 'play';
    else if (game.screen === 'over') {
      const fresh = createGame(game.seed);
      Object.assign(game, fresh);
      game.screen = 'play';
    }
  });

  if (shot) {
    // Deterministic screenshot mode: stage the scene, draw one frame, stop.
    game.shotName = shot;
    stageShot(shot, game);
    drawWorld(ctx, game);
    if (game.screen === 'title') drawTitle(ctx, game);
    else if (game.screen === 'over') drawGameOver(ctx, game);
    else drawHUD(ctx, game);
    window.__solaraReady = true;
    window.__solara = { game, screen: game.screen, shot };
    return game;
  }

  window.__solara = { game };
  requestAnimationFrame(loop);
  return game;
}

boot();
