// Solara Bay — all the drawing: the city from above, the cars and people in
// it, the HUD with its minimap, and the title, pause and game-over screens.
// Everything is flat canvas shapes with a warm coastal palette; nothing is
// loaded from a file.
import {
  CAR_LENGTH, CAR_WIDTH, OCEAN_TOP, PALETTE, PLAYER_RADIUS, ROAD_COUNT, ROAD_W,
  SAND_TOP, VIEW_H, VIEW_W, WORLD_H, WORLD_W, roadCenter,
} from './config.js';
import { clamp } from './random.js';

function rr(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export function cameraFor(game) {
  const p = game.player;
  const cx = p.car ? p.car.x : p.x;
  const cy = p.car ? p.car.y : p.y;
  const zoom = 1;
  const halfW = VIEW_W / 2 / zoom;
  const halfH = VIEW_H / 2 / zoom;
  return {
    x: clamp(cx - halfW, 0, Math.max(0, WORLD_W - VIEW_W / zoom)),
    y: clamp(cy - halfH, 0, Math.max(0, WORLD_H - VIEW_H / zoom)),
    zoom,
  };
}

export function drawWorld(ctx, game) {
  const cam = cameraFor(game);
  ctx.save();
  ctx.translate(-cam.x, -cam.y);
  drawGround(ctx, game, cam);
  drawRoads(ctx, cam);
  drawParks(ctx, game);
  drawBuildings(ctx, game);
  drawPickups(ctx, game);
  drawMissionMarkers(ctx, game);
  drawCars(ctx, game);
  drawPedestrians(ctx, game);
  drawPlayer(ctx, game);
  drawParticles(ctx, game);
  ctx.restore();
  drawObjectiveArrow(ctx, game, cam);
}

function drawGround(ctx, game, cam) {
  const x0 = Math.max(0, cam.x - 40);
  const y0 = Math.max(0, cam.y - 40);
  const x1 = Math.min(WORLD_W, cam.x + VIEW_W + 40);
  const y1 = Math.min(WORLD_H, cam.y + VIEW_H + 40);
  ctx.fillStyle = PALETTE.grass;
  ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
  // Mown stripes on the grass, for texture.
  ctx.fillStyle = PALETTE.grassDark;
  const stripe = 130;
  for (let y = Math.floor(y0 / stripe) * stripe; y < y1; y += stripe * 2) {
    ctx.fillRect(x0, y, x1 - x0, stripe);
  }
  // Beach and ocean along the south edge.
  if (y1 > SAND_TOP) {
    ctx.fillStyle = PALETTE.sand;
    ctx.fillRect(x0, SAND_TOP, x1 - x0, Math.min(y1, OCEAN_TOP) - SAND_TOP);
    // Umbrellas and towels on the sand.
    for (const u of game.beachProps) {
      if (u.x < x0 - 40 || u.x > x1 + 40 || u.y < y0 - 40 || u.y > y1 + 40) continue;
      ctx.fillStyle = u.color;
      ctx.beginPath();
      ctx.arc(u.x, u.y, 12, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#f2f2f2';
      ctx.fillRect(u.x + 14, u.y - 4, 22, 10);
    }
  }
  if (y1 > OCEAN_TOP) {
    ctx.fillStyle = PALETTE.ocean;
    ctx.fillRect(x0, OCEAN_TOP, x1 - x0, Math.min(y1, WORLD_H) - OCEAN_TOP);
    ctx.fillStyle = PALETTE.oceanDeep;
    for (let y = OCEAN_TOP + 60; y < y1; y += 120) {
      ctx.fillRect(x0, y, x1 - x0, 26);
    }
    // Animated wave lines.
    ctx.strokeStyle = PALETTE.waterLine;
    ctx.lineWidth = 3;
    const t = game.time;
    for (let i = 0; i < 3; i += 1) {
      const wy = OCEAN_TOP + 8 + i * 26 + Math.sin(t * 1.4 + i * 2) * 4;
      ctx.beginPath();
      for (let x = x0; x <= x1; x += 60) {
        const yy = wy + Math.sin(x / 90 + t * 1.2 + i) * 3;
        if (x === x0) ctx.moveTo(x, yy);
        else ctx.lineTo(x, yy);
      }
      ctx.stroke();
    }
  }
}

function drawRoads(ctx, cam) {
  const x0 = cam.x - 40;
  const y0 = cam.y - 40;
  const x1 = cam.x + VIEW_W + 40;
  const y1 = cam.y + VIEW_H + 40;
  for (let i = 0; i < ROAD_COUNT; i += 1) {
    const c = roadCenter(i);
    // Vertical road.
    if (c > x0 - ROAD_W && c < x1 + ROAD_W) {
      ctx.fillStyle = PALETTE.asphalt;
      ctx.fillRect(c - ROAD_W / 2, y0, ROAD_W, y1 - y0);
      ctx.fillStyle = PALETTE.sidewalk;
      ctx.fillRect(c - ROAD_W / 2 - 8, y0, 8, y1 - y0);
      ctx.fillRect(c + ROAD_W / 2, y0, 8, y1 - y0);
      // Centre dashes, broken at intersections.
      ctx.fillStyle = PALETTE.lane;
      for (let y = Math.floor(y0 / 44) * 44; y < y1; y += 44) {
        if (onIntersection(y)) continue;
        ctx.fillRect(c - 2, y, 4, 22);
      }
    }
    // Horizontal road.
    if (c > y0 - ROAD_W && c < y1 + ROAD_W) {
      ctx.fillStyle = PALETTE.asphalt;
      ctx.fillRect(x0, c - ROAD_W / 2, x1 - x0, ROAD_W);
      ctx.fillStyle = PALETTE.sidewalk;
      ctx.fillRect(x0, c - ROAD_W / 2 - 8, x1 - x0, 8);
      ctx.fillRect(x0, c + ROAD_W / 2, x1 - x0, 8);
      ctx.fillStyle = PALETTE.lane;
      for (let x = Math.floor(x0 / 44) * 44; x < x1; x += 44) {
        if (onIntersection(x)) continue;
        ctx.fillRect(x, c - 2, 22, 4);
      }
    }
  }
}

function onIntersection(v) {
  for (let i = 0; i < ROAD_COUNT; i += 1) {
    if (Math.abs(v - roadCenter(i)) < ROAD_W / 2 + 24) return true;
  }
  return false;
}

function drawParks(ctx, game) {
  for (const park of game.city.parks) {
    ctx.fillStyle = park.plaza ? PALETTE.plaza : PALETTE.park;
    ctx.fillRect(park.x, park.y, park.w, park.h);
    if (park.plaza) {
      // Marina Plaza: fountain ring and paving circles.
      ctx.fillStyle = PALETTE.fountainDeep;
      ctx.beginPath();
      ctx.arc(game.city.fountain.x, game.city.fountain.y, game.city.fountain.r + 8, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = PALETTE.fountain;
      ctx.beginPath();
      ctx.arc(game.city.fountain.x, game.city.fountain.y, game.city.fountain.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(game.city.fountain.x, game.city.fountain.y, 8 + Math.sin(game.time * 3) * 3, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.fillStyle = '#4a7a3a';
  for (const tree of game.city.trees) {
    ctx.beginPath();
    ctx.arc(tree.x, tree.y, tree.r, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#5d9048';
    ctx.beginPath();
    ctx.arc(tree.x - 3, tree.y - 3, tree.r * 0.6, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#4a7a3a';
  }
}

function drawBuildings(ctx, game) {
  for (const b of game.city.buildings) {
    // Shadow.
    ctx.fillStyle = 'rgba(0,0,0,0.18)';
    ctx.fillRect(b.x + 5, b.y + 7, b.w, b.h);
    ctx.fillStyle = b.color;
    ctx.fillRect(b.x, b.y, b.w, b.h);
    // Roof inset and rooftop details.
    ctx.fillStyle = b.roof;
    ctx.fillRect(b.x + 8, b.y + 8, b.w - 16, b.h - 16);
    ctx.fillStyle = 'rgba(255,255,255,0.25)';
    const cols = Math.max(1, Math.floor(b.w / 34));
    const rows = Math.max(1, Math.floor(b.h / 34));
    for (let i = 0; i < cols; i += 1) {
      for (let j = 0; j < rows; j += 1) {
        ctx.fillRect(b.x + 14 + i * 34, b.y + 14 + j * 34, 12, 12);
      }
    }
    // Height shading on one edge.
    ctx.fillStyle = 'rgba(0,0,0,0.12)';
    ctx.fillRect(b.x + b.w - 10, b.y, 10, b.h);
  }
}

function drawPickups(ctx, game) {
  for (const pk of game.pickups) {
    if (pk.taken) continue;
    const bob = Math.sin(game.time * 3 + pk.spin) * 3;
    ctx.save();
    ctx.translate(pk.x, pk.y + bob);
    ctx.rotate(Math.sin(game.time * 2 + pk.spin) * 0.3);
    ctx.fillStyle = PALETTE.money;
    rr(ctx, -11, -7, 22, 14, 3);
    ctx.fill();
    ctx.fillStyle = '#1d5c1d';
    ctx.font = 'bold 11px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('$', 0, 1);
    ctx.restore();
  }
}

function drawMissionMarkers(ctx, game) {
  // Rico's job marker, always visible.
  const job = game.jobPos;
  const pulse = 1 + Math.sin(game.time * 4) * 0.12;
  ctx.save();
  ctx.translate(job.x, job.y);
  ctx.scale(pulse, pulse);
  ctx.fillStyle = '#ffd23d';
  ctx.beginPath();
  ctx.arc(0, 0, 16, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#7a5200';
  ctx.font = 'bold 16px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('!', 0, 1);
  ctx.restore();
  ctx.fillStyle = '#ffd23d';
  ctx.font = 'bold 13px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('RICO — JOBS', job.x, job.y + 30);

  const m = game.mission;
  if (m && !m.done && !m.failed && m.target) {
    const t = m.target;
    ctx.save();
    ctx.translate(t.x, t.y);
    const p2 = 1 + Math.sin(game.time * 5) * 0.15;
    ctx.scale(p2, p2);
    ctx.strokeStyle = '#ffd23d';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(0, 0, t.r * 0.55, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = 'rgba(255,210,61,0.25)';
    ctx.beginPath();
    ctx.arc(0, 0, t.r * 0.55, 0, Math.PI * 2);
    ctx.fill();
    // Diamond marker above the ring.
    ctx.fillStyle = '#ffd23d';
    ctx.beginPath();
    ctx.moveTo(0, -t.r * 0.55 - 26);
    ctx.lineTo(12, -t.r * 0.55 - 8);
    ctx.lineTo(0, -t.r * 0.55 + 4);
    ctx.lineTo(-12, -t.r * 0.55 - 8);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
  // Hot Wheels target car gets a beacon.
  if (m && m.type === 'hotwheels' && m.step === 0 && m.car) {
    ctx.save();
    ctx.translate(m.car.x, m.car.y - 40);
    ctx.fillStyle = '#ffd23d';
    ctx.beginPath();
    ctx.moveTo(0, -12);
    ctx.lineTo(10, 6);
    ctx.lineTo(0, 0);
    ctx.lineTo(-10, 6);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
}

function drawCarShape(ctx, car, flash) {
  ctx.save();
  ctx.translate(car.x, car.y);
  ctx.rotate(car.angle);
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  rr(ctx, -CAR_LENGTH / 2 + 3, -CAR_WIDTH / 2 + 4, CAR_LENGTH, CAR_WIDTH, 6);
  ctx.fill();
  ctx.fillStyle = car.color;
  rr(ctx, -CAR_LENGTH / 2, -CAR_WIDTH / 2, CAR_LENGTH, CAR_WIDTH, 7);
  ctx.fill();
  // Windshield and rear window.
  ctx.fillStyle = '#1c2733';
  rr(ctx, 4, -CAR_WIDTH / 2 + 3, 10, CAR_WIDTH - 6, 3);
  ctx.fill();
  rr(ctx, -16, -CAR_WIDTH / 2 + 3, 8, CAR_WIDTH - 6, 3);
  ctx.fill();
  // Headlights.
  ctx.fillStyle = '#fff8c0';
  ctx.fillRect(CAR_LENGTH / 2 - 3, -CAR_WIDTH / 2 + 2, 3, 5);
  ctx.fillRect(CAR_LENGTH / 2 - 3, CAR_WIDTH / 2 - 7, 3, 5);
  if (car.kind === 'police') {
    ctx.fillStyle = '#1c2733';
    ctx.fillRect(-6, -CAR_WIDTH / 2 + 2, 12, 4);
    ctx.fillRect(-6, CAR_WIDTH / 2 - 6, 12, 4);
    ctx.font = 'bold 9px sans-serif';
    ctx.fillStyle = '#1c2733';
    ctx.textAlign = 'center';
    ctx.fillText('PD', 0, 3);
    // Flashing light bar, driven by game time so a seeded frame is stable.
    ctx.fillStyle = flash ? '#ff2d2d' : '#2d7dff';
    ctx.fillRect(-8, -4, 6, 8);
    ctx.fillStyle = flash ? '#2d7dff' : '#ff2d2d';
    ctx.fillRect(2, -4, 6, 8);
  }
  if (car.kind === 'taxi') {
    ctx.fillStyle = '#1c2733';
    ctx.font = 'bold 8px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('TAXI', 0, 3);
  }
  if (car.wrecked) {
    ctx.strokeStyle = 'rgba(0,0,0,0.5)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-CAR_LENGTH / 2 + 4, -CAR_WIDTH / 2 + 4);
    ctx.lineTo(CAR_LENGTH / 2 - 4, CAR_WIDTH / 2 - 4);
    ctx.moveTo(CAR_LENGTH / 2 - 4, -CAR_WIDTH / 2 + 4);
    ctx.lineTo(-CAR_LENGTH / 2 + 4, CAR_WIDTH / 2 - 4);
    ctx.stroke();
  }
  ctx.restore();
}

function drawCars(ctx, game) {
  const flash = Math.floor(game.time * 5) % 2 === 0;
  for (const car of game.parked) drawCarShape(ctx, car, flash);
  for (const car of game.traffic) drawCarShape(ctx, car, flash);
  for (const car of game.police) drawCarShape(ctx, car, flash);
  if (game.player.car) drawCarShape(ctx, game.player.car, flash);
}

function drawPedestrians(ctx, game) {
  for (const ped of game.peds) {
    const bob = Math.sin(game.time * 8 + ped.bob) * 1.5;
    ctx.save();
    ctx.translate(ped.x, ped.y + bob * 0.3);
    ctx.fillStyle = 'rgba(0,0,0,0.2)';
    ctx.beginPath();
    ctx.ellipse(0, 6, 7, 3, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = ped.color;
    ctx.beginPath();
    ctx.arc(0, 0, 7, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#e8b88a';
    ctx.beginPath();
    ctx.arc(Math.cos(ped.angle) * 3, Math.sin(ped.angle) * 3 - 2, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
  // The fare passenger waits with a waving arm.
  const m = game.mission;
  if (m && m.type === 'fare' && m.step === 0 && m.target) {
    const wave = Math.sin(game.time * 6) * 5;
    ctx.strokeStyle = '#ffd23d';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(m.target.x, m.target.y - 4);
    ctx.lineTo(m.target.x + 8, m.target.y - 16 + wave);
    ctx.stroke();
    ctx.fillStyle = '#ffd23d';
    ctx.beginPath();
    ctx.arc(m.target.x, m.target.y, 8, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawPlayer(ctx, game) {
  const p = game.player;
  if (p.car) return; // The car is drawn in drawCars; the driver is inside.
  const bob = Math.sin(game.time * 10) * 1.2;
  ctx.save();
  ctx.translate(p.x, p.y + bob * 0.3);
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  ctx.beginPath();
  ctx.ellipse(0, 8, 9, 4, 0, 0, Math.PI * 2);
  ctx.fill();
  // Body: teal jacket, the mark of our driver, Luz "Sol" Marín.
  ctx.fillStyle = '#0f8a7a';
  ctx.beginPath();
  ctx.arc(0, 0, PLAYER_RADIUS, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#f2c9a0';
  ctx.beginPath();
  ctx.arc(Math.cos(p.angle) * 5, Math.sin(p.angle) * 5 - 2, 6, 0, Math.PI * 2);
  ctx.fill();
  // Facing tick.
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(Math.cos(p.angle) * 8, Math.sin(p.angle) * 8);
  ctx.lineTo(Math.cos(p.angle) * 16, Math.sin(p.angle) * 16);
  ctx.stroke();
  ctx.restore();
}

function drawParticles(ctx, game) {
  for (const pt of game.particles) {
    ctx.globalAlpha = Math.max(0, pt.life / pt.maxLife);
    ctx.fillStyle = pt.color;
    ctx.beginPath();
    ctx.arc(pt.x, pt.y, pt.size, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

function drawObjectiveArrow(ctx, game, cam) {
  const m = game.mission;
  if (!m || m.done || m.failed || !m.target) return;
  const p = game.player;
  const px = p.car ? p.car.x : p.x;
  const py = p.car ? p.car.y : p.y;
  const tx = m.target.x;
  const ty = m.target.y;
  // Already on screen: the ring in the world marks it.
  if (tx > cam.x && tx < cam.x + VIEW_W && ty > cam.y && ty < cam.y + VIEW_H) return;
  const cx = px - cam.x;
  const cy = py - cam.y;
  const angle = Math.atan2(ty - py, tx - px);
  const ex = clamp(cx + Math.cos(angle) * 300, 60, VIEW_W - 60);
  const ey = clamp(cy + Math.sin(angle) * 300, 60, VIEW_H - 60);
  ctx.save();
  ctx.translate(ex, ey);
  ctx.rotate(angle);
  ctx.fillStyle = '#ffd23d';
  ctx.beginPath();
  ctx.moveTo(18, 0);
  ctx.lineTo(-10, -12);
  ctx.lineTo(-4, 0);
  ctx.lineTo(-10, 12);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
  ctx.fillStyle = '#ffd23d';
  ctx.font = 'bold 12px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(`${Math.round(Math.hypot(tx - px, ty - py))}m`, ex, ey + 28);
}

// ---------------------------------------------------------------- HUD ----

export function drawHUD(ctx, game) {
  ctx.save();
  // Wanted stars, top left: filled stars gold, empty stars dim.
  ctx.font = 'bold 26px sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = 'rgba(0,0,0,0.45)';
  ctx.fillRect(12, 10, 168, 40);
  let starX = 20;
  for (let i = 0; i < 5; i += 1) {
    ctx.fillStyle = i < game.wanted ? '#ffd23d' : '#6a6a6a';
    ctx.fillText(i < game.wanted ? '★' : '☆', starX, 40);
    starX += 30;
  }
  // Health bar under the stars.
  ctx.fillStyle = 'rgba(0,0,0,0.45)';
  ctx.fillRect(12, 54, 168, 14);
  ctx.fillStyle = game.player.health > 30 ? '#7de07d' : '#ff5252';
  ctx.fillRect(14, 56, 164 * clamp(game.player.health / 100, 0, 1), 10);
  // Money and jobs, top right.
  ctx.textAlign = 'right';
  ctx.font = 'bold 24px sans-serif';
  ctx.fillStyle = 'rgba(0,0,0,0.45)';
  const moneyText = `$${game.cash.toLocaleString('en-US')}`;
  ctx.fillRect(VIEW_W - 232, 10, 220, 40);
  ctx.fillStyle = PALETTE.money;
  ctx.fillText(moneyText, VIEW_W - 20, 40);
  ctx.font = 'bold 13px sans-serif';
  ctx.fillStyle = '#ffffff';
  ctx.fillText(`JOBS DONE ${game.stats.jobs}   BEST HAUL $${game.stats.bestHaul}`, VIEW_W - 20, 68);
  // Mission banner, top centre.
  const m = game.mission;
  if (m && !m.done && !m.failed) {
    ctx.textAlign = 'center';
    ctx.font = 'bold 16px sans-serif';
    const label = `${m.title} — ${m.targetLabel}`;
    const w = ctx.measureText(label).width + 28;
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    rr(ctx, VIEW_W / 2 - w / 2, 10, w, 34, 8);
    ctx.fill();
    ctx.fillStyle = '#ffd23d';
    ctx.fillText(label, VIEW_W / 2, 33);
    // Timer bar.
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.fillRect(VIEW_W / 2 - 110, 48, 220, 8);
    ctx.fillStyle = m.timeLeft < 20 ? '#ff5252' : '#ffd23d';
    ctx.fillRect(VIEW_W / 2 - 110, 48, 220 * clamp(m.timeLeft / m.timeLimit, 0, 1), 8);
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 12px sans-serif';
    ctx.fillText(`${Math.ceil(m.timeLeft)}s  •  pays $${m.payout + (m.tip || 0)}`, VIEW_W / 2, 70);
  }
  if (game.toast) {
    ctx.textAlign = 'center';
    ctx.font = 'bold 18px sans-serif';
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    const w = ctx.measureText(game.toast).width + 32;
    rr(ctx, VIEW_W / 2 - w / 2, 84, w, 34, 8);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.fillText(game.toast, VIEW_W / 2, 107);
  }
  // Speedometer, bottom right.
  const p = game.player;
  const speed = p.car ? Math.abs(p.car.speed) : 0;
  const kmh = Math.round(speed * 0.36);
  ctx.textAlign = 'right';
  ctx.fillStyle = 'rgba(0,0,0,0.5)';
  rr(ctx, VIEW_W - 150, VIEW_H - 92, 138, 80, 10);
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 34px sans-serif';
  ctx.fillText(`${kmh}`, VIEW_W - 28, VIEW_H - 44);
  ctx.font = 'bold 12px sans-serif';
  ctx.fillStyle = '#ffd23d';
  ctx.fillText(p.car ? 'KM/H — DRIVING' : 'ON FOOT', VIEW_W - 28, VIEW_H - 24);
  if (p.car && p.car.health < 100) {
    ctx.fillStyle = '#ff5252';
    ctx.font = 'bold 11px sans-serif';
    ctx.fillText(`CAR ${Math.round(p.car.health)}%`, VIEW_W - 28, VIEW_H - 78);
  }
  // Hints, bottom centre.
  ctx.textAlign = 'center';
  ctx.font = '13px sans-serif';
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.fillText(game.hintText, VIEW_W / 2, VIEW_H - 14);
  // Mute state.
  if (game.muted) {
    ctx.textAlign = 'left';
    ctx.font = 'bold 13px sans-serif';
    ctx.fillStyle = '#ffffff';
    ctx.fillText('🔇 MUTED (M)', 12, VIEW_H - 14);
  }
  drawMinimap(ctx, game);
  ctx.restore();
}

function drawMinimap(ctx, game) {
  const size = 176;
  const mx = 12;
  const my = VIEW_H - size - 12;
  const scale = size / WORLD_W;
  ctx.save();
  ctx.fillStyle = 'rgba(10,16,20,0.72)';
  rr(ctx, mx - 4, my - 4, size + 8, size + 8, 8);
  ctx.fill();
  ctx.beginPath();
  ctx.rect(mx, my, size, size);
  ctx.clip();
  // Ocean and sand.
  ctx.fillStyle = PALETTE.ocean;
  ctx.fillRect(mx, my + SAND_TOP * scale, size, size - SAND_TOP * scale);
  ctx.fillStyle = PALETTE.sand;
  ctx.fillRect(mx, my + SAND_TOP * scale, size, (OCEAN_TOP - SAND_TOP) * scale);
  // Roads.
  ctx.fillStyle = '#5a5653';
  for (let i = 0; i < ROAD_COUNT; i += 1) {
    const c = roadCenter(i) * scale;
    ctx.fillRect(mx + c - 2, my, 4, size);
    ctx.fillRect(mx, my + c - 2, size, 4);
  }
  // Plaza.
  ctx.fillStyle = '#d8cdb4';
  ctx.fillRect(mx + game.city.plaza.x * scale - 6, my + game.city.plaza.y * scale - 6, 12, 12);
  // Job marker.
  ctx.fillStyle = '#ffd23d';
  ctx.beginPath();
  ctx.arc(mx + game.jobPos.x * scale, my + game.jobPos.y * scale, 4, 0, Math.PI * 2);
  ctx.fill();
  // Mission target.
  const m = game.mission;
  if (m && !m.done && !m.failed && m.target) {
    ctx.fillStyle = '#ff9d00';
    ctx.save();
    ctx.translate(mx + m.target.x * scale, my + m.target.y * scale);
    ctx.rotate(Math.PI / 4);
    ctx.fillRect(-4, -4, 8, 8);
    ctx.restore();
  }
  // Police.
  ctx.fillStyle = '#ff5252';
  for (const car of game.police) {
    ctx.beginPath();
    ctx.arc(mx + car.x * scale, my + car.y * scale, 3, 0, Math.PI * 2);
    ctx.fill();
  }
  // Player arrow.
  const p = game.player;
  const px = p.car ? p.car.x : p.x;
  const py = p.car ? p.car.y : p.y;
  ctx.save();
  ctx.translate(mx + px * scale, my + py * scale);
  ctx.rotate(p.car ? p.car.angle : p.angle);
  ctx.fillStyle = '#ffffff';
  ctx.strokeStyle = '#0f8a7a';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(7, 0);
  ctx.lineTo(-5, -5);
  ctx.lineTo(-5, 5);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.restore();
  // Viewport box.
  const cam = cameraFor(game);
  ctx.strokeStyle = 'rgba(255,255,255,0.65)';
  ctx.lineWidth = 1;
  ctx.strokeRect(mx + cam.x * scale, my + cam.y * scale, VIEW_W * scale, VIEW_H * scale);
  ctx.restore();
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 11px sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText('SOLARA BAY', mx, my - 8);
}

// ------------------------------------------------------------- Screens ----

function screenBase(ctx, title, subtitle) {
  ctx.fillStyle = 'rgba(8,18,26,0.72)';
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);
  ctx.textAlign = 'center';
  ctx.fillStyle = '#ffb400';
  ctx.font = 'bold 64px sans-serif';
  ctx.fillText(title, VIEW_W / 2, 190);
  ctx.fillStyle = '#ffffff';
  ctx.font = '24px sans-serif';
  ctx.fillText(subtitle, VIEW_W / 2, 232);
}

export function drawTitle(ctx, game) {
  screenBase(ctx, 'SOLARA BAY', 'A sun-soaked open-world crime story');
  ctx.textAlign = 'center';
  ctx.fillStyle = '#e8e8e8';
  ctx.font = '16px sans-serif';
  const lines = [
    'Luz "Sol" Marín came back to Solara Bay with nothing but a stolen smile.',
    'Fixer Rico Delgado has work: getaways, dockside runs, fares across town.',
    'Steal a car, outrun the Bay PD, and make the city pay you back.',
  ];
  lines.forEach((line, i) => ctx.fillText(line, VIEW_W / 2, 280 + i * 26));
  // Controls.
  ctx.fillStyle = '#ffd23d';
  ctx.font = 'bold 15px sans-serif';
  ctx.fillText('WASD / ARROWS — move & drive      E — enter car / take job      SPACE — punch / handbrake', VIEW_W / 2, 396);
  ctx.fillText('P — pause      M — mute      Click the buttons below', VIEW_W / 2, 420);
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 22px sans-serif';
  ctx.fillText('— PRESS ENTER OR CLICK START —', VIEW_W / 2, 480);
  if (game.save) {
    ctx.fillStyle = '#7de07d';
    ctx.font = '15px sans-serif';
    ctx.fillText(`Welcome back — saved $${game.save.cash}  •  ${game.save.jobs} jobs done  •  best haul $${game.save.bestHaul}`, VIEW_W / 2, 530);
  }
  ctx.fillStyle = 'rgba(255,255,255,0.6)';
  ctx.font = '13px sans-serif';
  ctx.fillText('An original game. Solara Bay, its people and its streets are invented — nothing here is from any commercial game.', VIEW_W / 2, 690);
}

export function drawPause(ctx, game) {
  screenBase(ctx, 'PAUSED', 'The bay waits for no one — except right now.');
  ctx.textAlign = 'center';
  ctx.fillStyle = '#ffffff';
  ctx.font = '16px sans-serif';
  ctx.fillText(`Cash $${game.cash}   •   Jobs done ${game.stats.jobs}   •   Best haul $${game.stats.bestHaul}`, VIEW_W / 2, 300);
  ctx.fillText('P or click Resume to keep playing.  M toggles sound.', VIEW_W / 2, 340);
}

export function drawGameOver(ctx, game) {
  const over = game.overKind;
  const titles = { busted: 'BUSTED', wrecked: 'WRECKED', down: 'DOWN FOR THE COUNT' };
  const subs = {
    busted: 'The Bay PD caught up with Sol. Rico posts bail — but the job is blown.',
    wrecked: 'The ride is scrap. Sol walks away from the smoke, lighter in the pocket.',
    down: 'Sol took one hit too many. The bay keeps its secrets — and its cash.',
  };
  screenBase(ctx, titles[over] || 'GAME OVER', subs[over] || '');
  ctx.textAlign = 'center';
  ctx.fillStyle = '#ffffff';
  ctx.font = '16px sans-serif';
  ctx.fillText(`Cash kept $${game.cash}   •   Jobs done ${game.stats.jobs}   •   Best haul $${game.stats.bestHaul}`, VIEW_W / 2, 300);
  ctx.fillStyle = '#ffd23d';
  ctx.font = 'bold 20px sans-serif';
  ctx.fillText('— PRESS ENTER TO PLAY AGAIN —', VIEW_W / 2, 380);
}
