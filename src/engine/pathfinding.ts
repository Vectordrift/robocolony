/**
 * Hex pathfinding using A* algorithm with terrain-based movement costs.
 *
 * Uses axial coordinates (q, r) consistent with hex.ts.
 */

import type { HexCoord } from './hex.js';
import { hexDistance, hexNeighbors } from './hex.js';

// --- Terrain Movement Costs ---

/** Movement cost per terrain type. Infinity = impassable. */
export const TERRAIN_COST: Record<string, number> = {
  plains: 1,
  forest: 1.5,
  coast: 1,
  desert: 1.5,
  tundra: 1.5,
  mountains: 2,
  ocean: Infinity,
};

// --- Unit Movement Speeds ---

/** Maximum hexes a unit can traverse per tick (in movement cost units). */
export const UNIT_SPEED: Record<string, number> = {
  scout: 5,
  militia: 3,
  soldier: 3,
  siege: 1,
  settler: 2,
};

// --- Vision Radius ---

/** How far each unit type can see (in hex distance). */
export const VISION_RADIUS: Record<string, number> = {
  scout: 6,
  militia: 1,
  soldier: 3,
  siege: 1,
  settler: 2,
};

// --- A* Pathfinding ---

interface HexNode {
  coord: HexCoord;
  g: number; // cost from start
  f: number; // g + heuristic
  parent: HexNode | null;
}

function coordKey(c: HexCoord): string {
  return `${c.q},${c.r}`;
}

/**
 * Hex map interface for pathfinding lookups.
 * Callers provide terrain data for each hex.
 */
export interface HexLookup {
  getTerrain(q: number, r: number): string | undefined;
}

/**
 * Create a HexLookup from an array of hex objects.
 */
export function createHexLookup(hexes: Array<{ x: number; y: number; terrain: string }>): HexLookup {
  const map = new Map<string, string>();
  for (const h of hexes) {
    map.set(`${h.x},${h.y}`, h.terrain);
  }
  return {
    getTerrain(q: number, r: number): string | undefined {
      return map.get(`${q},${r}`);
    },
  };
}

/**
 * Find the shortest path between two hex coordinates using A*.
 *
 * @param from - Starting hex coordinate
 * @param to - Target hex coordinate
 * @param hexLookup - Terrain lookup for the hex map
 * @returns Array of hex coordinates (excluding `from`, including `to`), or null if unreachable
 */
export function findPath(
  from: HexCoord,
  to: HexCoord,
  hexLookup: HexLookup,
): HexCoord[] | null {
  // Quick check: if target is impassable, no path
  const targetTerrain = hexLookup.getTerrain(to.q, to.r);
  if (!targetTerrain || TERRAIN_COST[targetTerrain] === Infinity) {
    return null;
  }

  // Quick check: already at target
  if (from.q === to.q && from.r === to.r) {
    return [];
  }

  const openSet = new Map<string, HexNode>();
  const closedSet = new Set<string>();

  const startNode: HexNode = {
    coord: from,
    g: 0,
    f: hexDistance(from, to),
    parent: null,
  };

  openSet.set(coordKey(from), startNode);

  while (openSet.size > 0) {
    // Find node with lowest f score
    let current: HexNode | null = null;
    for (const node of openSet.values()) {
      if (!current || node.f < current.f) {
        current = node;
      }
    }

    if (!current) break;

    // Reached target?
    if (current.coord.q === to.q && current.coord.r === to.r) {
      // Reconstruct path (excluding start)
      const path: HexCoord[] = [];
      let node: HexNode | null = current;
      while (node && node.parent) {
        path.unshift({ q: node.coord.q, r: node.coord.r });
        node = node.parent;
      }
      return path;
    }

    const currentKey = coordKey(current.coord);
    openSet.delete(currentKey);
    closedSet.add(currentKey);

    // Explore neighbors
    const neighbors = hexNeighbors(current.coord);
    for (const neighbor of neighbors) {
      const nKey = coordKey(neighbor);
      if (closedSet.has(nKey)) continue;

      const terrain = hexLookup.getTerrain(neighbor.q, neighbor.r);
      if (!terrain) continue; // off-map

      const cost = TERRAIN_COST[terrain];
      if (cost === Infinity) continue; // impassable

      const tentativeG = current.g + cost;

      const existing = openSet.get(nKey);
      if (existing && tentativeG >= existing.g) continue;

      const node: HexNode = {
        coord: neighbor,
        g: tentativeG,
        f: tentativeG + hexDistance(neighbor, to),
        parent: current,
      };
      openSet.set(nKey, node);
    }
  }

  return null; // no path found
}

/**
 * Calculate how far a unit can move along a path in one tick.
 *
 * Returns the index (exclusive) into the path array that the unit can reach.
 * Movement cost is cumulative: a scout with speed 3 can move through 3 plains
 * hexes but only 1 mountain hex + 0 more (cost 3 = budget exhausted).
 *
 * @param path - The full path (from findPath, excluding start position)
 * @param unitType - The unit type (determines speed)
 * @param hexLookup - Terrain lookup
 * @returns Number of steps the unit can take this tick (index into path)
 */
export function movementStepsThisTick(
  path: HexCoord[],
  unitType: string,
  hexLookup: HexLookup,
): number {
  const budget = UNIT_SPEED[unitType] ?? 1;
  let spent = 0;
  let steps = 0;

  for (const step of path) {
    const terrain = hexLookup.getTerrain(step.q, step.r);
    const cost = terrain ? (TERRAIN_COST[terrain] ?? 1) : 1;

    if (spent + cost > budget) break;
    spent += cost;
    steps++;
  }

  // Always allow at least 1 step if the first hex is passable
  if (steps === 0 && path.length > 0) {
    const terrain = hexLookup.getTerrain(path[0].q, path[0].r);
    const cost = terrain ? (TERRAIN_COST[terrain] ?? 1) : 1;
    if (cost !== Infinity) {
      steps = 1;
    }
  }

  return steps;
}


