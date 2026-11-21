// Solara Bay — jobs from Rico Delgado. Three kinds cycle in order, and every
// completed round pays 25% more: a getaway, a dockside delivery and a taxi
// fare with a tip. Each mission is a small state machine of objectives the
// HUD points at with an arrow.
import {
  MISSION_ROUND_BONUS, ROAD_COUNT, SAND_TOP, WORLD_H, WORLD_W, roadCenter,
} from './config.js';
import { clamp, makeRng } from './random.js';
import { nearestNode, nodeXY } from './nav.js';

export const MISSION_TYPES = ['hotwheels', 'dockside', 'fare'];

export const MISSION_INFO = {
  hotwheels: {
    title: 'Hot Wheels',
    base: 220,
    brief: 'Rico needs a getaway car. Jack the marked ride and bring it to the garage before the clock runs out.',
  },
  dockside: {
    title: 'Dockside Run',
    base: 180,
    brief: 'Pick up the package at the docks and deliver it to the drop point. No questions, no stops.',
  },
  fare: {
    title: 'Fare Game',
    base: 140,
    brief: 'A customer is waiting. Pick them up, drive them across town, and a smooth ride earns a tip.',
  },
};

export function payoutFor(type, round) {
  const info = MISSION_INFO[type];
  return Math.round(info.base * (1 + MISSION_ROUND_BONUS * (round - 1)));
}

function randomRoadPoint(rng, avoidY) {
  const col = rng.int(0, ROAD_COUNT - 1);
  const row = rng.int(0, ROAD_COUNT - 1);
  let x = clamp(roadCenter(col) + rng.range(-120, 120), 80, WORLD_W - 80);
  let y = clamp(roadCenter(row) + rng.range(-120, 120), 80, WORLD_H - 80);
  if (avoidY !== undefined && Math.abs(y - avoidY) < 260) {
    y = clamp(roadCenter(rng.int(0, 5)), 80, WORLD_H - 80);
  }
  return { x, y };
}

/**
 * Start the next mission in the cycle. `round` is 1-based and grows the pay.
 * Returns a mission object whose `step` the game advances.
 */
export function startMission(type, round, rng, playerPos) {
  const info = MISSION_INFO[type];
  const mission = {
    type,
    round,
    title: info.title,
    brief: info.brief,
    payout: payoutFor(type, round),
    step: 0,
    timeLeft: 0,
    timeLimit: 0,
    target: null,
    targetLabel: '',
    car: null,
    passenger: null,
    failed: false,
    done: false,
    tip: 0,
  };
  if (type === 'hotwheels') {
    // A marked car waits across town; the garage is the goal after the steal.
    const spot = randomRoadPoint(rng, playerPos.y);
    mission.target = { x: spot.x, y: spot.y, r: 60 };
    mission.targetLabel = 'Jack the marked car';
    mission.step = 0;
    mission.timeLimit = 150;
    mission.timeLeft = 150;
  } else if (type === 'dockside') {
    const dock = { x: roadCenter(7) + 120, y: SAND_TOP - 180 };
    mission.target = { ...dock, r: 70 };
    mission.targetLabel = 'Pick up the package at the docks';
    mission.step = 0;
    mission.timeLimit = 150;
    mission.timeLeft = 150;
  } else {
    // Fare: a customer waits on a sidewalk near the player, then names a stop.
    const spot = randomRoadPoint(rng, playerPos.y);
    mission.target = { x: spot.x, y: spot.y, r: 60 };
    mission.targetLabel = 'Pick up your passenger';
    mission.step = 0;
    mission.timeLimit = 180;
    mission.timeLeft = 180;
  }
  return mission;
}

/** Advance a mission one frame. Returns an event string or null. */
export function updateMission(mission, game, dt) {
  if (!mission || mission.done || mission.failed) return null;
  mission.timeLeft -= dt;
  if (mission.timeLeft <= 0) {
    mission.failed = true;
    return 'timeout';
  }
  const p = game.player;
  const px = p.car ? p.car.x : p.x;
  const py = p.car ? p.car.y : p.y;
  const t = mission.target;
  if (!t) return null;
  const d = Math.hypot(px - t.x, py - t.y);

  if (mission.type === 'hotwheels') {
    if (mission.step === 0) {
      // Step 0: reach the marked car and get in it.
      if (p.car === mission.car && mission.car) {
        mission.step = 1;
        const garage = { x: roadCenter(1), y: roadCenter(1), r: 70 };
        mission.target = garage;
        mission.targetLabel = 'Deliver the car to the garage';
        return 'stolen';
      }
      if (d < t.r && !p.car) {
        // Standing by the car: the game handles the E prompt itself.
      }
    } else if (mission.step === 1 && d < t.r && p.car === mission.car) {
      mission.done = true;
      return 'complete';
    }
  } else if (mission.type === 'dockside') {
    if (mission.step === 0 && d < t.r) {
      mission.step = 1;
      const drop = randomRoadPoint(game.rng, py);
      mission.target = { ...drop, r: 70 };
      mission.targetLabel = 'Deliver the package to the drop point';
      return 'picked';
    }
    if (mission.step === 1 && d < t.r) {
      mission.done = true;
      return 'complete';
    }
  } else if (mission.type === 'fare') {
    if (mission.step === 0 && d < t.r && p.car) {
      mission.step = 1;
      mission.passenger = { x: px, y: py };
      const dest = randomRoadPoint(game.rng, py);
      mission.target = { ...dest, r: 70 };
      mission.targetLabel = 'Drive your passenger to the stop';
      mission.startSpeed = 0;
      return 'picked';
    }
    if (mission.step === 1 && d < t.r && p.car) {
      // Tip: up to $60 for a quick, gentle ride.
      const timeBonus = Math.max(0, Math.round((mission.timeLeft / mission.timeLimit) * 40));
      const smoothBonus = game.player.car && game.player.car.health > 80 ? 20 : 0;
      mission.tip = timeBonus + smoothBonus;
      mission.done = true;
      return 'complete';
    }
  }
  return null;
}

/** Where Rico's job marker stands: the plaza steps, downtown. */
export function jobMarkerPos(city) {
  return { x: city.plaza.x, y: city.plaza.y + city.plaza.r + 46 };
}

export { WORLD_H, WORLD_W, nearestNode, nodeXY, makeRng };
