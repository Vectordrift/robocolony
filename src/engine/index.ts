// Game engine — tick resolution, map generation, combat
export { hexDistance, hexDistanceFromOrigin, hexesInRadius, hexNeighbors, hexRing } from './hex.js';
export type { HexCoord } from './hex.js';
export { createRng, noiseAt, multiOctaveNoise } from './noise.js';
export { generateWorld, findStartingPositions, getTerrainStats } from './mapgen.js';
export type { TerrainType, HexTile, HexResources, WorldMap } from './mapgen.js';
export { resolveTick, calculateProduction, calculateBuildingUpkeep, calculateUnitUpkeep } from './tick.js';
export type { Colony, Settlement, Unit, HexTileState, Resources, TickResult, TickEvent } from './tick.js';
export { TickScheduler } from './scheduler.js';
export type { SchedulerOptions } from './scheduler.js';
export { findPath, pathCost, createTerrainLookup, isPassable, TERRAIN_MOVEMENT_COST } from './pathfinding.js';
export type { PathResult, TerrainLookup } from './pathfinding.js';
