/**
 * Hex map generation for RoboColony worlds.
 *
 * Generates a finite hex map with seeded terrain, resources, and colony starting positions.
 * All hexes are pre-generated at world creation for deterministic, reproducible worlds.
 */

import { type HexCoord, hexesInRadius, hexDistanceFromOrigin, hexNeighbors, hexDistance, hexRing } from './hex.js';
import { multiOctaveNoise, noiseAt, createRng } from './noise.js';

// --- Types ---

export type TerrainType = 'ocean' | 'coast' | 'plains' | 'forest' | 'mountains' | 'desert' | 'tundra';

export interface HexTile {
  q: number;
  r: number;
  terrain: TerrainType;
  resources: HexResources;
}

export interface HexResources {
  food: number;
  timber: number;
  stone: number;
  iron: number;
}

export interface WorldMap {
  seed: number;
  radius: number;
  hexes: HexTile[];
  startingPositions: HexCoord[];
}

// --- Terrain Generation ---

/** Base resource yields per terrain type */
const TERRAIN_RESOURCES: Record<TerrainType, HexResources> = {
  ocean:     { food: 0, timber: 0, stone: 0, iron: 0 },
  coast:     { food: 2, timber: 0, stone: 1, iron: 0 },
  plains:    { food: 3, timber: 1, stone: 0, iron: 0 },
  forest:    { food: 1, timber: 3, stone: 0, iron: 0 },
  mountains: { food: 0, timber: 0, stone: 3, iron: 2 },
  desert:    { food: 0, timber: 0, stone: 1, iron: 1 },
  tundra:    { food: 1, timber: 1, stone: 1, iron: 0 },
};

/**
 * Determine terrain type for a hex based on distance from center and noise.
 */
function assignTerrain(
  coord: HexCoord,
  radius: number,
  seed: number,
): TerrainType {
  const dist = hexDistanceFromOrigin(coord);
  const distRatio = dist / radius;

  // Ocean boundary
  if (distRatio > 0.85) return 'ocean';

  // Coast zone
  if (distRatio > 0.75) return 'coast';

  // Interior terrain determined by noise
  const elevation = multiOctaveNoise(seed, coord.q, coord.r, 3);
  const moisture = multiOctaveNoise(seed + 10000, coord.q, coord.r, 3);
  const temperature = multiOctaveNoise(seed + 20000, coord.q, coord.r, 2);

  // Mountains: high elevation
  if (elevation > 0.72) return 'mountains';

  // Tundra: cold + moderate elevation
  if (temperature < 0.25 && elevation > 0.3) return 'tundra';

  // Desert: hot + low moisture
  if (temperature > 0.7 && moisture < 0.35) return 'desert';

  // Forest: high moisture
  if (moisture > 0.55) return 'forest';

  // Default: plains
  return 'plains';
}

/**
 * Calculate resource yields for a hex, adding noise variation.
 */
function assignResources(
  terrain: TerrainType,
  coord: HexCoord,
  seed: number,
): HexResources {
  const base = TERRAIN_RESOURCES[terrain];

  // Add ±1 variation per resource using noise
  const foodNoise = noiseAt(seed + 30000, coord.q, coord.r);
  const timberNoise = noiseAt(seed + 40000, coord.q, coord.r);
  const stoneNoise = noiseAt(seed + 50000, coord.q, coord.r);
  const ironNoise = noiseAt(seed + 60000, coord.q, coord.r);

  // Variation: -1 to +1
  const vary = (n: number) => Math.round(n * 2 - 1);

  return {
    food: Math.max(0, base.food + vary(foodNoise)),
    timber: Math.max(0, base.timber + vary(timberNoise)),
    stone: Math.max(0, base.stone + vary(stoneNoise)),
    iron: Math.max(0, base.iron + vary(ironNoise)),
  };
}

// --- Starting Position Selection ---

/**
 * Find suitable colony starting positions.
 * Positions are on a ring at ~70% of radius (radius ~35 for radius 50),
 * spaced at least minSpacing hexes apart, on land terrain with
 * adjacent food + timber.
 */
export function findStartingPositions(
  hexes: HexTile[],
  radius: number,
  seed: number,
  maxColonies: number = 8,
  minSpacing: number = 30,
): HexCoord[] {
  const hexMap = new Map<string, HexTile>();
  for (const hex of hexes) {
    hexMap.set(`${hex.q},${hex.r}`, hex);
  }

  // Land hexes on the spawn ring (radius * 0.65 to radius * 0.75)
  const spawnMin = Math.floor(radius * 0.65);
  const spawnMax = Math.ceil(radius * 0.75);
  const landTerrains: TerrainType[] = ['plains', 'forest', 'tundra'];

  const candidates: HexCoord[] = [];
  for (const hex of hexes) {
    const dist = hexDistanceFromOrigin(hex);
    if (dist < spawnMin || dist > spawnMax) continue;
    if (!landTerrains.includes(hex.terrain)) continue;

    // Check neighbors for food + timber access
    const neighbors = hexNeighbors(hex);
    let hasFood = false;
    let hasTimber = false;
    for (const n of neighbors) {
      const nh = hexMap.get(`${n.q},${n.r}`);
      if (nh) {
        if (nh.resources.food > 0) hasFood = true;
        if (nh.resources.timber > 0) hasTimber = true;
      }
    }

    // The hex itself also counts
    if (hex.resources.food > 0) hasFood = true;
    if (hex.resources.timber > 0) hasTimber = true;

    if (hasFood && hasTimber) {
      candidates.push({ q: hex.q, r: hex.r });
    }
  }

  // Sort candidates deterministically by seeded noise
  const rng = createRng(seed + 70000);
  const scored = candidates.map((c) => ({
    coord: c,
    score: rng(),
  }));
  scored.sort((a, b) => a.score - b.score);

  // Greedily pick positions with minimum spacing
  const positions: HexCoord[] = [];
  for (const { coord } of scored) {
    if (positions.length >= maxColonies) break;

    const tooClose = positions.some(
      (p) => hexDistance(p, coord) < minSpacing,
    );
    if (!tooClose) {
      positions.push(coord);
    }
  }

  return positions;
}

// --- Main Generation ---

/**
 * Generate the complete world map.
 * Deterministic: same seed + radius always produces the same map.
 */
export function generateWorld(
  seed: number,
  radius: number = 50,
  maxColonies: number = 8,
): WorldMap {
  const coords = hexesInRadius(radius);
  const hexes: HexTile[] = coords.map((coord) => {
    const terrain = assignTerrain(coord, radius, seed);
    const resources = assignResources(terrain, coord, seed);
    return { q: coord.q, r: coord.r, terrain, resources };
  });

  const startingPositions = findStartingPositions(hexes, radius, seed, maxColonies);

  return { seed, radius, hexes, startingPositions };
}

/**
 * Get terrain distribution stats for a generated map.
 * Useful for testing and validation.
 */
export function getTerrainStats(hexes: HexTile[]): Record<TerrainType, number> {
  const stats: Record<string, number> = {};
  for (const hex of hexes) {
    stats[hex.terrain] = (stats[hex.terrain] || 0) + 1;
  }
  return stats as Record<TerrainType, number>;
}
