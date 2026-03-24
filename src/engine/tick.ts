/**
 * Tick engine — resolves one game tick.
 *
 * Pure function: takes world state in, returns updated state + events out.
 * No database access — the scheduler handles persistence.
 */

import type { HexCoord } from './hex.js';
import { hexNeighbors, hexDistance } from './hex.js';
import type { HexResources } from './mapgen.js';
import { findPath, movementStepsThisTick, createHexLookup } from './pathfinding.js';
import type { HexLookup } from './pathfinding.js';

// --- Types ---

export interface Colony {
  id: string;
  worldId: string;
  name: string;
  resources: Resources;
  status: string;
}

export interface Resources {
  food: number;
  timber: number;
  stone: number;
  iron: number;
  influence: number;
}

export interface Settlement {
  id: string;
  colonyId: string;
  worldId: string;
  name: string;
  hexX: number;
  hexY: number;
  tier: 'outpost' | 'town' | 'city';
  buildings: Building[];
  loyalty: number;
  population: number;
}

export interface Building {
  type: BuildingType;
  level: number;
}

export type BuildingType = 'farm' | 'lumberMill' | 'quarry' | 'mine' | 'barracks' | 'granary' | 'market';

export interface Unit {
  id: string;
  colonyId: string;
  worldId: string;
  type: UnitType;
  hexX: number;
  hexY: number;
  health: number;
  morale: number;
  movementQueue?: HexCoord[];
}

export type UnitType = 'scout' | 'militia' | 'soldier' | 'siege' | 'settler';

export interface HexTileState {
  x: number;
  y: number;
  terrain: string;
  resources: HexResources;
  settlementId: string | null;
}

export interface QueuedAction {
  id: string;
  colonyId: string;
  type: string;
  params: Record<string, unknown>;
}

export interface ActionResult {
  actionId: string;
  status: 'resolved' | 'failed';
  result?: string;
}

export interface TickEvent {
  type: string;
  colonyId?: string;
  settlementId?: string;
  unitId?: string;
  data: Record<string, unknown>;
}

export interface TickResult {
  colonies: Colony[];
  settlements: Settlement[];
  units: Unit[];
  events: TickEvent[];
  desertedUnitIds: string[];
  actionResults: ActionResult[];
}

// --- Constants ---

/** Settlement tier multipliers for production */
export const TIER_MULTIPLIER: Record<string, number> = {
  outpost: 1.0,
  town: 1.5,
  city: 2.0,
};

/** Building production per level */
export const BUILDING_PRODUCTION: Record<BuildingType, Partial<Resources>> = {
  farm:       { food: 3 },
  lumberMill: { timber: 3 },
  quarry:     { stone: 2 },
  mine:       { iron: 2 },
  barracks:   {},
  granary:    {},
  market:     { influence: 1 },
};

/** Building upkeep per level (resources consumed per tick) */
export const BUILDING_UPKEEP: Record<BuildingType, Partial<Resources>> = {
  farm:       {},
  lumberMill: {},
  quarry:     { timber: 1 },
  mine:       { timber: 1, food: 1 },
  barracks:   { food: 2, iron: 1 },
  granary:    { timber: 1 },
  market:     { food: 1 },
};

/** Unit food upkeep per tick */
export const UNIT_UPKEEP: Record<UnitType, number> = {
  scout: 1,
  militia: 1,
  soldier: 2,
  siege: 3,
  settler: 2,
};

/** Morale loss per tick when food is negative */
export const MORALE_LOSS_RATE = 0.15;

/** Morale threshold below which a unit deserts */
export const DESERTION_THRESHOLD = 0.1;

/** Morale recovery per tick when food is positive */
export const MORALE_RECOVERY_RATE = 0.05;

// --- Helpers ---

function hexKey(x: number, y: number): string {
  return `${x},${y}`;
}

// --- Movement Resolution ---

/**
 * Resolve move_unit actions: compute path and set movement queue.
 * Then advance all units with existing movement queues.
 */
export function resolveMovement(
  units: Unit[],
  actions: QueuedAction[],
  hexLookup: HexLookup,
): { units: Unit[]; events: TickEvent[]; actionResults: ActionResult[] } {
  const events: TickEvent[] = [];
  const actionResults: ActionResult[] = [];

  // Build unit lookup for ownership/existence checks
  const unitMap = new Map<string, Unit>();
  for (const u of units) {
    unitMap.set(u.id, u);
  }

  // Phase 1: Process move_unit actions — compute paths and set queues
  const moveActions = actions.filter(a => a.type === 'move_unit');

  for (const action of moveActions) {
    const unitId = action.params.unitId as string;
    const targetX = action.params.targetX as number;
    const targetY = action.params.targetY as number;

    const unit = unitMap.get(unitId);
    if (!unit) {
      actionResults.push({
        actionId: action.id,
        status: 'failed',
        result: `Unit ${unitId} not found`,
      });
      continue;
    }

    // Verify colony ownership
    if (unit.colonyId !== action.colonyId) {
      actionResults.push({
        actionId: action.id,
        status: 'failed',
        result: `Unit ${unitId} does not belong to colony ${action.colonyId}`,
      });
      continue;
    }

    const from: HexCoord = { q: unit.hexX, r: unit.hexY };
    const to: HexCoord = { q: targetX, r: targetY };

    // Cancel movement: move to current position clears queue
    if (from.q === to.q && from.r === to.r) {
      unit.movementQueue = [];
      actionResults.push({
        actionId: action.id,
        status: 'resolved',
        result: 'Movement cancelled',
      });
      events.push({
        type: 'movement_cancelled',
        colonyId: unit.colonyId,
        unitId: unit.id,
        data: { hexX: unit.hexX, hexY: unit.hexY },
      });
      continue;
    }

    // Compute path using A*
    const path = findPath(from, to, hexLookup);

    if (!path || path.length === 0) {
      actionResults.push({
        actionId: action.id,
        status: 'failed',
        result: `No path from (${from.q},${from.r}) to (${to.q},${to.r})`,
      });
      events.push({
        type: 'movement_failed',
        colonyId: unit.colonyId,
        unitId: unit.id,
        data: {
          from: { x: from.q, y: from.r },
          to: { x: to.q, y: to.r },
          reason: 'no_path',
        },
      });
      continue;
    }

    // Set (or replace) movement queue
    unit.movementQueue = path;
    actionResults.push({
      actionId: action.id,
      status: 'resolved',
      result: `Path computed: ${path.length} steps`,
    });
    events.push({
      type: 'movement_queued',
      colonyId: unit.colonyId,
      unitId: unit.id,
      data: {
        from: { x: from.q, y: from.r },
        to: { x: to.q, y: to.r },
        pathLength: path.length,
      },
    });
  }

  // Phase 2: Advance all units with movement queues
  for (const unit of units) {
    if (!unit.movementQueue || unit.movementQueue.length === 0) continue;

    const steps = movementStepsThisTick(unit.movementQueue, unit.type, hexLookup);

    if (steps === 0) {
      // Can't move (all remaining hexes impassable?) — clear queue
      unit.movementQueue = [];
      events.push({
        type: 'movement_blocked',
        colonyId: unit.colonyId,
        unitId: unit.id,
        data: {
          hexX: unit.hexX,
          hexY: unit.hexY,
          reason: 'impassable',
        },
      });
      continue;
    }

    const moved = unit.movementQueue.slice(0, steps);
    const destination = moved[moved.length - 1];

    // Move unit
    const prevX = unit.hexX;
    const prevY = unit.hexY;
    unit.hexX = destination.q;
    unit.hexY = destination.r;

    // Drain queue
    unit.movementQueue = unit.movementQueue.slice(steps);

    events.push({
      type: 'unit_moved',
      colonyId: unit.colonyId,
      unitId: unit.id,
      data: {
        from: { x: prevX, y: prevY },
        to: { x: unit.hexX, y: unit.hexY },
        steps: moved.map(s => ({ x: s.q, y: s.r })),
        remainingPath: unit.movementQueue.length,
      },
    });

    // Movement complete?
    if (unit.movementQueue.length === 0) {
      events.push({
        type: 'movement_complete',
        colonyId: unit.colonyId,
        unitId: unit.id,
        data: {
          hexX: unit.hexX,
          hexY: unit.hexY,
        },
      });
    }
  }

  return { units, events, actionResults };
}

// --- Production ---

/**
 * Calculate resource production for a single settlement.
 * Production = (sum of building output × level × tier multiplier) + (nearby hex yields × 0.5)
 */
export function calculateProduction(
  settlement: Settlement,
  nearbyHexes: HexTileState[],
): Partial<Resources> {
  const tierMult = TIER_MULTIPLIER[settlement.tier] ?? 1.0;
  const production: Resources = { food: 0, timber: 0, stone: 0, iron: 0, influence: 0 };

  // Building production
  for (const building of settlement.buildings) {
    const output = BUILDING_PRODUCTION[building.type];
    if (!output) continue;
    for (const [resource, amount] of Object.entries(output)) {
      production[resource as keyof Resources] += (amount as number) * building.level * tierMult;
    }
  }

  // Nearby hex yield bonus (hex resources within 1 ring of settlement)
  for (const hex of nearbyHexes) {
    production.food += hex.resources.food * 0.5;
    production.timber += hex.resources.timber * 0.5;
    production.stone += hex.resources.stone * 0.5;
    production.iron += hex.resources.iron * 0.5;
  }

  // Base population food production (people farm even without buildings)
  production.food += settlement.population * 0.1;

  return production;
}

/**
 * Calculate building upkeep for a settlement.
 */
export function calculateBuildingUpkeep(settlement: Settlement): Partial<Resources> {
  const upkeep: Resources = { food: 0, timber: 0, stone: 0, iron: 0, influence: 0 };

  for (const building of settlement.buildings) {
    const cost = BUILDING_UPKEEP[building.type];
    if (!cost) continue;
    for (const [resource, amount] of Object.entries(cost)) {
      upkeep[resource as keyof Resources] += (amount as number) * building.level;
    }
  }

  return upkeep;
}

/**
 * Calculate total unit upkeep for a colony.
 */
export function calculateUnitUpkeep(units: Unit[]): number {
  return units.reduce((total, unit) => total + (UNIT_UPKEEP[unit.type] ?? 0), 0);
}

// --- Tick Resolution ---

/**
 * Resolve a single game tick.
 *
 * 1. Resolve actions (movement, etc.)
 * 2. Calculate production for each settlement
 * 3. Calculate upkeep (buildings + units)
 * 4. Apply net resources to each colony
 * 5. Handle deficits: morale loss → desertion
 * 6. Handle surplus: morale recovery
 */
export function resolveTick(
  colonies: Colony[],
  settlements: Settlement[],
  units: Unit[],
  hexes: HexTileState[],
  actions: QueuedAction[] = [],
): TickResult {
  const events: TickEvent[] = [];
  const desertedUnitIds: string[] = [];
  let actionResults: ActionResult[] = [];

  // Build hex lookup
  const hexMap = new Map<string, HexTileState>();
  for (const hex of hexes) {
    hexMap.set(hexKey(hex.x, hex.y), hex);
  }

  // Deep clone units so we can mutate
  const updatedUnits = units.map(u => ({
    ...u,
    movementQueue: u.movementQueue ? [...u.movementQueue] : [],
  }));

  // --- Phase 0: Resolve actions (movement) + advance movement queues ---
  // Always run movement resolution to advance existing queues, even without new actions
  const hasMovingUnits = updatedUnits.some(u => u.movementQueue && u.movementQueue.length > 0);
  if (actions.length > 0 || hasMovingUnits) {
    const hexLookup = createHexLookup(hexes.map(h => ({ x: h.x, y: h.y, terrain: h.terrain })));
    const moveResult = resolveMovement(updatedUnits, actions, hexLookup);
    events.push(...moveResult.events);
    actionResults = moveResult.actionResults;
  }

  // Group settlements and units by colony
  const colonySettlements = new Map<string, Settlement[]>();
  const colonyUnits = new Map<string, Unit[]>();

  for (const s of settlements) {
    const list = colonySettlements.get(s.colonyId) ?? [];
    list.push(s);
    colonySettlements.set(s.colonyId, list);
  }
  for (const u of updatedUnits) {
    const list = colonyUnits.get(u.colonyId) ?? [];
    list.push(u);
    colonyUnits.set(u.colonyId, list);
  }

  // Deep clone colonies so we can mutate
  const updatedColonies = colonies.map(c => ({
    ...c,
    resources: { ...c.resources },
  }));

  const updatedSettlements = settlements.map(s => ({ ...s, buildings: [...s.buildings] }));

  for (const colony of updatedColonies) {
    if (colony.status !== 'active') continue;

    const mySettlements = colonySettlements.get(colony.id) ?? [];
    const myUnits = colonyUnits.get(colony.id) ?? [];

    // --- Production ---
    const totalProduction: Resources = { food: 0, timber: 0, stone: 0, iron: 0, influence: 0 };
    const totalUpkeep: Resources = { food: 0, timber: 0, stone: 0, iron: 0, influence: 0 };

    for (const settlement of mySettlements) {
      // Get neighboring hexes for this settlement
      const neighbors = hexNeighbors({ q: settlement.hexX, r: settlement.hexY });
      const nearbyHexes: HexTileState[] = [
        hexMap.get(hexKey(settlement.hexX, settlement.hexY)),
        ...neighbors.map(n => hexMap.get(hexKey(n.q, n.r))),
      ].filter(Boolean) as HexTileState[];

      const production = calculateProduction(settlement, nearbyHexes);
      const upkeep = calculateBuildingUpkeep(settlement);

      for (const key of Object.keys(totalProduction) as (keyof Resources)[]) {
        totalProduction[key] += (production[key] as number) ?? 0;
        totalUpkeep[key] += (upkeep[key] as number) ?? 0;
      }
    }

    // Unit food upkeep
    totalUpkeep.food += calculateUnitUpkeep(myUnits);

    // --- Apply net resources ---
    const net: Resources = { food: 0, timber: 0, stone: 0, iron: 0, influence: 0 };
    for (const key of Object.keys(net) as (keyof Resources)[]) {
      net[key] = totalProduction[key] - totalUpkeep[key];
      colony.resources[key] = Math.round((colony.resources[key] + net[key]) * 100) / 100;
    }

    events.push({
      type: 'production',
      colonyId: colony.id,
      data: {
        produced: { ...totalProduction },
        consumed: { ...totalUpkeep },
        net: { ...net },
        resources: { ...colony.resources },
      },
    });

    // --- Food deficit: morale loss ---
    if (colony.resources.food < 0) {
      events.push({
        type: 'famine',
        colonyId: colony.id,
        data: { foodDeficit: colony.resources.food },
      });

      // All units of this colony lose morale
      for (const unit of updatedUnits.filter(u => u.colonyId === colony.id)) {
        unit.morale = Math.max(0, unit.morale - MORALE_LOSS_RATE);

        if (unit.morale <= DESERTION_THRESHOLD) {
          desertedUnitIds.push(unit.id);
          events.push({
            type: 'desertion',
            colonyId: colony.id,
            unitId: unit.id,
            data: { unitType: unit.type, morale: unit.morale },
          });
        }
      }

      // Clamp food to 0 (debt doesn't carry over)
      colony.resources.food = 0;
    } else {
      // --- Surplus: morale recovery ---
      for (const unit of updatedUnits.filter(u => u.colonyId === colony.id)) {
        if (unit.morale < 1.0) {
          unit.morale = Math.min(1.0, unit.morale + MORALE_RECOVERY_RATE);
        }
      }
    }
  }

  // Remove deserted units
  const survivingUnits = updatedUnits.filter(u => !desertedUnitIds.includes(u.id));

  return {
    colonies: updatedColonies,
    settlements: updatedSettlements,
    units: survivingUnits,
    events,
    desertedUnitIds,
    actionResults,
  };
}
