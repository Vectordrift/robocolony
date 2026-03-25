// Game engine — tick resolution, map generation, combat, pathfinding, fog of war
export { hexDistance, hexDistanceFromOrigin, hexesInRadius, hexNeighbors, hexRing } from './hex.js';
export { createRng, noiseAt, multiOctaveNoise } from './noise.js';
export { generateWorld, findStartingPositions, getTerrainStats } from './mapgen.js';
export { resolveTick, resolveMovement, calculateProduction, calculateBuildingUpkeep, calculateUnitUpkeep, resolveAgreements, isAttackBlockedByNAP } from './tick.js';
export { TickScheduler } from './scheduler.js';
export { findPath, movementStepsThisTick, createHexLookup, TERRAIN_COST, UNIT_SPEED, VISION_RADIUS } from './pathfinding.js';
export { computeFogReveals, computeStartingReveals, hexesWithinRadius } from './fog.js';
//# sourceMappingURL=index.js.map