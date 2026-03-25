/**
 * Fog of war — hex exploration and visibility.
 *
 * When units move, they reveal hexes around them based on their vision radius.
 * Scout units see further (radius 3), other units see radius 1.
 * Revealed hexes are tracked per-colony in the hex `explored_by` array.
 *
 * Pure function: takes unit positions + hex coordinates, returns list of
 * hexes to reveal per colony. The caller handles persistence.
 */
import type { HexCoord } from './hex.js';
import type { Unit, TickEvent } from './tick.js';
export interface HexExploration {
    /** Colony ID that should see this hex */
    colonyId: string;
    /** Hex coordinate to reveal */
    hex: HexCoord;
}
export interface FogRevealResult {
    /** Hexes to mark as explored (may contain duplicates — caller should dedupe) */
    reveals: HexExploration[];
    /** Events describing what was revealed */
    events: TickEvent[];
}
/**
 * Get all hex coordinates within a given radius from a center hex.
 * Returns coordinates that exist in the provided hex set.
 */
export declare function hexesWithinRadius(center: HexCoord, radius: number, validHexes: Set<string>): HexCoord[];
/** Info about entities on the map, used for scouting reports */
export interface MapIntel {
    /** Map of "q,r" → colonyId for enemy settlements */
    settlementHexes: Map<string, {
        colonyId: string;
        name: string;
    }>;
    /** Map of "q,r" → array of enemy units */
    unitHexes: Map<string, Array<{
        colonyId: string;
        type: string;
    }>>;
}
/**
 * Compute fog-of-war reveals for units that moved this tick.
 *
 * @param movedUnits - Units that moved this tick, with their new positions
 * @param allHexCoords - Set of all valid hex coordinate keys ("q,r")
 * @param alreadyExplored - Map of "colonyId:q,r" → true for hexes already explored
 * @param intel - Optional map intel for scouting reports
 * @returns Hexes to reveal and events
 */
export declare function computeFogReveals(movedUnits: Unit[], allHexCoords: Set<string>, alreadyExplored: Map<string, boolean>, intel?: MapIntel): FogRevealResult;
/**
 * Compute initial fog reveal for a new colony's starting position.
 * Uses the same logic as unit movement but with a fixed radius.
 *
 * @param colonyId - The new colony's ID
 * @param startHex - Starting hex coordinate
 * @param radius - Reveal radius (typically 5 for starting position)
 * @param allHexCoords - Set of all valid hex coordinate keys
 * @returns Hexes to reveal
 */
export declare function computeStartingReveals(colonyId: string, startHex: HexCoord, radius: number, allHexCoords: Set<string>): HexExploration[];
//# sourceMappingURL=fog.d.ts.map