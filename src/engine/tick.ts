


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
import { computeFogReveals, hexesWithinRadius } from './fog.js';
import type { HexExploration } from './fog.js';

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
  buildQueue: BuildQueueEntry[];
  loyalty: number;
  population: number;
}

export interface Building {
  type: BuildingType;
  level: number;
}

export interface BuildQueueEntry {
  type: BuildingType;
  ticksRemaining: number;
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
  idleTicks?: number;
}

export type UnitType = 'scout' | 'militia' | 'soldier' | 'siege' | 'settler';

export interface HexTileState {
  x: number;
  y: number;
  terrain: string;
  resources: HexResources;
  settlementId: string | null;
  exploredBy?: string[];
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
  fogReveals: HexExploration[];
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
  farm:       { food: 15 },
  lumberMill: { timber: 3 },
  quarry:     { stone: 4 },
  mine:       { iron: 3 },
  barracks:   {},
  granary:    {},
  market:     { influence: 2 },
};

/** Building upkeep per level (resources consumed per tick) */
export const BUILDING_UPKEEP: Record<BuildingType, Partial<Resources>> = {
  farm:       { timber: 2 },
  lumberMill: { timber: 2, stone: 1 },
  quarry:     { timber: 2 },
  mine:       { timber: 2, food: 1 },
  barracks:   { food: 2, iron: 2, timber: 1 },
  granary:    { timber: 1 },
  market:     { food: 1, timber: 1 },
};

/** Building construction costs */
export const BUILDING_COSTS: Record<BuildingType, Partial<Resources>> = {
  farm:       { timber: 20 },
  lumberMill: { timber: 10, stone: 10 },
  quarry:     { stone: 20, iron: 10 },
  mine:       { stone: 30, timber: 20 },
  barracks:   { timber: 40, stone: 20, iron: 10 },
  granary:    { timber: 25, stone: 10 },
  market:     { stone: 30, timber: 15, iron: 5 },
};

/** Maximum building level */
export const MAX_BUILDING_LEVEL = 3;

/** Building upgrade time in ticks (same as construction) */
export const UPGRADE_BUILD_TIME = 3;

/**
 * Calculate upgrade cost for a building at the given level.
 * Upgrading from level N to N+1 costs: base_cost × N (escalating).
 */
export function buildingUpgradeCost(type: BuildingType, currentLevel: number): Partial<Resources> {
  const base = BUILDING_COSTS[type];
  const cost: Partial<Resources> = {};
  for (const [key, amount] of Object.entries(base)) {
    cost[key as keyof Resources] = (amount as number) * (currentLevel + 1);
  }
  return cost;
}

/** Ticks required to construct any building */
export const BUILD_TIME = 3;

/** All valid building types */
export const VALID_BUILDING_TYPES: BuildingType[] = [
  'farm', 'lumberMill', 'quarry', 'mine', 'barracks', 'granary', 'market',
];

/** Unit food upkeep per tick */
export const UNIT_UPKEEP: Record<UnitType, number> = {
  scout: 0.5,
  militia: 1.5,
  soldier: 3,
  siege: 4,
  settler: 3,
};

/** Population food consumption per person per tick */
export const POP_FOOD_CONSUMPTION = 0.4;

/** Unit training costs (resources needed to recruit) */
export const UNIT_TRAINING_COSTS: Record<UnitType, Partial<Resources>> = {
  scout:   { food: 10, timber: 5 },
  militia:  { food: 15, timber: 10, iron: 5 },
  soldier:  { food: 25, timber: 10, iron: 15 },
  siege:    { food: 40, timber: 20, iron: 30, stone: 10 },
  settler:  { food: 50, timber: 30 },
};

/** All valid unit types for training */
export const VALID_UNIT_TYPES: UnitType[] = ['scout', 'militia', 'soldier', 'siege', 'settler'];

/** Base morale loss per tick when food is negative (scaled by deficit severity) */
export const MORALE_LOSS_RATE = 0.03;

/** Morale threshold below which a unit may desert */
export const DESERTION_THRESHOLD = 0.2;

/** Probability a unit deserts each tick when at or below DESERTION_THRESHOLD */
export const DESERTION_CHANCE = 0.3;

/** Morale level at which a warning event fires (before desertion) */
export const MORALE_WARNING_THRESHOLD = 0.4;

/** Maximum morale loss multiplier from deficit severity */
export const MAX_DEFICIT_MULTIPLIER = 3.0;

/** Morale recovery per tick when food is positive */
export const MORALE_RECOVERY_RATE = 0.10;

/** Ticks of inactivity before emitting idle unit warning */
export const IDLE_WARNING_TICKS = 3;

/** Resource cost to found a new settlement */
export const FOUNDING_COST: Partial<Resources> = {
  food: 100,
  timber: 50,
};

/** Minimum hex distance between any two settlements */
export const MIN_SETTLEMENT_DISTANCE = 3;

/** Fog reveal radius for a newly founded settlement */
export const FOUNDING_REVEAL_RADIUS = 2;

/** Terrains where settlements cannot be founded */

/** Settlement upgrade requirements */
export const UPGRADE_COSTS: Record<string, { resources: Partial<Resources>; minPopulation: number; minBuildings: number }> = {
  town: {
    resources: { food: 200, timber: 150, stone: 100, influence: 25 },
    minPopulation: 50,
    minBuildings: 3,
  },
  city: {
    resources: { food: 500, timber: 300, stone: 200, iron: 100, influence: 75 },
    minPopulation: 200,
    minBuildings: 5,
  },
};

/** Settlement tier progression order */
export const TIER_ORDER: string[] = ['outpost', 'town', 'city'];

/** Maximum population per settlement tier */
export const MAX_POPULATION: Record<string, number> = {
  outpost: 50,
  town: 200,
  city: 1000,
};

/** Population growth rate: +1 per this many excess food */
export const POP_GROWTH_PER_FOOD = 5;

/** Stockpile capacity per settlement tier (per resource) */
export const STOCKPILE_CAP: Record<string, number> = {
  outpost: 300,
  town: 600,
  city: 1200,
};

/** Additional stockpile capacity per granary level */
export const GRANARY_BONUS_PER_LEVEL = 100;

/** Fraction of excess resources that decay each tick (10%) */
export const STOCKPILE_DECAY_RATE = 0.10;

/** Fraction of building cost refunded on demolish (25%) */
export const DEMOLISH_REFUND_RATE = 0.25;

/** Chance per tick per building to decay when colony food is at 0 */
export const DECAY_CHANCE_PER_BUILDING = 0.10;
const UNFOUNDABLE_TERRAIN = new Set(['ocean', 'mountains']);

// --- Helpers ---

function hexKey(x: number, y: number): string {
  return `${x},${y}`;
}

/**
 * Check if a colony has enough resources for a cost.
 */
function hasResources(resources: Resources, cost: Partial<Resources>): boolean {
  for (const [key, amount] of Object.entries(cost)) {
    if ((amount as number) > 0 && resources[key as keyof Resources] < (amount as number)) {
      return false;
    }
  }
  return true;
}

/**
 * Deduct a resource cost from colony resources.
 */
function deductResources(resources: Resources, cost: Partial<Resources>): void {
  for (const [key, amount] of Object.entries(cost)) {
    if ((amount as number) > 0) {
      resources[key as keyof Resources] -= amount as number;
    }
  }
}

// --- Building Construction ---

export interface BuildResult {
  settlements: Settlement[];
  events: TickEvent[];
  actionResults: ActionResult[];
}

/**
 * Resolve build actions: validate and queue new buildings.
 * Then advance all existing build queues (decrement ticksRemaining,
 * move completed buildings to the buildings array).
 */
export function resolveBuilding(
  settlements: Settlement[],
  colonies: Colony[],
  actions: QueuedAction[],
): BuildResult {
  const events: TickEvent[] = [];
  const actionResults: ActionResult[] = [];

  // Build lookups
  const settlementMap = new Map<string, Settlement>();
  for (const s of settlements) {
    settlementMap.set(s.id, s);
  }
  const colonyMap = new Map<string, Colony>();
  for (const c of colonies) {
    colonyMap.set(c.id, c);
  }

  // Phase 1: Process build actions — validate and add to build queue
  const buildActions = actions.filter(a => a.type === 'build');

  for (const action of buildActions) {
    const settlementId = action.params.settlementId as string;
    const buildingType = action.params.buildingType as string;

    // 1. Settlement exists
    const settlement = settlementMap.get(settlementId);
    if (!settlement) {
      actionResults.push({
        actionId: action.id,
        status: 'failed',
        result: `Settlement ${settlementId} not found`,
      });
      continue;
    }

    // 2. Colony ownership
    if (settlement.colonyId !== action.colonyId) {
      actionResults.push({
        actionId: action.id,
        status: 'failed',
        result: `Settlement ${settlementId} does not belong to colony ${action.colonyId}`,
      });
      continue;
    }

    // 3. Valid building type
    if (!VALID_BUILDING_TYPES.includes(buildingType as BuildingType)) {
      actionResults.push({
        actionId: action.id,
        status: 'failed',
        result: `Invalid building type: ${buildingType}. Valid types: ${VALID_BUILDING_TYPES.join(', ')}`,
      });
      continue;
    }

    const bType = buildingType as BuildingType;

    // 4. Settlement doesn't already have this building type
    if (settlement.buildings.some(b => b.type === bType)) {
      actionResults.push({
        actionId: action.id,
        status: 'failed',
        result: `Settlement ${settlementId} already has a ${bType}`,
      });
      continue;
    }

    // 5. Not already in build queue
    if (settlement.buildQueue.some(bq => bq.type === bType)) {
      actionResults.push({
        actionId: action.id,
        status: 'failed',
        result: `${bType} is already in the build queue for settlement ${settlementId}`,
      });
      continue;
    }

    // 6. Colony has enough resources
    const colony = colonyMap.get(action.colonyId);
    if (!colony) {
      actionResults.push({
        actionId: action.id,
        status: 'failed',
        result: `Colony ${action.colonyId} not found`,
      });
      continue;
    }

    const cost = BUILDING_COSTS[bType];
    if (!hasResources(colony.resources, cost)) {
      const costStr = Object.entries(cost)
        .filter(([, v]) => (v as number) > 0)
        .map(([k, v]) => `${v} ${k}`)
        .join(', ');
      actionResults.push({
        actionId: action.id,
        status: 'failed',
        result: `Insufficient resources for ${bType}: need ${costStr}`,
      });
      continue;
    }

    // --- All checks passed: deduct resources and add to build queue ---
    deductResources(colony.resources, cost);

    settlement.buildQueue.push({
      type: bType,
      ticksRemaining: BUILD_TIME,
    });

    events.push({
      type: 'build_started',
      colonyId: action.colonyId,
      settlementId: settlement.id,
      data: {
        buildingType: bType,
        ticksRemaining: BUILD_TIME,
        cost,
      },
    });

    actionResults.push({
      actionId: action.id,
      status: 'resolved',
      result: `${bType} construction started at ${settlement.name} (${BUILD_TIME} ticks)`,
    });
  }

  // Phase 2: Advance all build queues (decrement ticksRemaining)
  for (const settlement of settlements) {
    if (settlement.buildQueue.length === 0) continue;

    const completed: BuildQueueEntry[] = [];
    const remaining: BuildQueueEntry[] = [];

    for (const entry of settlement.buildQueue) {
      const newTicks = entry.ticksRemaining - 1;
      if (newTicks <= 0) {
        completed.push(entry);
      } else {
        remaining.push({ ...entry, ticksRemaining: newTicks });
      }
    }

    // Move completed buildings to buildings array (or upgrade existing)
    for (const entry of completed) {
      const existing = settlement.buildings.find(b => b.type === entry.type);
      if (existing) {
        // This is a building upgrade — increment level
        existing.level += 1;
        events.push({
          type: 'upgrade_complete',
          colonyId: settlement.colonyId,
          settlementId: settlement.id,
          data: {
            buildingType: entry.type,
            level: existing.level,
          },
        });
      } else {
        // New building construction
        settlement.buildings.push({ type: entry.type, level: 1 });
        events.push({
          type: 'build_complete',
          colonyId: settlement.colonyId,
          settlementId: settlement.id,
          data: {
            buildingType: entry.type,
            level: 1,
          },
        });
      }
    }

    settlement.buildQueue = remaining;
  }

  return { settlements, events, actionResults };
}

// --- Building Upgrade ---

export interface UpgradeBuildingResult {
  events: TickEvent[];
  actionResults: ActionResult[];
}

/**
 * Resolve upgrade_building actions: increase building level.
 *
 * Validates:
 * - Settlement exists and belongs to the colony
 * - Building exists in the settlement
 * - Building is not already at max level
 * - Building is not currently in the upgrade queue
 * - Colony has enough resources (escalating cost)
 *
 * On success: resources deducted, building added to upgrade queue.
 * Upgrade queue entries are processed alongside build queue.
 */
export function resolveUpgradeBuilding(
  settlements: Settlement[],
  colonies: Colony[],
  actions: QueuedAction[],
): UpgradeBuildingResult {
  const events: TickEvent[] = [];
  const actionResults: ActionResult[] = [];

  const upgradeActions = actions.filter(a => a.type === 'upgrade_building');
  if (upgradeActions.length === 0) {
    return { events, actionResults };
  }

  // Build lookups
  const settlementMap = new Map<string, Settlement>();
  for (const s of settlements) {
    settlementMap.set(s.id, s);
  }
  const colonyMap = new Map<string, Colony>();
  for (const c of colonies) {
    colonyMap.set(c.id, c);
  }

  for (const action of upgradeActions) {
    const settlementId = action.params.settlementId as string;
    const buildingType = action.params.buildingType as string;

    // 1. Settlement exists
    const settlement = settlementMap.get(settlementId);
    if (!settlement) {
      actionResults.push({
        actionId: action.id,
        status: 'failed',
        result: `Settlement ${settlementId} not found`,
      });
      continue;
    }

    // 2. Colony ownership
    if (settlement.colonyId !== action.colonyId) {
      actionResults.push({
        actionId: action.id,
        status: 'failed',
        result: `Settlement ${settlementId} does not belong to colony ${action.colonyId}`,
      });
      continue;
    }

    // 3. Valid building type
    if (!VALID_BUILDING_TYPES.includes(buildingType as BuildingType)) {
      actionResults.push({
        actionId: action.id,
        status: 'failed',
        result: `Invalid building type: ${buildingType}`,
      });
      continue;
    }

    const bType = buildingType as BuildingType;

    // 4. Building exists in settlement
    const building = settlement.buildings.find(b => b.type === bType);
    if (!building) {
      actionResults.push({
        actionId: action.id,
        status: 'failed',
        result: `Settlement ${settlementId} does not have a ${bType}`,
      });
      continue;
    }

    // 5. Not already at max level
    if (building.level >= MAX_BUILDING_LEVEL) {
      actionResults.push({
        actionId: action.id,
        status: 'failed',
        result: `${bType} is already at maximum level (${MAX_BUILDING_LEVEL})`,
      });
      continue;
    }

    // 6. Not already in upgrade queue (buildQueue tracks upgrades too)
    if (settlement.buildQueue.some(bq => bq.type === bType)) {
      actionResults.push({
        actionId: action.id,
        status: 'failed',
        result: `${bType} is already being upgraded in settlement ${settlementId}`,
      });
      continue;
    }

    // 7. Colony has enough resources
    const colony = colonyMap.get(action.colonyId);
    if (!colony) {
      actionResults.push({
        actionId: action.id,
        status: 'failed',
        result: `Colony ${action.colonyId} not found`,
      });
      continue;
    }

    const cost = buildingUpgradeCost(bType, building.level);
    if (!hasResources(colony.resources, cost)) {
      const costStr = Object.entries(cost)
        .filter(([, v]) => (v as number) > 0)
        .map(([k, v]) => `${v} ${k}`)
        .join(', ');
      actionResults.push({
        actionId: action.id,
        status: 'failed',
        result: `Insufficient resources to upgrade ${bType} to level ${building.level + 1}: need ${costStr}`,
      });
      continue;
    }

    // --- All checks passed: deduct resources and queue upgrade ---
    deductResources(colony.resources, cost);

    // Add to build queue — when it completes, the building level will be incremented
    settlement.buildQueue.push({
      type: bType,
      ticksRemaining: UPGRADE_BUILD_TIME,
    });

    events.push({
      type: 'upgrade_started',
      colonyId: action.colonyId,
      settlementId: settlement.id,
      data: {
        buildingType: bType,
        fromLevel: building.level,
        toLevel: building.level + 1,
        ticksRemaining: UPGRADE_BUILD_TIME,
        cost,
      },
    });

    actionResults.push({
      actionId: action.id,
      status: 'resolved',
      result: `${bType} upgrade to level ${building.level + 1} started at ${settlement.name} (${UPGRADE_BUILD_TIME} ticks)`,
    });
  }

  return { events, actionResults };
}

// --- Demolish ---

export interface DemolishResult {
  events: TickEvent[];
  actionResults: ActionResult[];
}

/**
 * Resolve demolish actions: remove a building from a settlement and refund 25% of cost.
 *
 * Validates:
 * - Settlement exists and belongs to the colony
 * - Building type is valid and exists in the settlement
 *
 * On success: building removed, partial refund credited, event emitted.
 */
export function resolveDemolish(
  settlements: Settlement[],
  colonies: Colony[],
  actions: QueuedAction[],
): DemolishResult {
  const events: TickEvent[] = [];
  const actionResults: ActionResult[] = [];

  const demolishActions = actions.filter(a => a.type === 'demolish');
  if (demolishActions.length === 0) {
    return { events, actionResults };
  }

  // Build lookups
  const settlementMap = new Map<string, Settlement>();
  for (const s of settlements) {
    settlementMap.set(s.id, s);
  }
  const colonyMap = new Map<string, Colony>();
  for (const c of colonies) {
    colonyMap.set(c.id, c);
  }

  for (const action of demolishActions) {
    const settlementId = action.params.settlementId as string;
    const buildingType = action.params.buildingType as string;

    // 1. Settlement exists
    const settlement = settlementMap.get(settlementId);
    if (!settlement) {
      actionResults.push({
        actionId: action.id,
        status: 'failed',
        result: `Settlement ${settlementId} not found`,
      });
      continue;
    }

    // 2. Colony ownership
    if (settlement.colonyId !== action.colonyId) {
      actionResults.push({
        actionId: action.id,
        status: 'failed',
        result: `Settlement ${settlementId} does not belong to colony ${action.colonyId}`,
      });
      continue;
    }

    // 3. Valid building type
    if (!VALID_BUILDING_TYPES.includes(buildingType as BuildingType)) {
      actionResults.push({
        actionId: action.id,
        status: 'failed',
        result: `Invalid building type: ${buildingType}`,
      });
      continue;
    }

    const bType = buildingType as BuildingType;

    // 4. Building exists in settlement
    const buildingIndex = settlement.buildings.findIndex(b => b.type === bType);
    if (buildingIndex === -1) {
      actionResults.push({
        actionId: action.id,
        status: 'failed',
        result: `Settlement ${settlementId} does not have a ${bType}`,
      });
      continue;
    }

    const building = settlement.buildings[buildingIndex];
    const colony = colonyMap.get(action.colonyId);
    if (!colony) {
      actionResults.push({
        actionId: action.id,
        status: 'failed',
        result: `Colony ${action.colonyId} not found`,
      });
      continue;
    }

    // --- All checks passed: remove building and refund ---

    // Calculate refund: 25% of total cost (base cost × level for upgraded buildings)
    const baseCost = BUILDING_COSTS[bType];
    const refund: Partial<Resources> = {};
    for (const [key, amount] of Object.entries(baseCost)) {
      const totalCost = (amount as number) * building.level;
      refund[key as keyof Resources] = Math.floor(totalCost * DEMOLISH_REFUND_RATE);
    }

    // Credit refund
    for (const [key, amount] of Object.entries(refund)) {
      if ((amount as number) > 0) {
        colony.resources[key as keyof Resources] += amount as number;
      }
    }

    // Remove building
    settlement.buildings.splice(buildingIndex, 1);

    // Also remove any pending build queue entries for this building type
    settlement.buildQueue = settlement.buildQueue.filter(bq => bq.type !== bType);

    events.push({
      type: 'building_demolished',
      colonyId: action.colonyId,
      settlementId: settlement.id,
      data: {
        buildingType: bType,
        level: building.level,
        refund,
      },
    });

    actionResults.push({
      actionId: action.id,
      status: 'resolved',
      result: `${bType} (level ${building.level}) demolished at ${settlement.name}`,
    });
  }

  return { events, actionResults };
}

// --- Settlement Founding ---

export interface FoundSettlementResult {
  /** Units remaining after consuming settlers */
  units: Unit[];
  /** New settlements created this tick */
  newSettlements: Settlement[];
  /** IDs of consumed settler units */
  consumedUnitIds: string[];
  events: TickEvent[];
  actionResults: ActionResult[];
  /** Fog reveals from newly founded settlements */
  fogReveals: HexExploration[];
}

/**
 * Resolve found_settlement actions.
 *
 * Validates:
 * - Unit exists and belongs to the colony
 * - Unit is a settler
 * - Hex terrain is foundable (not ocean/mountains)
 * - Hex has no existing settlement
 * - Hex is at least MIN_SETTLEMENT_DISTANCE from all other settlements
 * - Colony has enough resources (food + timber)
 *
 * On success: settler consumed, outpost created, resources deducted, fog revealed.
 */
export function resolveFoundSettlement(
  units: Unit[],
  colonies: Colony[],
  settlements: Settlement[],
  hexes: HexTileState[],
  actions: QueuedAction[],
  allHexCoords: Set<string>,
): FoundSettlementResult {
  const events: TickEvent[] = [];
  const actionResults: ActionResult[] = [];
  const newSettlements: Settlement[] = [];
  const consumedUnitIds: string[] = [];
  const fogReveals: HexExploration[] = [];

  const foundActions = actions.filter(a => a.type === 'found_settlement');
  if (foundActions.length === 0) {
    return { units, newSettlements, consumedUnitIds, events, actionResults, fogReveals };
  }

  // Build lookups
  const unitMap = new Map<string, Unit>();
  for (const u of units) {
    unitMap.set(u.id, u);
  }
  const colonyMap = new Map<string, Colony>();
  for (const c of colonies) {
    colonyMap.set(c.id, c);
  }
  const hexMap = new Map<string, HexTileState>();
  for (const hex of hexes) {
    hexMap.set(hexKey(hex.x, hex.y), hex);
  }

  // Collect all existing settlements + newly created ones (for distance checks)
  const allSettlementPositions: HexCoord[] = settlements.map(s => ({ q: s.hexX, r: s.hexY }));

  for (const action of foundActions) {
    const unitId = action.params.unitId as string;
    const settlementName = action.params.name as string;

    // 1. Unit exists
    const unit = unitMap.get(unitId);
    if (!unit) {
      actionResults.push({
        actionId: action.id,
        status: 'failed',
        result: `Unit ${unitId} not found`,
      });
      continue;
    }

    // 2. Colony ownership
    if (unit.colonyId !== action.colonyId) {
      actionResults.push({
        actionId: action.id,
        status: 'failed',
        result: `Unit ${unitId} does not belong to colony ${action.colonyId}`,
      });
      continue;
    }

    // 3. Unit is a settler
    if (unit.type !== 'settler') {
      actionResults.push({
        actionId: action.id,
        status: 'failed',
        result: `Unit ${unitId} is a ${unit.type}, not a settler`,
      });
      continue;
    }

    // 4. Unit not already consumed this tick
    if (consumedUnitIds.includes(unit.id)) {
      actionResults.push({
        actionId: action.id,
        status: 'failed',
        result: `Unit ${unitId} was already consumed this tick`,
      });
      continue;
    }

    // 5. Hex terrain is foundable
    const hex = hexMap.get(hexKey(unit.hexX, unit.hexY));
    if (!hex) {
      actionResults.push({
        actionId: action.id,
        status: 'failed',
        result: `Hex (${unit.hexX},${unit.hexY}) not found`,
      });
      continue;
    }

    if (UNFOUNDABLE_TERRAIN.has(hex.terrain)) {
      actionResults.push({
        actionId: action.id,
        status: 'failed',
        result: `Cannot found settlement on ${hex.terrain} terrain`,
      });
      continue;
    }

    // 6. No existing settlement on this hex
    if (hex.settlementId) {
      actionResults.push({
        actionId: action.id,
        status: 'failed',
        result: `Hex (${unit.hexX},${unit.hexY}) already has a settlement`,
      });
      continue;
    }

    // 7. Minimum distance from all other settlements
    const settlerPos: HexCoord = { q: unit.hexX, r: unit.hexY };
    const tooClose = allSettlementPositions.some(
      pos => hexDistance(settlerPos, pos) < MIN_SETTLEMENT_DISTANCE,
    );
    if (tooClose) {
      actionResults.push({
        actionId: action.id,
        status: 'failed',
        result: `Too close to an existing settlement (minimum distance: ${MIN_SETTLEMENT_DISTANCE})`,
      });
      continue;
    }

    // 8. Colony has enough resources
    const colony = colonyMap.get(action.colonyId);
    if (!colony) {
      actionResults.push({
        actionId: action.id,
        status: 'failed',
        result: `Colony ${action.colonyId} not found`,
      });
      continue;
    }

    const foodCost = FOUNDING_COST.food ?? 0;
    const timberCost = FOUNDING_COST.timber ?? 0;

    if (colony.resources.food < foodCost || colony.resources.timber < timberCost) {
      actionResults.push({
        actionId: action.id,
        status: 'failed',
        result: `Insufficient resources: need ${foodCost} food and ${timberCost} timber (have ${colony.resources.food} food, ${colony.resources.timber} timber)`,
      });
      continue;
    }

    // --- All checks passed: found the settlement ---

    // Deduct resources
    colony.resources.food -= foodCost;
    colony.resources.timber -= timberCost;

    // Create new settlement
    const newSettlement: Settlement = {
      id: `settlement_${unit.hexX}_${unit.hexY}_${Date.now()}`,
      colonyId: unit.colonyId,
      worldId: unit.worldId,
      name: settlementName || `Outpost at (${unit.hexX},${unit.hexY})`,
      hexX: unit.hexX,
      hexY: unit.hexY,
      tier: 'outpost',
      buildings: [],
      buildQueue: [],
      loyalty: 100,
      population: 10,
    };
    newSettlements.push(newSettlement);

    // Track position for subsequent distance checks
    allSettlementPositions.push(settlerPos);

    // Mark settler as consumed
    consumedUnitIds.push(unit.id);

    // Fog reveal around new settlement
    const revealedHexes = hexesWithinRadius(settlerPos, FOUNDING_REVEAL_RADIUS, allHexCoords);
    for (const rHex of revealedHexes) {
      fogReveals.push({ colonyId: unit.colonyId, hex: rHex });
    }

    // Events
    events.push({
      type: 'settlement_founded',
      colonyId: unit.colonyId,
      settlementId: newSettlement.id,
      unitId: unit.id,
      data: {
        name: newSettlement.name,
        hexX: unit.hexX,
        hexY: unit.hexY,
        tier: 'outpost',
        population: 10,
        resourceCost: { food: foodCost, timber: timberCost },
      },
    });

    actionResults.push({
      actionId: action.id,
      status: 'resolved',
      result: `Settlement "${newSettlement.name}" founded at (${unit.hexX},${unit.hexY})`,
    });
  }

  // Remove consumed settlers
  const remainingUnits = units.filter(u => !consumedUnitIds.includes(u.id));

  return { units: remainingUnits, newSettlements, consumedUnitIds, events, actionResults, fogReveals };
}

// --- Unit Training ---

export interface TrainUnitResult {
  newUnits: Unit[];
  events: TickEvent[];
  actionResults: ActionResult[];
}

/**
 * Resolve train_unit actions: recruit new units at settlements with barracks.
 *
 * Validates:
 * - Settlement exists and belongs to the colony
 * - Settlement has a barracks building
 * - Valid unit type
 * - Colony has enough resources
 *
 * On success: resources deducted, new unit created at settlement hex.
 */
export function resolveTrainUnit(
  colonies: Colony[],
  settlements: Settlement[],
  actions: QueuedAction[],
): TrainUnitResult {
  const events: TickEvent[] = [];
  const actionResults: ActionResult[] = [];
  const newUnits: Unit[] = [];

  const trainActions = actions.filter(a => a.type === 'train_unit');
  if (trainActions.length === 0) {
    return { newUnits, events, actionResults };
  }

  // Build lookups
  const settlementMap = new Map<string, Settlement>();
  for (const s of settlements) {
    settlementMap.set(s.id, s);
  }
  const colonyMap = new Map<string, Colony>();
  for (const c of colonies) {
    colonyMap.set(c.id, c);
  }

  for (const action of trainActions) {
    const settlementId = action.params.settlementId as string;
    const unitType = action.params.unitType as string;

    // 1. Settlement exists
    const settlement = settlementMap.get(settlementId);
    if (!settlement) {
      actionResults.push({
        actionId: action.id,
        status: 'failed',
        result: `Settlement ${settlementId} not found`,
      });
      continue;
    }

    // 2. Colony ownership
    if (settlement.colonyId !== action.colonyId) {
      actionResults.push({
        actionId: action.id,
        status: 'failed',
        result: `Settlement ${settlementId} does not belong to colony ${action.colonyId}`,
      });
      continue;
    }

    // 3. Settlement has barracks
    if (!settlement.buildings.some(b => b.type === 'barracks')) {
      actionResults.push({
        actionId: action.id,
        status: 'failed',
        result: `Settlement ${settlementId} does not have a barracks`,
      });
      continue;
    }

    // 4. Valid unit type
    if (!VALID_UNIT_TYPES.includes(unitType as UnitType)) {
      actionResults.push({
        actionId: action.id,
        status: 'failed',
        result: `Invalid unit type: ${unitType}. Valid types: ${VALID_UNIT_TYPES.join(', ')}`,
      });
      continue;
    }

    const uType = unitType as UnitType;

    // 5. Colony has enough resources
    const colony = colonyMap.get(action.colonyId);
    if (!colony) {
      actionResults.push({
        actionId: action.id,
        status: 'failed',
        result: `Colony ${action.colonyId} not found`,
      });
      continue;
    }

    const cost = UNIT_TRAINING_COSTS[uType];
    if (!hasResources(colony.resources, cost)) {
      const costStr = Object.entries(cost)
        .filter(([, v]) => (v as number) > 0)
        .map(([k, v]) => `${v} ${k}`)
        .join(', ');
      actionResults.push({
        actionId: action.id,
        status: 'failed',
        result: `Insufficient resources for ${uType}: need ${costStr}`,
      });
      continue;
    }

    // --- All checks passed: deduct resources and create unit ---
    deductResources(colony.resources, cost);

    const newUnit: Unit = {
      id: `unit_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      colonyId: action.colonyId,
      worldId: settlement.worldId,
      type: uType,
      hexX: settlement.hexX,
      hexY: settlement.hexY,
      health: 100,
      morale: 1.0,
    };
    newUnits.push(newUnit);

    events.push({
      type: 'unit_trained',
      colonyId: action.colonyId,
      settlementId: settlement.id,
      unitId: newUnit.id,
      data: {
        unitType: uType,
        hexX: settlement.hexX,
        hexY: settlement.hexY,
        cost,
      },
    });

    actionResults.push({
      actionId: action.id,
      status: 'resolved',
      result: `${uType} trained at ${settlement.name}`,
    });
  }

  return { newUnits, events, actionResults };
}

// --- Settlement Upgrade ---

export interface UpgradeSettlementResult {
  events: TickEvent[];
  actionResults: ActionResult[];
}

/**
 * Resolve upgrade_settlement actions: upgrade outpost → town → city.
 *
 * Validates:
 * - Settlement exists and belongs to the colony
 * - Settlement is not already max tier (city)
 * - Colony has enough resources for the upgrade
 * - Settlement meets minimum population requirement
 * - Settlement meets minimum building count
 *
 * On success: resources deducted, tier upgraded, events emitted.
 */
export function resolveUpgradeSettlement(
  settlements: Settlement[],
  colonies: Colony[],
  actions: QueuedAction[],
): UpgradeSettlementResult {
  const events: TickEvent[] = [];
  const actionResults: ActionResult[] = [];

  const upgradeActions = actions.filter(a => a.type === 'upgrade_settlement');
  if (upgradeActions.length === 0) {
    return { events, actionResults };
  }

  // Build lookups
  const settlementMap = new Map<string, Settlement>();
  for (const s of settlements) {
    settlementMap.set(s.id, s);
  }
  const colonyMap = new Map<string, Colony>();
  for (const c of colonies) {
    colonyMap.set(c.id, c);
  }

  for (const action of upgradeActions) {
    const settlementId = action.params.settlementId as string;

    // 1. Settlement exists
    const settlement = settlementMap.get(settlementId);
    if (!settlement) {
      actionResults.push({
        actionId: action.id,
        status: 'failed',
        result: `Settlement ${settlementId} not found`,
      });
      continue;
    }

    // 2. Colony ownership
    if (settlement.colonyId !== action.colonyId) {
      actionResults.push({
        actionId: action.id,
        status: 'failed',
        result: `Settlement ${settlementId} does not belong to colony ${action.colonyId}`,
      });
      continue;
    }

    // 3. Not already max tier
    const currentTierIndex = TIER_ORDER.indexOf(settlement.tier);
    if (currentTierIndex === -1 || currentTierIndex >= TIER_ORDER.length - 1) {
      actionResults.push({
        actionId: action.id,
        status: 'failed',
        result: `Settlement ${settlementId} is already at maximum tier (${settlement.tier})`,
      });
      continue;
    }

    const nextTier = TIER_ORDER[currentTierIndex + 1] as 'outpost' | 'town' | 'city';
    const requirements = UPGRADE_COSTS[nextTier];

    if (!requirements) {
      actionResults.push({
        actionId: action.id,
        status: 'failed',
        result: `No upgrade requirements defined for tier ${nextTier}`,
      });
      continue;
    }

    // 4. Colony has enough resources
    const colony = colonyMap.get(action.colonyId);
    if (!colony) {
      actionResults.push({
        actionId: action.id,
        status: 'failed',
        result: `Colony ${action.colonyId} not found`,
      });
      continue;
    }

    if (!hasResources(colony.resources, requirements.resources)) {
      const costStr = Object.entries(requirements.resources)
        .filter(([, v]) => (v as number) > 0)
        .map(([k, v]) => `${v} ${k}`)
        .join(', ');
      actionResults.push({
        actionId: action.id,
        status: 'failed',
        result: `Insufficient resources to upgrade to ${nextTier}: need ${costStr}`,
      });
      continue;
    }

    // 5. Minimum population
    if (settlement.population < requirements.minPopulation) {
      actionResults.push({
        actionId: action.id,
        status: 'failed',
        result: `Insufficient population to upgrade to ${nextTier}: need ${requirements.minPopulation}, have ${settlement.population}`,
      });
      continue;
    }

    // 6. Minimum buildings
    if (settlement.buildings.length < requirements.minBuildings) {
      actionResults.push({
        actionId: action.id,
        status: 'failed',
        result: `Insufficient buildings to upgrade to ${nextTier}: need ${requirements.minBuildings}, have ${settlement.buildings.length}`,
      });
      continue;
    }

    // --- All checks passed: deduct resources and upgrade ---
    deductResources(colony.resources, requirements.resources);
    const previousTier = settlement.tier;
    settlement.tier = nextTier;

    events.push({
      type: 'settlement_upgraded',
      colonyId: action.colonyId,
      settlementId: settlement.id,
      data: {
        name: settlement.name,
        previousTier,
        newTier: nextTier,
        cost: requirements.resources,
      },
    });

    actionResults.push({
      actionId: action.id,
      status: 'resolved',
      result: `${settlement.name} upgraded from ${previousTier} to ${nextTier}`,
    });
  }

  return { events, actionResults };
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
      production[resource as keyof Resources] += (amount as number) * (building.level || 1) * tierMult;
    }
  }

  // Nearby hex yield bonus (hex resources within 1 ring of settlement)
  for (const hex of nearbyHexes) {
    production.food += hex.resources.food * 0.5;
    production.timber += hex.resources.timber * 0.5;
    production.stone += hex.resources.stone * 0.5;
    production.iron += hex.resources.iron * 0.5;
  }

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

/**
 * Calculate population food consumption for a settlement.
 */
export function calculatePopulationConsumption(settlement: Settlement): number {
  return settlement.population * POP_FOOD_CONSUMPTION;
}

// --- Tick Resolution ---

/**
 * Resolve a single game tick.
 *
 * 0. Resolve found_settlement actions (before movement — consumed settlers don't move)
 * 1. Resolve movement actions + advance movement queues
 * 2. Compute fog of war reveals for moved units + new settlements
 * 3. Resolve build actions + advance build queues
 * 4. Calculate production for each settlement (including new ones)
 * 5. Calculate upkeep (buildings + units)
 * 6. Apply net resources to each colony
 * 7. Handle deficits: morale loss → desertion
 * 8. Handle surplus: morale recovery
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
  let fogReveals: HexExploration[] = [];

  // Build hex lookup
  const hexMap = new Map<string, HexTileState>();
  for (const hex of hexes) {
    hexMap.set(hexKey(hex.x, hex.y), hex);
  }

  // Build set of all valid hex coordinates (used for fog reveals)
  const allHexCoords = new Set<string>();
  for (const hex of hexes) {
    allHexCoords.add(`${hex.x},${hex.y}`);
  }

  // Deep clone colonies so we can mutate
  const updatedColonies = colonies.map(c => ({
    ...c,
    resources: { ...c.resources },
  }));

  // Deep clone units so we can mutate
  let updatedUnits = units.map(u => ({
    ...u,
    movementQueue: u.movementQueue ? [...u.movementQueue] : [],
  }));

  // Deep clone settlements so we can mutate (including buildQueue)
  let updatedSettlements = settlements.map(s => ({
    ...s,
    buildings: [...s.buildings],
    buildQueue: (s.buildQueue ?? []).map(bq => ({ ...bq })),
  }));

  // --- Phase -1: Resolve found_settlement actions (before movement) ---
  const foundActions = actions.filter(a => a.type === 'found_settlement');
  if (foundActions.length > 0) {
    const foundResult = resolveFoundSettlement(
      updatedUnits,
      updatedColonies,
      updatedSettlements,
      hexes,
      actions,
      allHexCoords,
    );

    updatedUnits = foundResult.units.map(u => ({
      ...u,
      movementQueue: u.movementQueue ? [...u.movementQueue] : [],
    }));
    updatedSettlements = [...updatedSettlements, ...foundResult.newSettlements];
    events.push(...foundResult.events);
    actionResults.push(...foundResult.actionResults);
    fogReveals.push(...foundResult.fogReveals);
  }

  // Track unit positions before movement for fog-of-war
  const unitPositionsBefore = new Map<string, { x: number; y: number }>();
  for (const u of updatedUnits) {
    unitPositionsBefore.set(u.id, { x: u.hexX, y: u.hexY });
  }

  // --- Phase 0: Resolve movement actions + advance movement queues ---
  const hasMovingUnits = updatedUnits.some(u => u.movementQueue && u.movementQueue.length > 0);
  const nonFoundActions = actions.filter(a => a.type !== 'found_settlement');
  if (nonFoundActions.length > 0 || hasMovingUnits) {
    const hexLookup = createHexLookup(hexes.map(h => ({ x: h.x, y: h.y, terrain: h.terrain })));
    const moveResult = resolveMovement(updatedUnits, nonFoundActions, hexLookup);
    events.push(...moveResult.events);
    actionResults.push(...moveResult.actionResults);
  }

  // --- Phase 0.5: Fog of war reveals for units that moved ---
  const movedUnits = updatedUnits.filter(u => {
    const before = unitPositionsBefore.get(u.id);
    return before && (before.x !== u.hexX || before.y !== u.hexY);
  });

  if (movedUnits.length > 0) {
    // Build already-explored map from hex data
    const alreadyExplored = new Map<string, boolean>();
    for (const hex of hexes) {
      if (hex.exploredBy) {
        for (const colonyId of hex.exploredBy) {
          alreadyExplored.set(`${colonyId}:${hex.x},${hex.y}`, true);
        }
      }
    }

    const fogResult = computeFogReveals(movedUnits, allHexCoords, alreadyExplored);
    fogReveals.push(...fogResult.reveals);
    events.push(...fogResult.events);
  }

  // --- Phase 0.9: Resolve upgrade_building actions (before build queue advances) ---
  const upgradeBuildingActions = actions.filter(a => a.type === 'upgrade_building');
  if (upgradeBuildingActions.length > 0) {
    const upgradeBuildingResult = resolveUpgradeBuilding(updatedSettlements, updatedColonies, actions);
    events.push(...upgradeBuildingResult.events);
    actionResults.push(...upgradeBuildingResult.actionResults);
  }

  // --- Phase 1: Resolve build actions + advance build queues ---
  const buildActions = actions.filter(a => a.type === 'build');
  if (buildActions.length > 0 || updatedSettlements.some(s => s.buildQueue.length > 0)) {
    const buildResult = resolveBuilding(updatedSettlements, updatedColonies, actions);
    events.push(...buildResult.events);
    actionResults.push(...buildResult.actionResults);
  }

  // --- Phase 1.5: Resolve train_unit actions ---
  const trainActions = actions.filter(a => a.type === 'train_unit');
  if (trainActions.length > 0) {
    const trainResult = resolveTrainUnit(updatedColonies, updatedSettlements, actions);
    events.push(...trainResult.events);
    actionResults.push(...trainResult.actionResults);
    // Add newly trained units to the unit pool
    updatedUnits.push(...trainResult.newUnits.map(u => ({
      ...u,
      movementQueue: [] as HexCoord[],
    })));
  }


  // --- Phase 1.75: Resolve upgrade_settlement actions ---
  const upgradeActions = actions.filter(a => a.type === 'upgrade_settlement');
  if (upgradeActions.length > 0) {
    const upgradeResult = resolveUpgradeSettlement(updatedSettlements, updatedColonies, actions);
    events.push(...upgradeResult.events);
    actionResults.push(...upgradeResult.actionResults);
  }

  // --- Phase 1.8: Resolve demolish actions ---
  const demolishActions = actions.filter(a => a.type === 'demolish');
  if (demolishActions.length > 0) {
    const demolishResult = resolveDemolish(updatedSettlements, updatedColonies, actions);
    events.push(...demolishResult.events);
    actionResults.push(...demolishResult.actionResults);
  }

  // Group settlements and units by colony
  const colonySettlements = new Map<string, Settlement[]>();
  const colonyUnits = new Map<string, Unit[]>();

  for (const s of updatedSettlements) {
    const list = colonySettlements.get(s.colonyId) ?? [];
    list.push(s);
    colonySettlements.set(s.colonyId, list);
  }
  for (const u of updatedUnits) {
    const list = colonyUnits.get(u.colonyId) ?? [];
    list.push(u);
    colonyUnits.set(u.colonyId, list);
  }

  for (const colony of updatedColonies) {
    if (colony.status !== 'active') continue;

    // Sanitize resources: replace null/NaN with 0 (guards against corrupted DB data)
    for (const key of ['food', 'timber', 'stone', 'iron', 'influence'] as (keyof Resources)[]) {
      if (colony.resources[key] == null || Number.isNaN(colony.resources[key])) {
        colony.resources[key] = 0;
      }
    }

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

      // Population food consumption
      totalUpkeep.food += calculatePopulationConsumption(settlement);
    }

    // Unit food upkeep
    totalUpkeep.food += calculateUnitUpkeep(myUnits);

    // --- Apply net resources ---
    const net: Resources = { food: 0, timber: 0, stone: 0, iron: 0, influence: 0 };
    for (const key of Object.keys(net) as (keyof Resources)[]) {
      net[key] = totalProduction[key] - totalUpkeep[key];
      colony.resources[key] = Math.round((colony.resources[key] + net[key]) * 100) / 100;
    }

    // Clamp ALL resources to 0 (stockpiles cannot go negative)
    for (const key of ['food', 'timber', 'stone', 'iron', 'influence'] as (keyof Resources)[]) {
      if (colony.resources[key] < 0) {
        events.push({
          type: 'shortage',
          colonyId: colony.id,
          data: { resource: key, deficit: colony.resources[key] },
        });
        colony.resources[key] = 0;
      }
    }

    // --- Building decay on food deficit ---
    // When colony food is at 0, each building has DECAY_CHANCE_PER_BUILDING chance to lose 1 level.
    // Buildings at level 1 that decay are destroyed.
    if (colony.resources.food <= 0) {
      for (const settlement of mySettlements) {
        // Iterate backwards so splicing doesn't shift indices
        for (let i = settlement.buildings.length - 1; i >= 0; i--) {
          const building = settlement.buildings[i];
          const roll = Math.random();
          if (roll < DECAY_CHANCE_PER_BUILDING) {
            if (building.level <= 1) {
              // Destroy the building
              settlement.buildings.splice(i, 1);
              events.push({
                type: 'building_decayed',
                colonyId: colony.id,
                settlementId: settlement.id,
                data: {
                  buildingType: building.type,
                  previousLevel: 1,
                  destroyed: true,
                },
              });
            } else {
              // Reduce level by 1
              building.level -= 1;
              events.push({
                type: 'building_decayed',
                colonyId: colony.id,
                settlementId: settlement.id,
                data: {
                  buildingType: building.type,
                  previousLevel: building.level + 1,
                  newLevel: building.level,
                  destroyed: false,
                },
              });
            }
          }
        }
      }
    }

    // --- Stockpile decay: resources above cap decay each tick ---
    // Cap is determined by the highest-tier settlement the colony owns.
    // Granary buildings add bonus capacity.
    let highestTier = 'outpost';
    let totalGranaryLevels = 0;
    for (const s of mySettlements) {
      const tierIdx = TIER_ORDER.indexOf(s.tier);
      if (tierIdx > TIER_ORDER.indexOf(highestTier)) {
        highestTier = s.tier;
      }
      for (const b of s.buildings) {
        if (b.type === 'granary') totalGranaryLevels += b.level;
      }
    }
    const baseCap = STOCKPILE_CAP[highestTier] ?? 300;
    const effectiveCap = baseCap + totalGranaryLevels * GRANARY_BONUS_PER_LEVEL;

    for (const key of ['food', 'timber', 'stone', 'iron'] as (keyof Resources)[]) {
      if (colony.resources[key] > effectiveCap) {
        const excess = colony.resources[key] - effectiveCap;
        const decayed = Math.round(excess * STOCKPILE_DECAY_RATE * 100) / 100;
        colony.resources[key] = Math.round((colony.resources[key] - decayed) * 100) / 100;
        events.push({
          type: 'stockpile_decay',
          colonyId: colony.id,
          data: {
            resource: key,
            decayed,
            cap: effectiveCap,
            remaining: colony.resources[key],
          },
        });
      }
    }

    // Production event emitted AFTER clamping and decay so players see accurate stockpile values
    events.push({
      type: 'production',
      colonyId: colony.id,
      data: {
        produced: { ...totalProduction },
        consumed: { ...totalUpkeep },
        net: { ...net },
        stockpileCap: effectiveCap,
        resources: { ...colony.resources },
      },
    });


    // --- Population growth ---
    // +1 population per POP_GROWTH_PER_FOOD excess food, capped by tier max
    if (net.food > 0) {
      for (const settlement of mySettlements) {
        const maxPop = MAX_POPULATION[settlement.tier] ?? 50;
        if (settlement.population < maxPop) {
          const growth = Math.floor(net.food / POP_GROWTH_PER_FOOD);
          if (growth > 0) {
            const oldPop = settlement.population;
            settlement.population = Math.min(maxPop, settlement.population + growth);
            if (settlement.population > oldPop) {
              events.push({
                type: 'population_growth',
                colonyId: colony.id,
                settlementId: settlement.id,
                data: {
                  previousPopulation: oldPop,
                  newPopulation: settlement.population,
                  growth: settlement.population - oldPop,
                  maxPopulation: maxPop,
                },
              });
            }
          }
        }
      }
    }

    // --- Food deficit: famine triggers on negative net food production ---
    // Uses net food (production vs consumption) instead of stockpile.
    // A colony with stockpiled food but negative net still gets a warning,
    // but only suffers morale loss once the stockpile actually runs out.
    if (net.food < 0) {
      // Calculate deficit severity: how bad is the shortfall relative to consumption?
      const totalConsumption = totalUpkeep.food > 0 ? totalUpkeep.food : 1;
      const deficitRatio = Math.abs(net.food) / totalConsumption;
      const severityMultiplier = Math.min(deficitRatio * 2, MAX_DEFICIT_MULTIPLIER);

      // Only apply morale loss when the stockpile has actually hit 0
      // (i.e., colony truly can't feed its people, not just running a small deficit
      // that's still covered by reserves)
      const stockpileDepleted = colony.resources.food <= 0;
      const effectiveMoraleLoss = stockpileDepleted
        ? MORALE_LOSS_RATE * Math.max(severityMultiplier, 1)
        : 0;

      events.push({
        type: 'famine',
        colonyId: colony.id,
        data: {
          netFood: Math.round(net.food * 100) / 100,
          foodStockpile: colony.resources.food,
          severity: Math.round(severityMultiplier * 100) / 100,
          moraleLossPerTick: Math.round(effectiveMoraleLoss * 1000) / 1000,
          foodNeeded: Math.round(totalUpkeep.food * 100) / 100,
          foodProduced: Math.round(totalProduction.food * 100) / 100,
          warning: stockpileDepleted
            ? 'Colony is starving — build more farms or reduce consumption'
            : 'Food reserves depleting — increase food production soon',
        },
      });

      if (stockpileDepleted && effectiveMoraleLoss > 0) {
        // All units of this colony lose morale (scaled by deficit severity)
        const tickDesertions: Array<{ type: string; id: string; morale: number }> = [];
        const moraleWarnings: Array<{ type: string; id: string; morale: number }> = [];

        for (const unit of updatedUnits.filter(u => u.colonyId === colony.id)) {
          unit.morale = Math.max(0, unit.morale - effectiveMoraleLoss);

          // Probabilistic desertion: each unit at/below threshold has DESERTION_CHANCE to desert
          if (unit.morale <= DESERTION_THRESHOLD) {
            const roll = Math.random();
            if (roll < DESERTION_CHANCE) {
              desertedUnitIds.push(unit.id);
              tickDesertions.push({ type: unit.type, id: unit.id, morale: unit.morale });
            }
          } else if (unit.morale <= MORALE_WARNING_THRESHOLD) {
            moraleWarnings.push({ type: unit.type, id: unit.id, morale: unit.morale });
          }
        }

        // Emit morale warning before desertion happens
        if (moraleWarnings.length > 0) {
          events.push({
            type: 'morale_warning',
            colonyId: colony.id,
            data: {
              count: moraleWarnings.length,
              units: moraleWarnings.map(w => ({
                unitType: w.type,
                unitId: w.id,
                morale: Math.round(w.morale * 100) / 100,
              })),
              summary: `${moraleWarnings.length} unit(s) have low morale and may desert soon`,
            },
          });
        }

        // Emit a single aggregated desertion event (instead of one per unit)
        if (tickDesertions.length > 0) {
          events.push({
            type: 'desertion',
            colonyId: colony.id,
            data: {
              count: tickDesertions.length,
              units: tickDesertions.map(d => ({ unitType: d.type, unitId: d.id })),
              summary: tickDesertions.map(d => d.type).join(', '),
            },
          });
        }
      }
    }

    // --- Morale recovery ---
    // Units recover morale when the colony can feed them (net food >= 0 or food stockpile > 0)
    if (net.food >= 0 || colony.resources.food > 0) {
      for (const unit of updatedUnits.filter(u => u.colonyId === colony.id)) {
        if (unit.morale < 1.0) {
          unit.morale = Math.min(1.0, unit.morale + MORALE_RECOVERY_RATE);
        }
      }
    }
  }

  // --- Idle unit tracking ---
  // A unit is "active" if it moved, has a movement queue, or received an action this tick.
  const unitActionTargets = new Set<string>();
  for (const action of actions) {
    const unitId = action.params.unitId as string | undefined;
    if (unitId) unitActionTargets.add(unitId);
  }

  // Newly trained units (not in unitPositionsBefore) start at 0
  for (const unit of updatedUnits) {
    if (desertedUnitIds.includes(unit.id)) continue;

    const isNewUnit = !unitPositionsBefore.has(unit.id);
    if (isNewUnit) {
      unit.idleTicks = 0;
      continue;
    }

    const before = unitPositionsBefore.get(unit.id)!;
    const moved = before.x !== unit.hexX || before.y !== unit.hexY;
    const hasQueue = unit.movementQueue && unit.movementQueue.length > 0;
    const hadAction = unitActionTargets.has(unit.id);

    if (moved || hasQueue || hadAction) {
      unit.idleTicks = 0;
    } else {
      unit.idleTicks = (unit.idleTicks ?? 0) + 1;

      if (unit.idleTicks === IDLE_WARNING_TICKS) {
        events.push({
          type: 'unit_idle',
          colonyId: unit.colonyId,
          unitId: unit.id,
          data: {
            unitType: unit.type,
            hexX: unit.hexX,
            hexY: unit.hexY,
            idleTicks: unit.idleTicks,
          },
        });
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
    fogReveals,
  };
}


