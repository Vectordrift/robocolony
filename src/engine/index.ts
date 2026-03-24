// Game engine — tick resolution, map generation, combat
export { hexDistance, hexDistanceFromOrigin, hexesInRadius, hexNeighbors, hexRing } from './hex.js';
export type { HexCoord } from './hex.js';
export { createRng, noiseAt, multiOctaveNoise } from './noise.js';
export { generateWorld, findStartingPositions, getTerrainStats } from './mapgen.js';
export type { TerrainType, HexTile, HexResources, WorldMap } from './mapgen.js';
