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
import { hexDistance } from './hex.js';
import { VISION_RADIUS } from './pathfinding.js';
import type { Unit, TickEvent } from './tick.js';

// --- Types ---

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

// --- Core Logic ---

/**
 * Get all hex coordinates within a given radius from a center hex.
 * Returns coordinates that exist in the provided hex set.
 */
export function hexesWithinRadius(
  center: HexCoord,
  radius: number,
  validHexes: Set<string>,
): HexCoord[] {
  const results: HexCoord[] = [];
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

/** Info about entities on the map, used for scouting reports */
export interface MapIntel {
  /** Map of "q,r" → colonyId for enemy settlements */
  settlementHexes: Map<string, { colonyId: string; name: string }>;
  /** Map of "q,r" → array of enemy units */
  unitHexes: Map<string, Array<{ colonyId: string; type: string }>>;
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
export function computeFogReveals(
  movedUnits: Unit[],
  allHexCoords: Set<string>,
  alreadyExplored: Map<string, boolean>,
  intel?: MapIntel,
): FogRevealResult {
  const reveals: HexExploration[] = [];
  const events: TickEvent[] = [];

  // Track newly revealed hexes per colony to avoid duplicate events
  const newRevealsPerColony = new Map<string, Set<string>>();

  for (const unit of movedUnits) {
    const radius = VISION_RADIUS[unit.type] ?? 1;
    const center: HexCoord = { q: unit.hexX, r: unit.hexY };

    const visibleHexes = hexesWithinRadius(center, radius, allHexCoords);

    let newCount = 0;
    for (const hex of visibleHexes) {
      const exploredKey = `${unit.colonyId}:${hex.q},${hex.r}`;

      // Skip if already explored by this colony
      if (alreadyExplored.has(exploredKey)) continue;

      // Skip if we already revealed this hex for this colony in this tick
      const colonyReveals = newRevealsPerColony.get(unit.colonyId);
      const hexKey = `${hex.q},${hex.r}`;
      if (colonyReveals?.has(hexKey)) continue;

      reveals.push({ colonyId: unit.colonyId, hex });
      newCount++;

      // Track this reveal
      if (!newRevealsPerColony.has(unit.colonyId)) {
        newRevealsPerColony.set(unit.colonyId, new Set());
      }
      newRevealsPerColony.get(unit.colonyId)!.add(hexKey);

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

      // Scouting reports: check newly revealed hexes for enemy presence
      if (intel) {
        const colonyReveals = newRevealsPerColony.get(unit.colonyId);
        if (colonyReveals) {
          for (const hexKey of colonyReveals) {
            // Enemy settlement discovered
            const settlement = intel.settlementHexes.get(hexKey);
            if (settlement && settlement.colonyId !== unit.colonyId) {
              events.push({
                type: 'enemy_settlement_discovered',
                colonyId: unit.colonyId,
                data: {
                  enemyColonyId: settlement.colonyId,
                  settlementName: settlement.name,
                  scoutUnitId: unit.id,
                  scoutUnitType: unit.type,
                },
              });
            }

            // Enemy units discovered
            const enemyUnits = intel.unitHexes.get(hexKey);
            if (enemyUnits) {
              const foreignUnits = enemyUnits.filter(u => u.colonyId !== unit.colonyId);
              if (foreignUnits.length > 0) {
                events.push({
                  type: 'enemy_units_discovered',
                  colonyId: unit.colonyId,
                  data: {
                    enemyColonyId: foreignUnits[0].colonyId,
                    unitCount: foreignUnits.length,
                    unitTypes: [...new Set(foreignUnits.map(u => u.type))],
                    scoutUnitId: unit.id,
                    scoutUnitType: unit.type,
                  },
                });
              }
            }
          }
        }
      }
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
export function computeStartingReveals(
  colonyId: string,
  startHex: HexCoord,
  radius: number,
  allHexCoords: Set<string>,
): HexExploration[] {
  const reveals: HexExploration[] = [];
  const visibleHexes = hexesWithinRadius(startHex, radius, allHexCoords);

  for (const hex of visibleHexes) {
    reveals.push({ colonyId, hex });
  }

  return reveals;
}
