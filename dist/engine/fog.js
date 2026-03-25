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
import { hexDistance } from './hex.js';
import { VISION_RADIUS } from './pathfinding.js';
// --- Core Logic ---
/**
 * Get all hex coordinates within a given radius from a center hex.
 * Returns coordinates that exist in the provided hex set.
 */
export function hexesWithinRadius(center, radius, validHexes) {
    const results = [];
    for (let q = center.q - radius; q <= center.q + radius; q++) {
        const r1 = Math.max(center.r - radius, -q - (center.q + center.r) - radius + center.q);
        const r2 = Math.min(center.r + radius, -q - (center.q + center.r) + radius + center.q);
        for (let r = center.r - radius; r <= center.r + radius; r++) {
            if (hexDistance(center, { q, r }) <= radius) {
                const key = `${q},${r}`;
                if (validHexes.has(key)) {
                    results.push({ q, r });
                }
            }
        }
    }
    return results;
}
/**
 * Compute fog-of-war reveals for units that moved this tick.
 *
 * @param movedUnits - Units that moved this tick, with their new positions
 * @param allHexCoords - Set of all valid hex coordinate keys ("q,r")
 * @param alreadyExplored - Map of "colonyId:q,r" → true for hexes already explored
 * @returns Hexes to reveal and events
 */
export function computeFogReveals(movedUnits, allHexCoords, alreadyExplored) {
    const reveals = [];
    const events = [];
    // Track newly revealed hexes per colony to avoid duplicate events
    const newRevealsPerColony = new Map();
    for (const unit of movedUnits) {
        const radius = VISION_RADIUS[unit.type] ?? 1;
        const center = { q: unit.hexX, r: unit.hexY };
        const visibleHexes = hexesWithinRadius(center, radius, allHexCoords);
        let newCount = 0;
        for (const hex of visibleHexes) {
            const exploredKey = `${unit.colonyId}:${hex.q},${hex.r}`;
            // Skip if already explored by this colony
            if (alreadyExplored.has(exploredKey))
                continue;
            // Skip if we already revealed this hex for this colony in this tick
            const colonyReveals = newRevealsPerColony.get(unit.colonyId);
            const hexKey = `${hex.q},${hex.r}`;
            if (colonyReveals?.has(hexKey))
                continue;
            reveals.push({ colonyId: unit.colonyId, hex });
            newCount++;
            // Track this reveal
            if (!newRevealsPerColony.has(unit.colonyId)) {
                newRevealsPerColony.set(unit.colonyId, new Set());
            }
            newRevealsPerColony.get(unit.colonyId).add(hexKey);
            // Mark as explored for subsequent units in same tick
            alreadyExplored.set(exploredKey, true);
        }
        if (newCount > 0) {
            events.push({
                type: 'hexes_revealed',
                colonyId: unit.colonyId,
                unitId: unit.id,
                data: {
                    unitType: unit.type,
                    position: { x: unit.hexX, y: unit.hexY },
                    radius,
                    newHexCount: newCount,
                },
            });
        }
    }
    return { reveals, events };
}
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
export function computeStartingReveals(colonyId, startHex, radius, allHexCoords) {
    const reveals = [];
    const visibleHexes = hexesWithinRadius(startHex, radius, allHexCoords);
    for (const hex of visibleHexes) {
        reveals.push({ colonyId, hex });
    }
    return reveals;
}
//# sourceMappingURL=fog.js.map