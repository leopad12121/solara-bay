// Solara Bay — the road network. Intersections are nodes on a grid; traffic
// and police route along it with a plain breadth-first search, and cars drive
// on the right-hand lane, offset from the road centre in their direction.
import { ROAD_COUNT, ROAD_W, WORLD_H, WORLD_W, roadCenter } from './config.js';
import { clamp } from './random.js';

export const LANE_OFFSET = 24;

// Node ids run row-major over the 9x9 intersection grid.
export function nodeId(col, row) {
  return row * ROAD_COUNT + col;
}
export function nodeXY(id) {
  return { x: roadCenter(id % ROAD_COUNT), y: roadCenter(Math.floor(id / ROAD_COUNT)) };
}
export function nodeCount() {
  return ROAD_COUNT * ROAD_COUNT;
}

export function neighbours(id) {
  const col = id % ROAD_COUNT;
  const row = Math.floor(id / ROAD_COUNT);
  const out = [];
  if (col > 0) out.push(id - 1);
  if (col < ROAD_COUNT - 1) out.push(id + 1);
  if (row > 0) out.push(id - ROAD_COUNT);
  if (row < ROAD_COUNT - 1) out.push(id + ROAD_COUNT);
  return out;
}

/** Breadth-first route from one intersection to another, as a list of node ids. Always at least two nodes, so callers can read [index] and [index - 1]. */
export function findRoute(from, to) {
  if (from === to) {
    const n = neighbours(from);
    return n.length > 0 ? [from, n[0]] : [from, from];
  }
  const prev = new Map([[from, -1]]);
  const queue = [from];
  while (queue.length > 0) {
    const cur = queue.shift();
    for (const n of neighbours(cur)) {
      if (prev.has(n)) continue;
      prev.set(n, cur);
      if (n === to) {
        const path = [to];
        let at = to;
        while (prev.get(at) !== -1) {
          at = prev.get(at);
          path.unshift(at);
        }
        return path;
      }
      queue.push(n);
    }
  }
  return [from, to];
}

export function nearestNode(x, y) {
  const col = clamp(Math.round((x - ROAD_W / 2) / (ROAD_W + 350)), 0, ROAD_COUNT - 1);
  const row = clamp(Math.round((y - ROAD_W / 2) / (ROAD_W + 350)), 0, ROAD_COUNT - 1);
  return nodeId(col, row);
}

/** Is this point on a road (within the asphalt)? */
export function onRoad(x, y) {
  for (let i = 0; i < ROAD_COUNT; i += 1) {
    const c = roadCenter(i);
    if (Math.abs(x - c) <= ROAD_W / 2) return true;
    if (Math.abs(y - c) <= ROAD_W / 2) return true;
  }
  return false;
}

/** Distance from a point to the nearest road centre line. */
export function roadDistance(x, y) {
  let best = Infinity;
  for (let i = 0; i < ROAD_COUNT; i += 1) {
    const c = roadCenter(i);
    best = Math.min(best, Math.abs(x - c), Math.abs(y - c));
  }
  return best;
}

/** The closest point on the road network to (x, y), snapped to a centre line. */
export function snapToRoad(x, y) {
  let bestX = x;
  let bestY = y;
  let best = Infinity;
  for (let i = 0; i < ROAD_COUNT; i += 1) {
    const c = roadCenter(i);
    const d = Math.abs(x - c);
    if (d < best) {
      best = d;
      bestX = c;
      bestY = y;
    }
    const d2 = Math.abs(y - c);
    if (d2 < best) {
      best = d2;
      bestX = x;
      bestY = c;
    }
  }
  return { x: bestX, y: bestY };
}

/**
 * The lane position for driving from node A to node B: the road centre
 * shifted to the right-hand side of the direction of travel.
 */
export function lanePoint(ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len;
  const ny = dx / len;
  // Right-hand traffic: offset to the right of the direction of travel.
  return { x: (ax + bx) / 2 + nx * LANE_OFFSET, y: (ay + by) / 2 + ny * LANE_OFFSET };
}

/** A point just inside the world bounds, used to keep cars and peds in. */
export function clampToWorld(x, y, margin) {
  return {
    x: clamp(x, margin, WORLD_W - margin),
    y: clamp(y, margin, WORLD_H - margin),
  };
}
