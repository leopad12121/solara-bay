// Solara Bay — the city itself. A seeded generator lays out the road grid's
// blocks as buildings, parks and the Marina Plaza, then fills the streets
// with traffic cars, parked cars, pedestrians and cash pickups. It also owns
// the collision tests the cars and the player walk against.
import {
  BLOCK, CAR_LENGTH, CAR_WIDTH, OCEAN_TOP, PALETTE, PARKED_COUNT, PED_COUNT,
  PLAZA_COL, PLAZA_ROW, ROAD_COUNT, ROAD_PITCH, ROAD_W, SAND_TOP, TRAFFIC_COUNT,
  WORLD_H, WORLD_W, roadCenter,
} from './config.js';
import { clamp, makeRng } from './random.js';
import { lanePoint, nearestNode, nodeXY, onRoad, snapToRoad } from './nav.js';

export function blockRect(col, row) {
  const x = roadCenter(col) + ROAD_W / 2;
  const y = roadCenter(row) + ROAD_W / 2;
  return { x, y, w: BLOCK, h: BLOCK };
}

export function isPlazaBlock(col, row) {
  return col === PLAZA_COL && row === PLAZA_ROW;
}

// A few blocks are parks; the rest hold buildings. The bottom row is the beach.
const PARK_BLOCKS = [
  [1, 1], [6, 1], [2, 5], [7, 5], [1, 6], [5, 6],
];

export function buildCity(seed) {
  const rng = makeRng(seed);
  const buildings = [];
  const parks = [];
  const trees = [];
  for (let row = 0; row < ROAD_COUNT - 1; row += 1) {
    for (let col = 0; col < ROAD_COUNT - 1; col += 1) {
      const rect = blockRect(col, row);
      if (row === ROAD_COUNT - 2 && col >= 0) {
        // The last block row fronts the beach: keep it low and open.
      }
      if (isPlazaBlock(col, row)) {
        parks.push({ ...rect, plaza: true });
        for (let i = 0; i < 10; i += 1) {
          trees.push({
            x: rect.x + rng.range(40, rect.w - 40),
            y: rect.y + rng.range(40, rect.h - 40),
            r: rng.range(10, 16),
          });
        }
        continue;
      }
      if (PARK_BLOCKS.some(([c, r]) => c === col && r === row)) {
        parks.push({ ...rect, plaza: false });
        for (let i = 0; i < 8; i += 1) {
          trees.push({
            x: rect.x + rng.range(30, rect.w - 30),
            y: rect.y + rng.range(30, rect.h - 30),
            r: rng.range(9, 15),
          });
        }
        continue;
      }
      // A normal block holds one to three buildings with a courtyard gap.
      const count = rng.int(1, 3);
      for (let i = 0; i < count; i += 1) {
        const w = rng.range(90, 170);
        const h = rng.range(90, 170);
        const x = rect.x + rng.range(18, rect.w - w - 18);
        const y = rect.y + rng.range(18, rect.h - h - 18);
        const b = {
          x, y, w, h,
          color: rng.pick(PALETTE.building),
          roof: rng.pick(PALETTE.roof),
          height: rng.int(1, 4),
        };
        if (buildings.some((o) => rectsOverlap(b, o, 24))) continue;
        buildings.push(b);
      }
    }
  }
  const plaza = blockRect(PLAZA_COL, PLAZA_ROW);
  return {
    buildings, parks, trees,
    plaza: { x: plaza.x + plaza.w / 2, y: plaza.y + plaza.h / 2, r: 62 },
    fountain: { x: plaza.x + plaza.w / 2, y: plaza.y + plaza.h / 2, r: 34 },
  };
}

export function rectsOverlap(a, b, pad = 0) {
  return a.x < b.x + b.w + pad && a.x + a.w + pad > b.x && a.y < b.y + b.h + pad && a.y + a.h + pad > b.y;
}

export function circleHitsRect(x, y, r, rect) {
  const cx = clamp(x, rect.x, rect.x + rect.w);
  const cy = clamp(y, rect.y, rect.y + rect.h);
  const dx = x - cx;
  const dy = y - cy;
  return dx * dx + dy * dy < r * r;
}

/** Push a circle out of every building it overlaps; returns true on a hit. */
export function resolveBuildingCollision(body, r, buildings) {
  let hit = false;
  for (const b of buildings) {
    if (!circleHitsRect(body.x, body.y, r, b)) continue;
    hit = true;
    const cx = clamp(body.x, b.x, b.x + b.w);
    const cy = clamp(body.y, b.y, b.y + b.h);
    let dx = body.x - cx;
    let dy = body.y - cy;
    if (dx === 0 && dy === 0) {
      // Centre is inside the rect: push out along the smallest penetration.
      const left = body.x - b.x;
      const right = b.x + b.w - body.x;
      const top = body.y - b.y;
      const bottom = b.y + b.h - body.y;
      const m = Math.min(left, right, top, bottom);
      if (m === left) { body.x = b.x - r; }
      else if (m === right) { body.x = b.x + b.w + r; }
      else if (m === top) { body.y = b.y - r; }
      else { body.y = b.y + b.h + r; }
      continue;
    }
    const len = Math.hypot(dx, dy) || 1;
    dx /= len;
    dy /= len;
    body.x = cx + dx * r;
    body.y = cy + dy * r;
  }
  return hit;
}

export function makeCar(rng, x, y, angle, opts = {}) {
  return {
    x, y, angle,
    speed: 0,
    color: opts.color ?? rng.pick(PALETTE.car),
    kind: opts.kind ?? 'traffic',
    maxSpeed: opts.maxSpeed ?? rng.range(300, 380),
    accel: rng.range(260, 340),
    route: opts.route ?? [],
    routeIndex: 0,
    wait: rng.range(0, 2),
    health: 100,
    wrecked: false,
    // Police fields, used only for cruisers.
    state: opts.state ?? null,
    backoff: 0,
    ramCooldown: 0,
    bustedTimer: 0,
  };
}

/** Spawn traffic cars spread over the road network, each with a random route. */
export function spawnTraffic(seed) {
  const rng = makeRng(seed + 101);
  const cars = [];
  for (let i = 0; i < TRAFFIC_COUNT; i += 1) {
    const a = rng.int(0, ROAD_COUNT * ROAD_COUNT - 1);
    const b = rng.int(0, ROAD_COUNT * ROAD_COUNT - 1);
    const pa = nodeXY(a);
    const pb = nodeXY(b);
    const lane = lanePoint(pa.x, pa.y, pb.x, pb.y);
    const angle = Math.atan2(pb.y - pa.y, pb.x - pa.x);
    const car = makeCar(rng, lane.x, lane.y, angle);
    car.route = [a, b];
    car.routeIndex = 1;
    car.speed = rng.range(120, 220);
    cars.push(car);
  }
  return cars;
}

/** Parked cars sit along the roads, waiting to be borrowed. */
export function spawnParked(seed, buildings) {
  const rng = makeRng(seed + 202);
  const cars = [];
  let guard = 0;
  while (cars.length < PARKED_COUNT && guard < 400) {
    guard += 1;
    const col = rng.int(0, ROAD_COUNT - 1);
    const row = rng.int(0, ROAD_COUNT - 1);
    const vertical = rng.chance(0.5);
    const along = rng.range(-140, 140);
    const side = rng.sign() * (ROAD_W / 2 - 16);
    let x;
    let y;
    let angle;
    if (vertical) {
      x = roadCenter(col) + side;
      y = roadCenter(row) + along;
      angle = side > 0 ? Math.PI / 2 : -Math.PI / 2;
    } else {
      x = roadCenter(col) + along;
      y = roadCenter(row) + side;
      angle = side > 0 ? 0 : Math.PI;
    }
    if (y > SAND_TOP - 40) continue;
    if (x < 40 || x > WORLD_W - 40 || y < 40 || y > WORLD_H - 40) continue;
    if (cars.some((c) => Math.hypot(c.x - x, c.y - y) < 90)) continue;
    const car = makeCar(rng, x, y, angle, { kind: 'parked' });
    cars.push(car);
  }
  return cars;
}

/** Pedestrians wander the sidewalks and flee from danger. */
export function spawnPedestrians(seed) {
  const rng = makeRng(seed + 303);
  const peds = [];
  for (let i = 0; i < PED_COUNT; i += 1) {
    const col = rng.int(0, ROAD_COUNT - 1);
    const row = rng.int(0, ROAD_COUNT - 1);
    const p = snapToRoad(roadCenter(col) + rng.range(-160, 160), roadCenter(row) + rng.range(-160, 160));
    peds.push({
      x: clamp(p.x + rng.range(-30, 30), 30, WORLD_W - 30),
      y: clamp(p.y + rng.range(-30, 30), 30, WORLD_H - 30),
      angle: rng.range(0, Math.PI * 2),
      speed: rng.range(40, 70),
      state: 'walk',
      target: null,
      fleeX: 0,
      fleeY: 0,
      color: rng.pick(['#e8b04b', '#7fb3d5', '#c96f6f', '#9db98a', '#b08cc9', '#f2f2f2']),
      bob: rng.range(0, Math.PI * 2),
    });
  }
  return peds;
}

/** Cash pickups: loose bills scattered around the city. */
export function spawnPickups(seed) {
  const rng = makeRng(seed + 404);
  const pickups = [];
  for (let i = 0; i < 14; i += 1) {
    const col = rng.int(0, ROAD_COUNT - 1);
    const row = rng.int(0, ROAD_COUNT - 2);
    pickups.push({
      x: clamp(roadCenter(col) + rng.range(-180, 180), 40, WORLD_W - 40),
      y: clamp(roadCenter(row) + rng.range(-180, 180), 40, WORLD_H - 40),
      taken: false,
      spin: rng.range(0, Math.PI * 2),
    });
  }
  return pickups;
}

export { CAR_LENGTH, CAR_WIDTH, OCEAN_TOP, SAND_TOP, WORLD_H, WORLD_W, onRoad, nearestNode };
