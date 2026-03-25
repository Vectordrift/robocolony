// Game engine — tick resolution, map generation, combat, pathfinding, fog of war
export { hexDistance, hexDistanceFromOrigin, hexesInRadius, hexNeighbors, hexRing } from './hex.js';
export type { HexCoord } from './hex.js';
export { createRng, noiseAt, multiOctaveNoise } from './noise.js';
export { generateWorld, findStartingPositions, getTerrainStats } from './mapgen.js';
export type { TerrainType, HexTile, HexResources, WorldMap } from './mapgen.js';
export { resolveTick, resolveMovement, calculateProduction, calculateBuildingUpkeep, calculateUnitUpkeep, resolveAgreementActions, resolveTradeTransfers, BREAK_COSTS, PROPOSAL_EXPIRY_TICKS } from './tick.js';
export type { Colony, Settlement, Unit, HexTileState, Resources, TickResult, TickEvent, QueuedAction, ActionResult, Agreement, AgreementType, AgreementStatus, AgreementMutation, TradeTerms } from './tick.js';
export { TickScheduler } from './scheduler.js';
export type { SchedulerOptions } from './scheduler.js';
export { findPath, movementStepsThisTick, createHexLookup, TERRAIN_COST, UNIT_SPEED, VISION_RADIUS } from './pathfinding.js';
export type { HexLookup } from './pathfinding.js';
export { computeFogReveals, computeStartingReveals, hexesWithinRadius } from './fog.js';
export type { HexExploration, FogRevealResult } from './fog.js';
