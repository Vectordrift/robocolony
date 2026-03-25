/**
 * Hex pathfinding using A* algorithm with terrain-based movement costs.
 *
 * Uses axial coordinates (q, r) consistent with hex.ts.
 */
import type { HexCoord } from './hex.js';
/** Movement cost per terrain type. Infinity = impassable. */
export declare const TERRAIN_COST: Record<string, number>;
/** Maximum hexes a unit can traverse per tick (in movement cost units). */
export declare const UNIT_SPEED: Record<string, number>;
/** How far each unit type can see (in hex distance). */
export declare const VISION_RADIUS: Record<string, number>;
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
export declare function createHexLookup(hexes: Array<{
    x: number;
    y: number;
    terrain: string;
}>): HexLookup;
/**
 * Find the shortest path between two hex coordinates using A*.
 *
 * @param from - Starting hex coordinate
 * @param to - Target hex coordinate
 * @param hexLookup - Terrain lookup for the hex map
 * @returns Array of hex coordinates (excluding `from`, including `to`), or null if unreachable
 */
export declare function findPath(from: HexCoord, to: HexCoord, hexLookup: HexLookup): HexCoord[] | null;
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
export declare function movementStepsThisTick(path: HexCoord[], unitType: string, hexLookup: HexLookup): number;
//# sourceMappingURL=pathfinding.d.ts.map