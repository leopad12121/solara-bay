// Solara Bay — deterministic screenshot scenes behind ?shot=start|drive|chase|mission.
// Each one plays the real rules forward from a fresh world for a fixed number
// of steps, steered by a simple road-following autopilot, so the frame is what
// a short game really looks like and the same seed always gives the same frame.
import { CAR_LENGTH, PALETTE, ROAD_COUNT, STEP } from './config.js';
import { angleDiff } from './random.js';
import { findRoute, lanePoint, nearestNode, nodeXY } from './nav.js';
import { makeCar } from './world.js';
import { startMission } from './missions.js';
import { addWanted, stepGame } from './main.js';

const START_SECONDS = 5;
const DRIVE_SECONDS = 10;
const CHASE_SECONDS = 6;
const MISSION_SECONDS = 8;

/** Pick a fresh route for the autopilot from the car's nearest intersection. */
function newRoute(game, toNode) {
  const car = game.player.car;
  const from = nearestNode(car.x, car.y);
  const to = toNode === undefined ? game.rng.int(0, ROAD_COUNT * ROAD_COUNT - 1) : toNode;
  game.autoRoute = findRoute(from, to);
  game.autoIndex = 1;
}

/**
 * Steer the player's car along the road graph toward a node, or straight at a
 * close objective. Writes into game.auto, which the game reads as controls.
 * The car follows the lane point of its current segment and moves on to the
 * next segment once it has passed that point, so it never circles the point.
 * If it gets wedged against a building it backs out and tries again.
 */
function autopilotDrive(game, directTarget) {
  const car = game.player.car;
  const auto = { up: false, down: false, left: false, right: false, enter: false, punch: false };
  game.auto = auto;
  if (!car) return;
  let tx;
  let ty;
  if (directTarget && Math.hypot(directTarget.x - car.x, directTarget.y - car.y) < 260) {
    // Aim a little beyond the target so the car drives through it.
    const dx = directTarget.x - car.x;
    const dy = directTarget.y - car.y;
    const len = Math.hypot(dx, dy) || 1;
    tx = directTarget.x + (dx / len) * 50;
    ty = directTarget.y + (dy / len) * 50;
  } else {
    // With a mission running, the route heads for the objective, not a
    // random corner of the city.
    const missionNode = game.mission && game.mission.target
      ? nearestNode(game.mission.target.x, game.mission.target.y)
      : undefined;
    if (!game.autoRoute || game.autoIndex >= game.autoRoute.length) {
      newRoute(game, missionNode);
    } else if (missionNode !== undefined && game.autoRoute[game.autoRoute.length - 1] !== missionNode) {
      newRoute(game, missionNode);
    }
    for (let guard = 0; guard < 10; guard += 1) {
      if (game.autoIndex >= game.autoRoute.length) {
        newRoute(game, missionNode);
        continue;
      }
      const node = nodeXY(game.autoRoute[game.autoIndex]);
      const prev = nodeXY(game.autoRoute[game.autoIndex - 1]);
      const lane = lanePoint(prev.x, prev.y, node.x, node.y);
      const segDx = node.x - prev.x;
      const segDy = node.y - prev.y;
      const segLen = Math.hypot(segDx, segDy) || 1;
      const along = ((car.x - lane.x) * segDx + (car.y - lane.y) * segDy) / segLen;
      const distToNode = Math.hypot(node.x - car.x, node.y - car.y);
      if (along > 0 || distToNode < 70) {
        game.autoIndex += 1;
        continue;
      }
      tx = lane.x;
      ty = lane.y;
      break;
    }
    if (tx === undefined) {
      tx = car.x + Math.cos(car.angle) * 100;
      ty = car.y + Math.sin(car.angle) * 100;
    }
  }
  const desired = Math.atan2(ty - car.y, tx - car.x);
  const diff = angleDiff(car.angle, desired);
  auto.left = diff < -0.1;
  auto.right = diff > 0.1;
  // Only feed power once the nose is roughly lined up; otherwise the car
  // pivots on the spot (the throttle turn floor lets it swing) instead of
  // charging off the road into a block. Brake for sharp corners at speed:
  // a 90-degree turn at full speed swings far too wide for these streets.
  // And coast when traffic is right ahead, rather than ramming through it.
  const speed = Math.abs(car.speed);
  const needBrake = speed > 200 && Math.abs(diff) > 0.6;
  let blocked = false;
  for (const other of [...game.traffic, ...game.police]) {
    if (other.wrecked) continue;
    const ox = other.x - car.x;
    const oy = other.y - car.y;
    const ahead = ox * Math.cos(car.angle) + oy * Math.sin(car.angle);
    const side = Math.abs(-ox * Math.sin(car.angle) + oy * Math.cos(car.angle));
    if (ahead > 0 && ahead < 190 && side < 34) {
      blocked = true;
      break;
    }
  }
  auto.up = Math.abs(diff) < 1.0 && !needBrake && !blocked;
  auto.down = needBrake;
  // Wedged against something with the throttle down and no speed: back out.
  if (game.autoReverse > 0) {
    game.autoReverse -= STEP;
    auto.up = false;
    auto.down = true;
  } else if (speed < 25 && auto.up) {
    game.autoStuck = (game.autoStuck || 0) + STEP;
    if (game.autoStuck > 1.0) {
      game.autoReverse = 0.9;
      game.autoStuck = 0;
    }
  } else {
    game.autoStuck = 0;
  }
}

/** Put the player in a fast car on a road, ready to drive. */
function giveCar(game, maxSpeed) {
  const car = game.parked[0];
  game.parked.splice(0, 1);
  car.kind = 'player';
  car.maxSpeed = maxSpeed;
  car.health = 200;
  game.player.car = car;
  game.player.x = car.x;
  game.player.y = car.y;
  newRoute(game);
}

function runSteps(game, seconds, drive) {
  const steps = Math.round(seconds / STEP);
  for (let i = 0; i < steps; i += 1) {
    if (drive) {
      const direct = game.mission && game.mission.target ? game.mission.target : null;
      autopilotDrive(game, direct);
    }
    stepGame(game, STEP);
    if (game.screen === 'over') break;
  }
  game.auto = null;
}

/**
 * Set `game` to the named scene (start, drive, chase or mission; any other
 * name is start) and leave it drawn-ready at screen 'title' or 'play'.
 */
export function stageShot(name, game) {
  game.screen = 'play';
  if (name === 'drive') {
    giveCar(game, 420);
    runSteps(game, DRIVE_SECONDS, true);
    return;
  }
  if (name === 'chase') {
    giveCar(game, 540);
    addWanted(game, 3);
    // A rolling start: the getaway is already moving when the cruisers join
    // behind it, so the frame shows a pursuit at speed, not a pile-up.
    game.player.car.speed = 320;
    const p = game.player.car;
    for (let i = 0; i < 3; i += 1) {
      const behind = 300 + i * 130;
      const cruiser = makeCar(game.rng, p.x - Math.cos(p.angle) * behind, p.y - Math.sin(p.angle) * behind, p.angle, {
        kind: 'police', color: PALETTE.police, maxSpeed: 470, state: 'pursue',
      });
      cruiser.route = [];
      cruiser.routeIndex = 0;
      cruiser.routeTimer = 0;
      game.police.push(cruiser);
    }
    runSteps(game, CHASE_SECONDS, true);
    return;
  }
  if (name === 'mission') {
    giveCar(game, 430);
    // Dockside Run: the docks are a long drive from the start, so the shot
    // catches the job mid-flight — banner, timer and objective arrow live.
    const type = 'dockside';
    const mission = startMission(type, 1, game.rng, { x: game.player.car.x, y: game.player.car.y });
    game.mission = mission;
    runSteps(game, MISSION_SECONDS, true);
    return;
  }
  // start: the title screen over a living city.
  game.screen = 'title';
  runSteps(game, START_SECONDS, false);
}
