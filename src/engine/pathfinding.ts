/**
 * A* pathfinding on hex grid with terrain-aware movement costs.
 *
 * Uses axial coordinates (q, r) consistent with hex.ts.
 * Terrain costs are configurable per terrain type.
 */

import { type HexCoord, hexDistance, hexNeighbors } from './hex.js';
import type { TerrainType } from './mapgen.js';

// --- Movement Costs ---

/** Movement cost per terrain type. Infinity = impassable. */
export const TERRAIN_MOVEMENT_COST: Record<TerrainType, number> = {
  plains: 1,
  coast: 1,
  forest: 2,
  desert: 2,
  tundra: 2,
  mountains: Infinity, // impassable
  ocean: Infinity,     // impassable (no naval units in MVP)
};

/** Check if a terrain type is passable */
export function isPassable(terrain: TerrainType): boolean {
  return TERRAIN_MOVEMENT_COST[terrain] < Infinity;
}

// --- A* Implementation ---

/** Result of a pathfinding query */
export interface PathResult {
  /** Ordered hex coordinates from start to goal (inclusive) */
  path: HexCoord[];
  /** Total movement cost of the path */
  cost: number;
}

/** Hex terrain lookup: given (q, r) return the terrain type, or undefined if off-map */
export type TerrainLookup = (q: number, r: number) => TerrainType | undefined;

/** Coordinate key for Map lookups */
function hexKey(q: number, r: number): string {
  return `${q},${r}`;
}

/**
 * A* pathfinding on hex grid.
 *
 * @param start - Starting hex coordinate
 * @param goal - Target hex coordinate
 * @param getTerrain - Function to look up terrain at (q, r). Returns undefined for off-map hexes.
 * @returns PathResult with path and cost, or null if no path exists
 */
export function findPath(
  start: HexCoord,
  goal: HexCoord,
  getTerrain: TerrainLookup,
): PathResult | null {
  // Same hex — trivial path
  if (start.q === goal.q && start.r === goal.r) {
    return { path: [{ q: start.q, r: start.r }], cost: 0 };
  }

  // Check goal is reachable
  const goalTerrain = getTerrain(goal.q, goal.r);
  if (!goalTerrain || !isPassable(goalTerrain)) {
    return null;
  }

  // Check start is valid
  const startTerrain = getTerrain(start.q, start.r);
  if (!startTerrain) {
    return null;
  }

  // Priority queue (simple array sorted on insert — fine for hex grids <10k hexes)
  const openSet: Array<{ q: number; r: number; f: number }> = [];
  const openSetKeys = new Set<string>();

  // Cost tracking
  const gScore = new Map<string, number>(); // best cost to reach this hex
  const cameFrom = new Map<string, string>(); // parent hex key

  const startKey = hexKey(start.q, start.r);
  const goalKey = hexKey(goal.q, goal.r);

  gScore.set(startKey, 0);
  openSet.push({ q: start.q, r: start.r, f: hexDistance(start, goal) });
  openSetKeys.add(startKey);

  while (openSet.length > 0) {
    // Pop lowest f-score
    let bestIdx = 0;
    for (let i = 1; i < openSet.length; i++) {
      if (openSet[i].f < openSet[bestIdx].f) bestIdx = i;
    }
    const current = openSet[bestIdx];
    openSet.splice(bestIdx, 1);
    const currentKey = hexKey(current.q, current.r);
    openSetKeys.delete(currentKey);

    // Found goal — reconstruct path
    if (currentKey === goalKey) {
      const path: HexCoord[] = [];
      let key = goalKey;
      while (key !== undefined) {
        const [q, r] = key.split(',').map(Number);
        path.push({ q, r });
        key = cameFrom.get(key)!;
      }
      path.reverse();
      return { path, cost: gScore.get(goalKey)! };
    }

    // Explore neighbors
    const neighbors = hexNeighbors({ q: current.q, r: current.r });
    const currentG = gScore.get(currentKey)!;

    for (const neighbor of neighbors) {
      const terrain = getTerrain(neighbor.q, neighbor.r);
      if (!terrain || !isPassable(terrain)) continue;

      const moveCost = TERRAIN_MOVEMENT_COST[terrain];
      const tentativeG = currentG + moveCost;
      const neighborKey = hexKey(neighbor.q, neighbor.r);

      const previousG = gScore.get(neighborKey);
      if (previousG !== undefined && tentativeG >= previousG) continue;

      // Better path found
      gScore.set(neighborKey, tentativeG);
      cameFrom.set(neighborKey, currentKey);

      const f = tentativeG + hexDistance(neighbor, goal);

      if (!openSetKeys.has(neighborKey)) {
        openSet.push({ q: neighbor.q, r: neighbor.r, f });
        openSetKeys.add(neighborKey);
      } else {
        // Update f-score in open set
        const idx = openSet.findIndex(
          (n) => n.q === neighbor.q && n.r === neighbor.r,
        );
        if (idx >= 0) openSet[idx].f = f;
      }
    }
  }

  // No path found
  return null;
}

/**
 * Calculate total movement cost along a given path.
 */
export function pathCost(
  path: HexCoord[],
  getTerrain: TerrainLookup,
): number {
  let cost = 0;
  for (let i = 1; i < path.length; i++) {
    const terrain = getTerrain(path[i].q, path[i].r);
    if (!terrain || !isPassable(terrain)) return Infinity;
    cost += TERRAIN_MOVEMENT_COST[terrain];
  }
  return cost;
}

/**
 * Create a terrain lookup function from a flat array of hex tiles.
 * Useful for testing and for in-memory map operations.
 */
export function createTerrainLookup(
  hexes: Array<{ q: number; r: number; terrain: TerrainType }>,
): TerrainLookup {
  const map = new Map<string, TerrainType>();
  for (const hex of hexes) {
    map.set(hexKey(hex.q, hex.r), hex.terrain);
  }
  return (q, r) => map.get(hexKey(q, r));
}
