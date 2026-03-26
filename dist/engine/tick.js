/**
 * Tick engine — resolves one game tick.
 *
 * Pure function: takes world state in, returns updated state + events out.
 * No database access — the scheduler handles persistence.
 */
import { hexNeighbors, hexDistance } from './hex.js';
import { findPath, movementStepsThisTick, createHexLookup } from './pathfinding.js';
import { computeFogReveals, hexesWithinRadius } from './fog.js';
export const TECH_TREE = {
    improved_agriculture: {
        id: 'improved_agriculture',
        name: 'Improved Agriculture',
        description: 'Farm production +30%',
        cost: { food: 200, timber: 100 },
        ticks: 10,
    },
    fortifications: {
        id: 'fortifications',
        name: 'Fortifications',
        description: 'Settlement defense bonus — attackers take 2 damage per combat round',
        cost: { stone: 200, iron: 100, timber: 50 },
        ticks: 12,
    },
    advanced_scouting: {
        id: 'advanced_scouting',
        name: 'Advanced Scouting',
        description: 'Scout vision radius +3, scout movement speed +2',
        cost: { food: 150, timber: 100, iron: 50 },
        ticks: 8,
    },
    steel_weapons: {
        id: 'steel_weapons',
        name: 'Steel Weapons',
        description: 'Militia and soldier combat power +2',
        cost: { iron: 200, stone: 100, timber: 50 },
        ticks: 15,
        requires: ['fortifications'],
    },
    trade_routes: {
        id: 'trade_routes',
        name: 'Trade Routes',
        description: '+5 influence per tick, +2 food per settlement beyond first',
        cost: { food: 150, timber: 100, influence: 50 },
        ticks: 10,
        requires: ['improved_agriculture'],
    },
    siege_engineering: {
        id: 'siege_engineering',
        name: 'Siege Engineering',
        description: 'Siege units deal double damage to settlements',
        cost: { iron: 250, stone: 200, timber: 100 },
        ticks: 20,
        requires: ['steel_weapons'],
    },
};
export const SCORE_RESEARCH_COMPLETE = 75;
// --- Constants ---
/** Settlement tier multipliers for production */
export const TIER_MULTIPLIER = {
    outpost: 1.0,
    town: 1.5,
    city: 2.0,
};
/** Building production per level */
export const BUILDING_PRODUCTION = {
    farm: { food: 15 },
    lumberMill: { timber: 5 },
    quarry: { stone: 4 },
    mine: { iron: 3 },
    barracks: {},
    granary: {},
    market: { influence: 2 },
    workshop: {},
    warehouse: {},
};
/** Building upkeep per level (resources consumed per tick) */
export const BUILDING_UPKEEP = {
    farm: { timber: 1 },
    lumberMill: { timber: 1, stone: 1 },
    quarry: { timber: 1 },
    mine: { timber: 1, food: 1 },
    barracks: { food: 2, iron: 2, timber: 1 },
    granary: { timber: 1 },
    market: { food: 1, timber: 1 },
    workshop: { food: 2, timber: 1, iron: 1 },
    warehouse: { timber: 1, stone: 1 },
};
/** Building construction costs */
export const BUILDING_COSTS = {
    farm: { timber: 20 },
    lumberMill: { timber: 10, stone: 10 },
    quarry: { stone: 20, iron: 10 },
    mine: { stone: 30, timber: 20 },
    barracks: { timber: 40, stone: 20, iron: 10 },
    granary: { timber: 25, stone: 10 },
    market: { stone: 30, timber: 15, iron: 5 },
    workshop: { stone: 40, timber: 30, iron: 20 },
    warehouse: { stone: 30, timber: 20, iron: 10 },
};
/** Maximum building level */
export const MAX_BUILDING_LEVEL = 3;
/** Building upgrade time in ticks (same as construction) */
export const UPGRADE_BUILD_TIME = 3;
/**
 * Calculate upgrade cost for a building at the given level.
 * Upgrading from level N to N+1 costs: base_cost × N (escalating).
 */
export function buildingUpgradeCost(type, currentLevel) {
    const base = BUILDING_COSTS[type];
    const cost = {};
    for (const [key, amount] of Object.entries(base)) {
        cost[key] = amount * (currentLevel + 1);
    }
    return cost;
}
/** Ticks required to construct any building */
export const BUILD_TIME = 3;
/** All valid building types */
export const VALID_BUILDING_TYPES = [
    'farm', 'lumberMill', 'quarry', 'mine', 'barracks', 'granary', 'market', 'workshop', 'warehouse',
];
/** Unit food upkeep per tick */
export const UNIT_UPKEEP = {
    scout: 0.5,
    militia: 1.5,
    soldier: 3,
    siege: 4,
    settler: 3,
};
/** Population food consumption per person per tick */
export const POP_FOOD_CONSUMPTION = 0.4;
/** Unit training costs (resources needed to recruit) */
export const UNIT_TRAINING_COSTS = {
    scout: { food: 10, timber: 5 },
    militia: { food: 15, timber: 10, iron: 5 },
    soldier: { food: 25, timber: 10, iron: 15 },
    siege: { food: 40, timber: 20, iron: 30, stone: 10 },
    settler: { food: 30, timber: 15 },
};
/** All valid unit types for training */
export const VALID_UNIT_TYPES = ['scout', 'militia', 'soldier', 'siege', 'settler'];
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
// --- Legacy Score Awards ---
export const SCORE_PER_TICK = 1;
export const SCORE_SETTLEMENT_FOUNDED = 50;
export const SCORE_UPGRADE_TOWN = 100;
export const SCORE_UPGRADE_CITY = 250;
export const SCORE_BUILDING_BUILT = 25;
export const SCORE_UNIT_TRAINED = 10;
export const SCORE_COMBAT_VICTORY = 100;
/** Morale recovery per tick when food is positive */
export const MORALE_RECOVERY_RATE = 0.10;
/** Ticks of inactivity before emitting idle unit warning */
export const IDLE_WARNING_TICKS = 3;
/** Ticks of colony inactivity before warning event */
export const COLONY_NEGLECT_WARNING_TICKS = 100; // ~8 hours
/** Ticks of inactivity before accelerated decay begins */
export const COLONY_NEGLECT_DECAY_TICKS = 200; // ~16 hours
/** Extra morale loss per tick for neglected colonies */
export const COLONY_NEGLECT_MORALE_PENALTY = 0.02;
/** Ticks after colony death before history is purged */
export const COLONY_DEATH_HISTORY_TICKS = 500; // ~42 hours
/** Resource cost to found a new settlement */
export const FOUNDING_COST = {
    food: 100,
    timber: 50,
};
/** Minimum hex distance between any two settlements */
export const MIN_SETTLEMENT_DISTANCE = 3;
/** Fog reveal radius for a newly founded settlement */
export const FOUNDING_REVEAL_RADIUS = 5;
/** Terrains where settlements cannot be founded */
/** Settlement upgrade requirements */
export const UPGRADE_COSTS = {
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
export const TIER_ORDER = ['outpost', 'town', 'city'];
/** Maximum population per settlement tier */
export const MAX_POPULATION = {
    outpost: 50,
    town: 200,
    city: 1000,
};
/** Maximum number of building slots per settlement tier */
export const BUILDING_SLOTS = {
    outpost: 4,
    town: 6,
    city: 7,
};
/** Population growth rate: +1 per this many excess food */
export const POP_GROWTH_PER_FOOD = 5;
/** Stockpile capacity per settlement tier (per resource) */
export const STOCKPILE_CAP = {
    outpost: 500,
    town: 1000,
    city: 2000,
};
/** Additional stockpile capacity per granary level */
export const GRANARY_BONUS_PER_LEVEL = 200;
/** Additional stockpile capacity per warehouse level (all resources) */
export const WAREHOUSE_BONUS_PER_LEVEL = 150;
/** Fraction of excess resources that decay each tick (5%) */
export const STOCKPILE_DECAY_RATE = 0.03;
/** Hard ceiling multiplier: resources above cap × this are immediately clamped */
export const STOCKPILE_HARD_CEILING = 2.0;
/** Fraction of building cost refunded on demolish (25%) */
export const DEMOLISH_REFUND_RATE = 0.25;
/** Chance per tick per building to decay when colony food is at 0 */
export const DECAY_CHANCE_PER_BUILDING = 0.10;
// --- Combat Constants ---
/** Unit attack power by type */
export const UNIT_ATTACK = {
    scout: 2,
    militia: 4,
    soldier: 8,
    siege: 12,
    settler: 0,
};
/** Unit defense power by type */
export const UNIT_DEFENSE = {
    scout: 1,
    militia: 3,
    soldier: 6,
    siege: 2,
    settler: 1,
};
/** Morale loss for surviving units after combat */
export const COMBAT_MORALE_LOSS = 0.1;
/** Max random bonus multiplier for attack damage (0 to this value) */
export const COMBAT_RANDOM_BONUS = 0.3;
const UNFOUNDABLE_TERRAIN = new Set(['ocean', 'mountains']);
// --- Helpers ---
/** Truncate user-supplied IDs in error messages to prevent log bloat */
function truncId(id, maxLen = 50) {
    if (id.length <= maxLen)
        return id;
    return id.substring(0, maxLen) + '…[truncated]';
}
function hexKey(x, y) {
    return `${x},${y}`;
}
/**
 * Check if a colony has enough resources for a cost.
 */
function hasResources(resources, cost) {
    for (const [key, amount] of Object.entries(cost)) {
        if (amount > 0 && resources[key] < amount) {
            return false;
        }
    }
    return true;
}
/**
 * Deduct a resource cost from colony resources.
 */
function deductResources(resources, cost) {
    for (const [key, amount] of Object.entries(cost)) {
        if (amount > 0) {
            resources[key] -= amount;
        }
    }
}
/**
 * Resolve build actions: validate and queue new buildings.
 * Then advance all existing build queues (decrement ticksRemaining,
 * move completed buildings to the buildings array).
 */
export function resolveBuilding(settlements, colonies, actions) {
    const events = [];
    const actionResults = [];
    // Build lookups
    const settlementMap = new Map();
    for (const s of settlements) {
        settlementMap.set(s.id, s);
    }
    const colonyMap = new Map();
    for (const c of colonies) {
        colonyMap.set(c.id, c);
    }
    // Phase 1: Process build actions — validate and add to build queue
    // Actions are processed in array order (first-come-first-served for resource deduction).
    const buildActions = actions.filter(a => a.type === 'build');
    for (const action of buildActions) {
        const settlementId = action.params.settlementId;
        const buildingType = action.params.buildingType;
        // 1. Settlement exists
        const settlement = settlementMap.get(settlementId);
        if (!settlement) {
            actionResults.push({
                actionId: action.id,
                status: 'failed',
                result: `Settlement ${truncId(settlementId)} not found`,
            });
            continue;
        }
        // 2. Colony ownership
        if (settlement.colonyId !== action.colonyId) {
            actionResults.push({
                actionId: action.id,
                status: 'failed',
                result: `Settlement ${truncId(settlementId)} does not belong to this colony`,
            });
            continue;
        }
        // 3. Valid building type
        if (!VALID_BUILDING_TYPES.includes(buildingType)) {
            actionResults.push({
                actionId: action.id,
                status: 'failed',
                result: `Invalid building type: ${buildingType}. Valid types: ${VALID_BUILDING_TYPES.join(', ')}`,
            });
            continue;
        }
        const bType = buildingType;
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
        // 5b. Building slot limit (per settlement tier)
        const maxSlots = BUILDING_SLOTS[settlement.tier] ?? 4;
        const usedSlots = settlement.buildings.length + settlement.buildQueue.length;
        if (usedSlots >= maxSlots) {
            actionResults.push({
                actionId: action.id,
                status: 'failed',
                result: `${settlement.name} has no building slots available (${usedSlots}/${maxSlots}). Upgrade settlement tier to unlock more slots.`,
            });
            continue;
        }
        // 6. Colony has enough resources
        const colony = colonyMap.get(action.colonyId);
        if (!colony) {
            actionResults.push({
                actionId: action.id,
                status: 'failed',
                result: `Colony ${truncId(action.colonyId)} not found`,
            });
            continue;
        }
        const cost = BUILDING_COSTS[bType];
        if (!hasResources(colony.resources, cost)) {
            const costStr = Object.entries(cost)
                .filter(([, v]) => v > 0)
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
        if (settlement.buildQueue.length === 0)
            continue;
        const completed = [];
        const remaining = [];
        for (const entry of settlement.buildQueue) {
            const newTicks = entry.ticksRemaining - 1;
            if (newTicks <= 0) {
                completed.push(entry);
            }
            else {
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
            }
            else {
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
export function resolveUpgradeBuilding(settlements, colonies, actions) {
    const events = [];
    const actionResults = [];
    const upgradeActions = actions.filter(a => a.type === 'upgrade_building');
    if (upgradeActions.length === 0) {
        return { events, actionResults };
    }
    // Build lookups
    const settlementMap = new Map();
    for (const s of settlements) {
        settlementMap.set(s.id, s);
    }
    const colonyMap = new Map();
    for (const c of colonies) {
        colonyMap.set(c.id, c);
    }
    for (const action of upgradeActions) {
        const settlementId = action.params.settlementId;
        const buildingType = action.params.buildingType;
        // 1. Settlement exists
        const settlement = settlementMap.get(settlementId);
        if (!settlement) {
            actionResults.push({
                actionId: action.id,
                status: 'failed',
                result: `Settlement ${truncId(settlementId)} not found`,
            });
            continue;
        }
        // 2. Colony ownership
        if (settlement.colonyId !== action.colonyId) {
            actionResults.push({
                actionId: action.id,
                status: 'failed',
                result: `Settlement ${truncId(settlementId)} does not belong to this colony`,
            });
            continue;
        }
        // 3. Valid building type
        if (!VALID_BUILDING_TYPES.includes(buildingType)) {
            actionResults.push({
                actionId: action.id,
                status: 'failed',
                result: `Invalid building type: ${buildingType}`,
            });
            continue;
        }
        const bType = buildingType;
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
                result: `Colony ${truncId(action.colonyId)} not found`,
            });
            continue;
        }
        const cost = buildingUpgradeCost(bType, building.level);
        if (!hasResources(colony.resources, cost)) {
            const costStr = Object.entries(cost)
                .filter(([, v]) => v > 0)
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
/**
 * Resolve demolish actions: remove a building from a settlement and refund 25% of cost.
 *
 * Validates:
 * - Settlement exists and belongs to the colony
 * - Building type is valid and exists in the settlement
 *
 * On success: building removed, partial refund credited, event emitted.
 */
export function resolveDemolish(settlements, colonies, actions) {
    const events = [];
    const actionResults = [];
    const demolishActions = actions.filter(a => a.type === 'demolish');
    if (demolishActions.length === 0) {
        return { events, actionResults };
    }
    // Build lookups
    const settlementMap = new Map();
    for (const s of settlements) {
        settlementMap.set(s.id, s);
    }
    const colonyMap = new Map();
    for (const c of colonies) {
        colonyMap.set(c.id, c);
    }
    for (const action of demolishActions) {
        const settlementId = action.params.settlementId;
        const buildingType = action.params.buildingType;
        // 1. Settlement exists
        const settlement = settlementMap.get(settlementId);
        if (!settlement) {
            actionResults.push({
                actionId: action.id,
                status: 'failed',
                result: `Settlement ${truncId(settlementId)} not found`,
            });
            continue;
        }
        // 2. Colony ownership
        if (settlement.colonyId !== action.colonyId) {
            actionResults.push({
                actionId: action.id,
                status: 'failed',
                result: `Settlement ${truncId(settlementId)} does not belong to this colony`,
            });
            continue;
        }
        // 3. Valid building type
        if (!VALID_BUILDING_TYPES.includes(buildingType)) {
            actionResults.push({
                actionId: action.id,
                status: 'failed',
                result: `Invalid building type: ${buildingType}`,
            });
            continue;
        }
        const bType = buildingType;
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
                result: `Colony ${truncId(action.colonyId)} not found`,
            });
            continue;
        }
        // --- All checks passed: remove building and refund ---
        // Calculate refund: 25% of total cost (base cost × level for upgraded buildings)
        const baseCost = BUILDING_COSTS[bType];
        const refund = {};
        for (const [key, amount] of Object.entries(baseCost)) {
            const totalCost = amount * building.level;
            refund[key] = Math.floor(totalCost * DEMOLISH_REFUND_RATE);
        }
        // Credit refund
        for (const [key, amount] of Object.entries(refund)) {
            if (amount > 0) {
                colony.resources[key] += amount;
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
export function resolveFoundSettlement(units, colonies, settlements, hexes, actions, allHexCoords) {
    const events = [];
    const actionResults = [];
    const newSettlements = [];
    const consumedUnitIds = [];
    const fogReveals = [];
    const foundActions = actions.filter(a => a.type === 'found_settlement');
    if (foundActions.length === 0) {
        return { units, newSettlements, consumedUnitIds, events, actionResults, fogReveals };
    }
    // Build lookups
    const unitMap = new Map();
    for (const u of units) {
        unitMap.set(u.id, u);
    }
    const colonyMap = new Map();
    for (const c of colonies) {
        colonyMap.set(c.id, c);
    }
    const hexMap = new Map();
    for (const hex of hexes) {
        hexMap.set(hexKey(hex.x, hex.y), hex);
    }
    // Collect all existing settlements + newly created ones (for distance checks)
    const allSettlementPositions = settlements.map(s => ({ q: s.hexX, r: s.hexY }));
    for (const action of foundActions) {
        const unitId = action.params.unitId;
        const settlementName = action.params.name;
        // 1. Unit exists
        const unit = unitMap.get(unitId);
        if (!unit) {
            actionResults.push({
                actionId: action.id,
                status: 'failed',
                result: `Unit ${truncId(unitId)} not found`,
            });
            continue;
        }
        // 2. Colony ownership
        if (unit.colonyId !== action.colonyId) {
            actionResults.push({
                actionId: action.id,
                status: 'failed',
                result: `Unit ${truncId(unitId)} does not belong to this colony`,
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
        const settlerPos = { q: unit.hexX, r: unit.hexY };
        const tooClose = allSettlementPositions.some(pos => hexDistance(settlerPos, pos) < MIN_SETTLEMENT_DISTANCE);
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
                result: `Colony ${truncId(action.colonyId)} not found`,
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
        const newSettlement = {
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
export function resolveTrainUnit(colonies, settlements, actions) {
    const events = [];
    const actionResults = [];
    const newUnits = [];
    const trainActions = actions.filter(a => a.type === 'train_unit');
    if (trainActions.length === 0) {
        return { newUnits, events, actionResults };
    }
    // Build lookups
    const settlementMap = new Map();
    for (const s of settlements) {
        settlementMap.set(s.id, s);
    }
    const colonyMap = new Map();
    for (const c of colonies) {
        colonyMap.set(c.id, c);
    }
    for (const action of trainActions) {
        const settlementId = action.params.settlementId;
        const unitType = action.params.unitType;
        // 1. Settlement exists
        const settlement = settlementMap.get(settlementId);
        if (!settlement) {
            actionResults.push({
                actionId: action.id,
                status: 'failed',
                result: `Settlement ${truncId(settlementId)} not found`,
            });
            continue;
        }
        // 2. Colony ownership
        if (settlement.colonyId !== action.colonyId) {
            actionResults.push({
                actionId: action.id,
                status: 'failed',
                result: `Settlement ${truncId(settlementId)} does not belong to this colony`,
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
        if (!VALID_UNIT_TYPES.includes(unitType)) {
            actionResults.push({
                actionId: action.id,
                status: 'failed',
                result: `Invalid unit type: ${unitType}. Valid types: ${VALID_UNIT_TYPES.join(', ')}`,
            });
            continue;
        }
        const uType = unitType;
        // 5. Colony has enough resources
        const colony = colonyMap.get(action.colonyId);
        if (!colony) {
            actionResults.push({
                actionId: action.id,
                status: 'failed',
                result: `Colony ${truncId(action.colonyId)} not found`,
            });
            continue;
        }
        const cost = UNIT_TRAINING_COSTS[uType];
        if (!hasResources(colony.resources, cost)) {
            const costStr = Object.entries(cost)
                .filter(([, v]) => v > 0)
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
        const newUnit = {
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
export function resolveUpgradeSettlement(settlements, colonies, actions) {
    const events = [];
    const actionResults = [];
    const upgradeActions = actions.filter(a => a.type === 'upgrade_settlement');
    if (upgradeActions.length === 0) {
        return { events, actionResults };
    }
    // Build lookups
    const settlementMap = new Map();
    for (const s of settlements) {
        settlementMap.set(s.id, s);
    }
    const colonyMap = new Map();
    for (const c of colonies) {
        colonyMap.set(c.id, c);
    }
    for (const action of upgradeActions) {
        const settlementId = action.params.settlementId;
        // 1. Settlement exists
        const settlement = settlementMap.get(settlementId);
        if (!settlement) {
            actionResults.push({
                actionId: action.id,
                status: 'failed',
                result: `Settlement ${truncId(settlementId)} not found`,
            });
            continue;
        }
        // 2. Colony ownership
        if (settlement.colonyId !== action.colonyId) {
            actionResults.push({
                actionId: action.id,
                status: 'failed',
                result: `Settlement ${truncId(settlementId)} does not belong to this colony`,
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
        const nextTier = TIER_ORDER[currentTierIndex + 1];
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
                result: `Colony ${truncId(action.colonyId)} not found`,
            });
            continue;
        }
        if (!hasResources(colony.resources, requirements.resources)) {
            const costStr = Object.entries(requirements.resources)
                .filter(([, v]) => v > 0)
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
export function resolveMovement(units, actions, hexLookup) {
    const events = [];
    const actionResults = [];
    // Build unit lookup for ownership/existence checks
    const unitMap = new Map();
    for (const u of units) {
        unitMap.set(u.id, u);
    }
    // Phase 1: Process move_unit and attack actions — compute paths and set queues
    // Attack actions work the same as move_unit — pathfind toward target hex.
    // Combat is resolved automatically when opposing units share a hex.
    const moveActions = actions.filter(a => a.type === 'move_unit' || a.type === 'attack');
    for (const action of moveActions) {
        const unitId = action.params.unitId;
        const targetX = action.params.targetX;
        const targetY = action.params.targetY;
        const unit = unitMap.get(unitId);
        if (!unit) {
            actionResults.push({
                actionId: action.id,
                status: 'failed',
                result: `Unit ${truncId(unitId)} not found`,
            });
            continue;
        }
        // Verify colony ownership
        if (unit.colonyId !== action.colonyId) {
            actionResults.push({
                actionId: action.id,
                status: 'failed',
                result: `Unit ${truncId(unitId)} does not belong to this colony`,
            });
            continue;
        }
        const from = { q: unit.hexX, r: unit.hexY };
        const to = { q: targetX, r: targetY };
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
        if (!unit.movementQueue || unit.movementQueue.length === 0)
            continue;
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
export function calculateProduction(settlement, nearbyHexes) {
    const tierMult = TIER_MULTIPLIER[settlement.tier] ?? 1.0;
    const production = { food: 0, timber: 0, stone: 0, iron: 0, influence: 0 };
    // Building production
    for (const building of settlement.buildings) {
        const output = BUILDING_PRODUCTION[building.type];
        if (!output)
            continue;
        for (const [resource, amount] of Object.entries(output)) {
            production[resource] += amount * (building.level || 1) * tierMult;
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
export function calculateBuildingUpkeep(settlement) {
    const upkeep = { food: 0, timber: 0, stone: 0, iron: 0, influence: 0 };
    for (const building of settlement.buildings) {
        const cost = BUILDING_UPKEEP[building.type];
        if (!cost)
            continue;
        for (const [resource, amount] of Object.entries(cost)) {
            upkeep[resource] += amount * building.level;
        }
    }
    return upkeep;
}
/**
 * Calculate total unit upkeep for a colony.
 */
export function calculateUnitUpkeep(units) {
    return units.reduce((total, unit) => total + (UNIT_UPKEEP[unit.type] ?? 0), 0);
}
/**
 * Calculate population food consumption for a settlement.
 */
export function calculatePopulationConsumption(settlement) {
    return settlement.population * POP_FOOD_CONSUMPTION;
}
/**
 * Simple seeded PRNG (mulberry32). Used for deterministic combat results.
 * Pass seed=undefined for non-deterministic (Math.random) behavior.
 */
function createRng(seed) {
    if (seed === undefined)
        return Math.random;
    let s = seed | 0;
    return () => {
        s = (s + 0x6D2B79F5) | 0;
        let t = Math.imul(s ^ (s >>> 15), 1 | s);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}
/**
 * Resolve combat on all hexes where opposing units coexist.
 *
 * After movement, find hexes with units from 2+ colonies.
 * Each unit attacks one enemy unit (round-robin targeting).
 * Damage = attackPower × (1 + random(0, COMBAT_RANDOM_BONUS)).
 * Effective damage = max(0, damage - target.defensePower).
 * Units at health ≤ 0 are destroyed. Survivors lose COMBAT_MORALE_LOSS morale.
 */
export function resolveCombat(units, actions, seed, activeAgreements) {
    const rng = createRng(seed);
    const events = [];
    const actionResults = [];
    const destroyedUnitIds = [];
    // Build NAP lookup: set of "colonyA|colonyB" pairs (sorted ids) with active non_aggression or alliance
    const napPairs = new Set();
    if (activeAgreements) {
        for (const agr of activeAgreements) {
            if (agr.status === 'active' && (agr.type === 'non_aggression' || agr.type === 'alliance')) {
                const pair = [agr.proposedBy, agr.proposedTo].sort().join('|');
                napPairs.add(pair);
            }
        }
    }
    // Helper to check if two colonies have an active NAP/alliance
    const hasNap = (colonyA, colonyB) => {
        const pair = [colonyA, colonyB].sort().join('|');
        return napPairs.has(pair);
    };
    // Note: attack actions are handled as move_unit by resolveMovement() — pathfinding
    // toward the target hex. Combat resolution below handles the fighting when they arrive.
    // Group units by hex
    const hexUnits = new Map();
    for (const unit of units) {
        const key = hexKey(unit.hexX, unit.hexY);
        const list = hexUnits.get(key) ?? [];
        list.push(unit);
        hexUnits.set(key, list);
    }
    // For each hex, check if there are units from multiple colonies
    for (const [hex, unitsOnHex] of hexUnits) {
        const colonies = new Set(unitsOnHex.map(u => u.colonyId));
        if (colonies.size < 2)
            continue;
        // --- NAP enforcement ---
        // Check if ALL colony pairs on this hex have NAPs. If so, skip combat entirely.
        // If only some pairs have NAPs, combat still happens but NAP-protected units don't target each other.
        const colonyIds = [...colonies];
        let allPairsProtected = true;
        for (let i = 0; i < colonyIds.length; i++) {
            for (let j = i + 1; j < colonyIds.length; j++) {
                if (!hasNap(colonyIds[i], colonyIds[j])) {
                    allPairsProtected = false;
                    break;
                }
            }
            if (!allPairsProtected)
                break;
        }
        if (allPairsProtected) {
            // All colonies on this hex have mutual NAPs — no combat, emit nap_blocked_combat event
            const [hexX, hexY] = hex.split(',').map(Number);
            for (const colonyId of colonyIds) {
                events.push({
                    type: 'nap_blocked_combat',
                    colonyId,
                    data: {
                        hexX,
                        hexY,
                        colonies: colonyIds.filter(c => c !== colonyId),
                        reason: 'Non-aggression pact prevents combat',
                    },
                });
            }
            continue; // Skip combat on this hex entirely
        }
        // Combat! Units on this hex fight (respecting NAP protections for individual pairs).
        // Each unit attacks a random enemy unit that is NOT NAP-protected.
        // We process all attacks simultaneously (no kill-order advantage).
        // Calculate damage dealt by each unit
        const damageDealt = new Map(); // target unitId → total damage
        const combatLog = [];
        for (const attacker of unitsOnHex) {
            const attackPower = UNIT_ATTACK[attacker.type];
            if (attackPower <= 0)
                continue; // settlers can't attack
            // Find enemy units (from different colony AND not NAP-protected)
            const enemies = unitsOnHex.filter(u => u.colonyId !== attacker.colonyId && !hasNap(attacker.colonyId, u.colonyId));
            if (enemies.length === 0)
                continue;
            // Pick a random enemy target
            const target = enemies[Math.floor(rng() * enemies.length)];
            // Calculate damage with random bonus
            const bonus = rng() * COMBAT_RANDOM_BONUS;
            const rawDamage = attackPower * (1 + bonus);
            const effectiveDamage = Math.max(0, rawDamage - UNIT_DEFENSE[target.type]);
            const roundedDamage = Math.round(effectiveDamage * 100) / 100;
            const currentDamage = damageDealt.get(target.id) ?? 0;
            damageDealt.set(target.id, currentDamage + roundedDamage);
            combatLog.push({
                attackerId: attacker.id,
                attackerType: attacker.type,
                attackerColony: attacker.colonyId,
                targetId: target.id,
                targetType: target.type,
                targetColony: target.colonyId,
                damage: roundedDamage,
            });
        }
        // Apply damage simultaneously
        const casualties = [];
        for (const unit of unitsOnHex) {
            const totalDamage = damageDealt.get(unit.id) ?? 0;
            if (totalDamage > 0) {
                unit.health = Math.round((unit.health - totalDamage) * 100) / 100;
            }
            if (unit.health <= 0) {
                destroyedUnitIds.push(unit.id);
                casualties.push({
                    unitId: unit.id,
                    unitType: unit.type,
                    colonyId: unit.colonyId,
                    damageReceived: totalDamage,
                });
                // Emit unit_destroyed event
                events.push({
                    type: 'unit_destroyed',
                    colonyId: unit.colonyId,
                    unitId: unit.id,
                    data: {
                        unitType: unit.type,
                        hexX: unit.hexX,
                        hexY: unit.hexY,
                        killedInCombat: true,
                        damageReceived: totalDamage,
                    },
                });
            }
        }
        // Surviving units lose morale
        for (const unit of unitsOnHex) {
            if (!destroyedUnitIds.includes(unit.id)) {
                unit.morale = Math.max(0, Math.round((unit.morale - COMBAT_MORALE_LOSS) * 100) / 100);
            }
        }
        // Emit combat_resolved event (visible to all involved colonies)
        const [hexX, hexY] = hex.split(',').map(Number);
        const involvedColonies = [...colonies];
        for (const colonyId of involvedColonies) {
            events.push({
                type: 'combat_resolved',
                colonyId,
                data: {
                    hexX,
                    hexY,
                    participants: unitsOnHex.map(u => ({
                        unitId: u.id,
                        unitType: u.type,
                        colonyId: u.colonyId,
                        healthBefore: u.health + (damageDealt.get(u.id) ?? 0),
                        healthAfter: u.health,
                        destroyed: destroyedUnitIds.includes(u.id),
                    })),
                    casualties: casualties.length,
                    combatLog,
                },
            });
        }
    }
    // Remove destroyed units
    const survivingUnits = units.filter(u => !destroyedUnitIds.includes(u.id));
    return {
        units: survivingUnits,
        destroyedUnitIds,
        events,
        actionResults,
    };
}
// --- Message Resolution ---
/** Maximum messages a colony can send per tick */
export const MAX_MESSAGES_PER_TICK = 5;
/** Maximum message content length (characters) */
export const MAX_MESSAGE_LENGTH = 500;
/** Delivery delay in ticks (messages arrive 1 tick after sending) */
export const MESSAGE_DELIVERY_DELAY = 1;
/**
 * Resolve send_message actions: validate and create message records.
 *
 * Validates:
 * - Target colony exists and is in the same world
 * - Target colony is not self
 * - Rate limit: max 5 messages per colony per tick
 * - Message content is not empty and within length limit
 *
 * On success: message record created, event emitted for recipient.
 */
export function resolveMessages(colonies, actions, worldId, currentTick) {
    const events = [];
    const actionResults = [];
    const newMessages = [];
    const messageActions = actions.filter(a => a.type === 'send_message');
    if (messageActions.length === 0) {
        return { messages: newMessages, events, actionResults };
    }
    // Build colony lookup
    const colonyMap = new Map();
    for (const c of colonies) {
        colonyMap.set(c.id, c);
    }
    // Track messages sent per colony this tick (for rate limiting)
    const sentCount = new Map();
    for (const action of messageActions) {
        const toColonyId = action.params.toColonyId;
        const content = action.params.message;
        // 1. Check rate limit
        const currentCount = sentCount.get(action.colonyId) ?? 0;
        if (currentCount >= MAX_MESSAGES_PER_TICK) {
            actionResults.push({
                actionId: action.id,
                status: 'failed',
                result: `Rate limit: max ${MAX_MESSAGES_PER_TICK} messages per tick`,
            });
            continue;
        }
        // 2. Validate content
        if (!content || typeof content !== 'string' || content.trim().length === 0) {
            actionResults.push({
                actionId: action.id,
                status: 'failed',
                result: 'Message content is required',
            });
            continue;
        }
        if (content.length > MAX_MESSAGE_LENGTH) {
            actionResults.push({
                actionId: action.id,
                status: 'failed',
                result: `Message too long: max ${MAX_MESSAGE_LENGTH} characters (got ${content.length})`,
            });
            continue;
        }
        // 3. Validate target colony
        if (!toColonyId) {
            actionResults.push({
                actionId: action.id,
                status: 'failed',
                result: 'Target colony ID (toColonyId) is required',
            });
            continue;
        }
        // 4. Cannot message self
        if (toColonyId === action.colonyId) {
            actionResults.push({
                actionId: action.id,
                status: 'failed',
                result: 'Cannot send a message to yourself',
            });
            continue;
        }
        // 5. Target colony exists
        const targetColony = colonyMap.get(toColonyId);
        if (!targetColony) {
            actionResults.push({
                actionId: action.id,
                status: 'failed',
                result: `Colony ${toColonyId} not found`,
            });
            continue;
        }
        // 6. Target colony is active
        if (targetColony.status !== 'active') {
            actionResults.push({
                actionId: action.id,
                status: 'failed',
                result: `Colony ${toColonyId} is ${targetColony.status} and cannot receive messages`,
            });
            continue;
        }
        // --- All checks passed: create message ---
        const senderColony = colonyMap.get(action.colonyId);
        const messageId = `msg_${currentTick}_${Math.random().toString(36).slice(2, 10)}`;
        const deliveredAtTick = currentTick + MESSAGE_DELIVERY_DELAY;
        const message = {
            id: messageId,
            worldId,
            fromColony: action.colonyId,
            toColony: toColonyId,
            sentAtTick: currentTick,
            deliveredAtTick,
            content: content.trim(),
            read: false,
        };
        newMessages.push(message);
        // Increment sent count
        sentCount.set(action.colonyId, currentCount + 1);
        // Emit private event for recipient
        events.push({
            type: 'message_received',
            colonyId: toColonyId,
            data: {
                messageId,
                fromColonyId: action.colonyId,
                fromColonyName: senderColony?.name ?? 'Unknown',
                sentAtTick: currentTick,
                deliveredAtTick,
                preview: content.trim().slice(0, 100),
            },
        });
        // Emit confirmation event for sender
        events.push({
            type: 'message_sent',
            colonyId: action.colonyId,
            data: {
                messageId,
                toColonyId,
                toColonyName: targetColony.name,
                sentAtTick: currentTick,
                deliveredAtTick,
            },
        });
        actionResults.push({
            actionId: action.id,
            status: 'resolved',
            result: `Message sent to ${targetColony.name}`,
        });
    }
    return { messages: newMessages, events, actionResults };
}
// --- Market Resource Conversion ---
/** Base conversion rate: spend this many units to get 1 unit of target resource */
export const MARKET_CONVERSION_BASE_RATE = 3.0;
/** Conversion rate improvement per market level: rate = base - (level - 1) * this */
export const MARKET_CONVERSION_LEVEL_BONUS = 0.5;
/** Minimum conversion rate (best possible) */
export const MARKET_CONVERSION_MIN_RATE = 1.5;
/** Maximum amount convertible per action */
export const MARKET_CONVERSION_MAX_AMOUNT = 200;
/** Convertible resource types */
const CONVERTIBLE_RESOURCES = ['food', 'timber', 'stone', 'iron'];
/**
 * Resolve convert_resources actions: exchange surplus resources via market.
 *
 * Requires a market building in the specified settlement.
 * Conversion rate improves with market level:
 *   Level 1: 3:1
 *   Level 2: 2.5:1
 *   Level 3: 2:1
 *
 * Validates:
 * - Settlement exists and belongs to colony
 * - Settlement has a market building
 * - fromResource and toResource are valid and different
 * - Colony has enough of the source resource
 * - Amount is positive and within limits
 */
export function resolveConvertResources(settlements, colonies, actions) {
    const events = [];
    const actionResults = [];
    const convertActions = actions.filter(a => a.type === 'convert_resources');
    if (convertActions.length === 0) {
        return { events, actionResults };
    }
    // Build lookups
    const settlementMap = new Map();
    for (const s of settlements) {
        settlementMap.set(s.id, s);
    }
    const colonyMap = new Map();
    for (const c of colonies) {
        colonyMap.set(c.id, c);
    }
    for (const action of convertActions) {
        const settlementId = action.params.settlementId;
        const fromResource = action.params.fromResource;
        const toResource = action.params.toResource;
        const amount = Number(action.params.amount);
        // 1. Settlement exists
        const settlement = settlementMap.get(settlementId);
        if (!settlement) {
            actionResults.push({
                actionId: action.id,
                status: 'failed',
                result: `Settlement ${truncId(settlementId)} not found`,
            });
            continue;
        }
        // 2. Colony ownership
        if (settlement.colonyId !== action.colonyId) {
            actionResults.push({
                actionId: action.id,
                status: 'failed',
                result: `Settlement ${truncId(settlementId)} does not belong to this colony`,
            });
            continue;
        }
        // 3. Settlement has a market
        const market = settlement.buildings.find(b => b.type === 'market');
        if (!market) {
            actionResults.push({
                actionId: action.id,
                status: 'failed',
                result: `Settlement ${settlement.name} does not have a market building`,
            });
            continue;
        }
        // 4. Validate resource types
        if (!CONVERTIBLE_RESOURCES.includes(fromResource)) {
            actionResults.push({
                actionId: action.id,
                status: 'failed',
                result: `Invalid source resource: ${fromResource}. Must be one of: ${CONVERTIBLE_RESOURCES.join(', ')}`,
            });
            continue;
        }
        if (!CONVERTIBLE_RESOURCES.includes(toResource)) {
            actionResults.push({
                actionId: action.id,
                status: 'failed',
                result: `Invalid target resource: ${toResource}. Must be one of: ${CONVERTIBLE_RESOURCES.join(', ')}`,
            });
            continue;
        }
        if (fromResource === toResource) {
            actionResults.push({
                actionId: action.id,
                status: 'failed',
                result: `Cannot convert ${fromResource} to itself`,
            });
            continue;
        }
        // 5. Validate amount
        if (!Number.isFinite(amount) || amount <= 0) {
            actionResults.push({
                actionId: action.id,
                status: 'failed',
                result: `Amount must be a positive number`,
            });
            continue;
        }
        if (amount > MARKET_CONVERSION_MAX_AMOUNT) {
            actionResults.push({
                actionId: action.id,
                status: 'failed',
                result: `Amount exceeds maximum of ${MARKET_CONVERSION_MAX_AMOUNT} per action`,
            });
            continue;
        }
        // 6. Colony has enough resources
        const colony = colonyMap.get(action.colonyId);
        if (!colony) {
            actionResults.push({
                actionId: action.id,
                status: 'failed',
                result: `Colony ${truncId(action.colonyId)} not found`,
            });
            continue;
        }
        if (colony.resources[fromResource] < amount) {
            actionResults.push({
                actionId: action.id,
                status: 'failed',
                result: `Insufficient ${fromResource}: have ${colony.resources[fromResource]}, need ${amount}`,
            });
            continue;
        }
        // --- All checks passed: perform conversion ---
        const conversionRate = Math.max(MARKET_CONVERSION_MIN_RATE, MARKET_CONVERSION_BASE_RATE - (market.level - 1) * MARKET_CONVERSION_LEVEL_BONUS);
        const received = Math.round((amount / conversionRate) * 100) / 100;
        colony.resources[fromResource] = Math.round((colony.resources[fromResource] - amount) * 100) / 100;
        colony.resources[toResource] = Math.round((colony.resources[toResource] + received) * 100) / 100;
        events.push({
            type: 'resources_converted',
            colonyId: colony.id,
            data: {
                settlementId,
                settlementName: settlement.name,
                fromResource,
                toResource,
                spent: amount,
                received,
                conversionRate,
                marketLevel: market.level,
            },
        });
        actionResults.push({
            actionId: action.id,
            status: 'resolved',
            result: `Converted ${amount} ${fromResource} → ${received} ${toResource} (rate: ${conversionRate}:1, market level ${market.level})`,
        });
    }
    return { events, actionResults };
}
// --- Auto-Explore ---
/**
 * Auto-explore for idle scouts.
 *
 * Scouts with no movement queue and no action this tick automatically
 * pathfind toward the nearest unexplored passable hex. This ensures
 * scouts continuously push into fog of war without manual orders.
 *
 * Algorithm:
 * 1. Build an "explored" set per colony from hex exploredBy arrays
 * 2. For each idle scout, find unexplored hexes adjacent to explored territory
 * 3. Filter to passable terrain (not ocean)
 * 4. Pick the nearest candidate and pathfind to it
 * 5. Set the movement queue
 */
export function autoExploreIdleScouts(units, hexes, hexLookup, actionedUnitIds) {
    const events = [];
    // Build terrain map for quick lookups
    const terrainMap = new Map();
    for (const h of hexes) {
        terrainMap.set(`${h.x},${h.y}`, h.terrain);
    }
    // Build explored sets per colony
    const exploredByColony = new Map();
    for (const h of hexes) {
        if (h.exploredBy) {
            for (const colonyId of h.exploredBy) {
                if (!exploredByColony.has(colonyId)) {
                    exploredByColony.set(colonyId, new Set());
                }
                exploredByColony.get(colonyId).add(`${h.x},${h.y}`);
            }
        }
    }
    // All valid hex coords (for neighbor checks)
    const allHexKeys = new Set();
    for (const h of hexes) {
        allHexKeys.add(`${h.x},${h.y}`);
    }
    // Passable terrain types for exploration targets
    const PASSABLE_EXPLORE = new Set(['plains', 'forest', 'coast', 'desert', 'tundra', 'mountains']);
    // Find idle scouts
    const idleScouts = units.filter(u => u.type === 'scout' &&
        (!u.movementQueue || u.movementQueue.length === 0) &&
        !actionedUnitIds.has(u.id));
    for (const scout of idleScouts) {
        const exploredOrUndefined = exploredByColony.get(scout.colonyId);
        if (!exploredOrUndefined)
            continue;
        const explored = exploredOrUndefined;
        // Find frontier: unexplored hexes adjacent to explored territory
        // To be efficient, we check neighbors of explored hexes that are NOT explored
        const frontierCandidates = [];
        const frontierSeen = new Set();
        for (const exploredKey of explored) {
            const [eq, er] = exploredKey.split(',').map(Number);
            const neighbors = hexNeighbors({ q: eq, r: er });
            for (const n of neighbors) {
                const nKey = `${n.q},${n.r}`;
                if (frontierSeen.has(nKey))
                    continue;
                frontierSeen.add(nKey);
                // Must be on the map, unexplored, and passable
                if (!allHexKeys.has(nKey))
                    continue;
                if (explored.has(nKey))
                    continue;
                const terrain = terrainMap.get(nKey);
                if (!terrain || !PASSABLE_EXPLORE.has(terrain))
                    continue;
                frontierCandidates.push(n);
            }
        }
        if (frontierCandidates.length === 0)
            continue;
        // Score frontier candidates to prevent oscillation.
        // Each candidate is scored by how many of its own neighbors are unexplored
        // ("frontier depth"). Deeper frontier hexes have more unexplored neighbors,
        // while hexes adjacent to well-explored territory score low. This prevents
        // scouts from bouncing between two adjacent explored-edge hexes.
        // Tie-break: prefer candidates farther from the scout (push outward).
        const scoutPos = { q: scout.hexX, r: scout.hexY };
        function frontierScore(candidate) {
            const neighbors = hexNeighbors(candidate);
            let unexploredCount = 0;
            for (const n of neighbors) {
                const nk = `${n.q},${n.r}`;
                if (allHexKeys.has(nk) && !explored.has(nk)) {
                    unexploredCount++;
                }
            }
            // Primary: more unexplored neighbors = better (deeper frontier)
            // Secondary: farther from scout = better (push outward, break ties)
            return unexploredCount * 1000 + hexDistance(scoutPos, candidate);
        }
        frontierCandidates.sort((a, b) => frontierScore(b) - frontierScore(a));
        // Partition candidates: prefer those at distance >= 2 from the scout
        // to prevent 1-hop oscillation (scout bounces between adjacent hexes).
        const farCandidates = frontierCandidates.filter(c => hexDistance(scoutPos, c) >= 2);
        const nearCandidates = frontierCandidates.filter(c => hexDistance(scoutPos, c) < 2);
        // Try far candidates first (prevents oscillation)
        let bestPath = null;
        let bestTarget = null;
        for (let i = 0; i < Math.min(farCandidates.length, 15); i++) {
            const candidate = farCandidates[i];
            const path = findPath(scoutPos, candidate, hexLookup);
            if (path && path.length > 0) {
                bestPath = path;
                bestTarget = candidate;
                break;
            }
        }
        // Fallback: near candidates only if no far candidates have paths
        if (!bestPath) {
            for (let i = 0; i < Math.min(nearCandidates.length, 15); i++) {
                const candidate = nearCandidates[i];
                const path = findPath(scoutPos, candidate, hexLookup);
                if (path && path.length > 0) {
                    bestPath = path;
                    bestTarget = candidate;
                    break;
                }
            }
        }
        if (!bestPath || !bestTarget)
            continue;
        // Set movement queue
        scout.movementQueue = bestPath;
        events.push({
            type: 'auto_explore',
            colonyId: scout.colonyId,
            unitId: scout.id,
            data: {
                from: { x: scout.hexX, y: scout.hexY },
                to: { x: bestTarget.q, y: bestTarget.r },
                pathLength: bestPath.length,
            },
        });
    }
    return { events };
}
/**
 * Resolve research actions and advance research queues.
 *
 * Phase 1: Process research actions — validate and start research
 * Phase 2: Advance all research queues (decrement ticksRemaining)
 */
export function resolveResearch(colonies, settlements, actions) {
    const events = [];
    const actionResults = [];
    const researchActions = actions.filter(a => a.type === 'research');
    // Phase 1: Process research actions
    for (const action of researchActions) {
        const colony = colonies.find(c => c.id === action.colonyId);
        if (!colony) {
            actionResults.push({ actionId: action.id, status: 'failed', result: 'Colony not found' });
            continue;
        }
        const techId = action.params.techId;
        if (!techId || !TECH_TREE[techId]) {
            actionResults.push({ actionId: action.id, status: 'failed', result: `Unknown tech: ${techId}. Valid techs: ${Object.keys(TECH_TREE).join(', ')}` });
            continue;
        }
        const tech = TECH_TREE[techId];
        // Check colony has a workshop
        const colonySettlements = settlements.filter(s => s.colonyId === colony.id);
        const hasWorkshop = colonySettlements.some(s => s.buildings.some(b => b.type === 'workshop'));
        if (!hasWorkshop) {
            actionResults.push({ actionId: action.id, status: 'failed', result: 'You need a workshop building to research. Build a workshop first.' });
            continue;
        }
        // Check not already researched
        const researched = colony.researchedTechs ?? [];
        if (researched.includes(techId)) {
            actionResults.push({ actionId: action.id, status: 'failed', result: `Tech '${tech.name}' is already researched` });
            continue;
        }
        // Check prerequisites
        if (tech.requires) {
            const missing = tech.requires.filter(r => !researched.includes(r));
            if (missing.length > 0) {
                const names = missing.map(id => TECH_TREE[id]?.name ?? id).join(', ');
                actionResults.push({ actionId: action.id, status: 'failed', result: `Missing prerequisite tech(s): ${names}` });
                continue;
            }
        }
        // Check not already in queue
        const queue = colony.researchQueue ?? [];
        if (queue.some(q => q.techId === techId)) {
            actionResults.push({ actionId: action.id, status: 'failed', result: `Tech '${tech.name}' is already being researched` });
            continue;
        }
        // Check max 1 research at a time
        if (queue.length >= 1) {
            actionResults.push({ actionId: action.id, status: 'failed', result: 'Research queue is full (max 1 at a time). Wait for current research to complete.' });
            continue;
        }
        // Check resources
        for (const [resource, amount] of Object.entries(tech.cost)) {
            const key = resource;
            if ((colony.resources[key] ?? 0) < amount) {
                actionResults.push({ actionId: action.id, status: 'failed', result: `Not enough ${resource}: need ${amount}, have ${Math.floor(colony.resources[key] ?? 0)}` });
                continue;
            }
        }
        // Deduct resources
        for (const [resource, amount] of Object.entries(tech.cost)) {
            colony.resources[resource] -= amount;
        }
        // Add to queue
        queue.push({ techId, ticksRemaining: tech.ticks });
        colony.researchQueue = queue;
        actionResults.push({ actionId: action.id, status: 'resolved', result: `Started researching '${tech.name}' — ${tech.ticks} ticks remaining` });
        events.push({
            type: 'research_started',
            colonyId: colony.id,
            data: {
                techId,
                techName: tech.name,
                ticksRemaining: tech.ticks,
                cost: tech.cost,
            },
        });
    }
    // Phase 2: Advance all research queues
    for (const colony of colonies) {
        if (colony.status !== 'active')
            continue;
        const queue = colony.researchQueue ?? [];
        if (queue.length === 0)
            continue;
        const researched = colony.researchedTechs ?? [];
        const completed = [];
        for (let i = queue.length - 1; i >= 0; i--) {
            queue[i].ticksRemaining--;
            if (queue[i].ticksRemaining <= 0) {
                const techId = queue[i].techId;
                const tech = TECH_TREE[techId];
                researched.push(techId);
                completed.push(techId);
                queue.splice(i, 1);
                events.push({
                    type: 'research_complete',
                    colonyId: colony.id,
                    data: {
                        techId,
                        techName: tech?.name ?? techId,
                        description: tech?.description ?? '',
                        totalResearched: researched.length,
                    },
                });
            }
        }
        colony.researchQueue = queue;
        colony.researchedTechs = researched;
    }
    return { events, actionResults };
}
export const BREAK_TRADE_COST = 50;
export const BREAK_COSTS = {
    non_aggression: 30,
    trade: 50,
    alliance: 100,
};
export const PROPOSAL_EXPIRY_TICKS = 50;
/**
 * Resolve propose/accept/reject/break agreement actions.
 */
export function resolveAgreementActions(colonies, agreements, actions, currentTick) {
    const events = [];
    const actionResults = [];
    const mutations = [];
    const agreementActions = actions.filter(a => ['propose_agreement', 'accept_agreement', 'reject_agreement', 'break_agreement'].includes(a.type));
    for (const action of agreementActions) {
        const colony = colonies.find(c => c.id === action.colonyId);
        if (!colony) {
            actionResults.push({ actionId: action.id, status: 'failed', result: 'Colony not found' });
            continue;
        }
        if (action.type === 'propose_agreement') {
            const targetColonyId = action.params?.targetColonyId;
            const agreementType = action.params?.agreementType;
            if (!targetColonyId || !agreementType) {
                actionResults.push({ actionId: action.id, status: 'failed', result: 'Missing targetColonyId or agreementType' });
                continue;
            }
            const targetColony = colonies.find(c => c.id === targetColonyId);
            if (!targetColony) {
                actionResults.push({ actionId: action.id, status: 'failed', result: 'Target colony not found' });
                continue;
            }
            const existing = agreements.find(a => a.type === agreementType &&
                (a.status === 'proposed' || a.status === 'active') &&
                ((a.proposedBy === colony.id && a.proposedTo === targetColonyId) ||
                    (a.proposedBy === targetColonyId && a.proposedTo === colony.id)));
            if (existing) {
                actionResults.push({ actionId: action.id, status: 'failed', result: `Already have ${existing.status} ${agreementType} agreement` });
                continue;
            }
            const newAgreement = {
                id: `agr_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
                worldId: '',
                type: agreementType,
                proposedBy: colony.id,
                proposedTo: targetColonyId,
                status: 'proposed',
                terms: action.params?.terms || {},
                proposedAtTick: currentTick,
                acceptedAtTick: null,
            };
            mutations.push({ type: 'create', agreement: newAgreement });
            actionResults.push({ actionId: action.id, status: 'resolved' });
            events.push({ type: 'agreement_proposed', colonyId: colony.id, data: { agreementId: newAgreement.id, agreementType, targetColonyId, visibility: [colony.id, targetColonyId] } });
        }
        if (action.type === 'accept_agreement') {
            const agreementId = action.params?.agreementId;
            const agreement = agreements.find(a => a.id === agreementId);
            if (!agreement) {
                actionResults.push({ actionId: action.id, status: 'failed', result: 'Agreement not found' });
                continue;
            }
            if (agreement.proposedTo !== colony.id) {
                actionResults.push({ actionId: action.id, status: 'failed', result: 'Only the recipient can accept' });
                continue;
            }
            if (agreement.status !== 'proposed') {
                actionResults.push({ actionId: action.id, status: 'failed', result: `Agreement is ${agreement.status}` });
                continue;
            }
            agreement.status = 'active';
            agreement.acceptedAtTick = currentTick;
            mutations.push({ type: 'update', agreement: { ...agreement } });
            actionResults.push({ actionId: action.id, status: 'resolved' });
            events.push({ type: 'agreement_accepted', colonyId: colony.id, data: { agreementId, agreementType: agreement.type, partnerColonyId: agreement.proposedBy, visibility: [colony.id, agreement.proposedBy] } });
        }
        if (action.type === 'reject_agreement') {
            const agreementId = action.params?.agreementId;
            const agreement = agreements.find(a => a.id === agreementId);
            if (!agreement) {
                actionResults.push({ actionId: action.id, status: 'failed', result: 'Agreement not found' });
                continue;
            }
            if (agreement.proposedTo !== colony.id) {
                actionResults.push({ actionId: action.id, status: 'failed', result: 'Only the recipient can reject' });
                continue;
            }
            if (agreement.status !== 'proposed') {
                actionResults.push({ actionId: action.id, status: 'failed', result: `Agreement is ${agreement.status}` });
                continue;
            }
            agreement.status = 'rejected';
            mutations.push({ type: 'update', agreement: { ...agreement } });
            actionResults.push({ actionId: action.id, status: 'resolved' });
            events.push({ type: 'agreement_rejected', colonyId: colony.id, data: { agreementId, agreementType: agreement.type, visibility: [colony.id, agreement.proposedBy] } });
        }
        if (action.type === 'break_agreement') {
            const agreementId = action.params?.agreementId;
            const agreement = agreements.find(a => a.id === agreementId);
            if (!agreement) {
                actionResults.push({ actionId: action.id, status: 'failed', result: 'Agreement not found' });
                continue;
            }
            if (agreement.status !== 'active') {
                actionResults.push({ actionId: action.id, status: 'failed', result: `Agreement is ${agreement.status}` });
                continue;
            }
            if (agreement.proposedBy !== colony.id && agreement.proposedTo !== colony.id) {
                actionResults.push({ actionId: action.id, status: 'failed', result: 'Not party to this agreement' });
                continue;
            }
            const influenceCost = BREAK_COSTS[agreement.type] || 50;
            if ((colony.resources?.influence ?? 0) < influenceCost) {
                actionResults.push({ actionId: action.id, status: 'failed', result: `Need ${influenceCost} influence` });
                continue;
            }
            colony.resources.influence = (colony.resources.influence ?? 0) - influenceCost;
            agreement.status = 'broken';
            mutations.push({ type: 'update', agreement: { ...agreement } });
            actionResults.push({ actionId: action.id, status: 'resolved' });
            const partnerId = agreement.proposedBy === colony.id ? agreement.proposedTo : agreement.proposedBy;
            events.push({ type: 'agreement_broken', colonyId: colony.id, data: { agreementId, agreementType: agreement.type, brokenBy: colony.id, influenceCost, visibility: [colony.id, partnerId] } });
        }
    }
    // Expire old proposals
    for (const agreement of agreements) {
        if (agreement.status === 'proposed' && (currentTick - agreement.proposedAtTick) >= PROPOSAL_EXPIRY_TICKS) {
            agreement.status = 'rejected';
            mutations.push({ type: 'update', agreement: { ...agreement } });
            events.push({ type: 'agreement_expired', colonyId: agreement.proposedBy, data: { agreementId: agreement.id, agreementType: agreement.type, visibility: [agreement.proposedBy, agreement.proposedTo] } });
        }
    }
    return { events, actionResults, mutations };
}
/**
 * Transfer resources between colonies with active trade agreements.
 */
export function resolveTradeTransfers(colonies, agreements) {
    const events = [];
    const activeTradeAgreements = agreements.filter(a => a.type === 'trade' && a.status === 'active');
    for (const agreement of activeTradeAgreements) {
        const terms = agreement.terms;
        if (!terms?.gives || !terms?.receives)
            continue;
        const giver = colonies.find(c => c.id === agreement.proposedBy);
        const receiver = colonies.find(c => c.id === agreement.proposedTo);
        if (!giver || !receiver)
            continue;
        let canTransfer = true;
        for (const [res, amount] of Object.entries(terms.gives)) {
            if ((giver.resources[res] ?? 0) < (amount ?? 0)) {
                canTransfer = false;
                break;
            }
        }
        if (!canTransfer)
            continue;
        for (const [res, amount] of Object.entries(terms.receives)) {
            if ((receiver.resources[res] ?? 0) < (amount ?? 0)) {
                canTransfer = false;
                break;
            }
        }
        if (!canTransfer)
            continue;
        for (const [res, amount] of Object.entries(terms.gives)) {
            const key = res;
            giver.resources[key] = (giver.resources[key] ?? 0) - (amount ?? 0);
            receiver.resources[key] = (receiver.resources[key] ?? 0) + (amount ?? 0);
        }
        for (const [res, amount] of Object.entries(terms.receives)) {
            const key = res;
            receiver.resources[key] = (receiver.resources[key] ?? 0) - (amount ?? 0);
            giver.resources[key] = (giver.resources[key] ?? 0) + (amount ?? 0);
        }
        events.push({ type: 'trade_transfer', colonyId: giver.id, data: { agreementId: agreement.id, from: giver.id, to: receiver.id, visibility: [giver.id, receiver.id] } });
    }
    return { colonies, events };
}
export function resolveTick(colonies, settlements, units, hexes, actions = [], combatSeed, worldId, currentTick, agreements) {
    const events = [];
    const desertedUnitIds = [];
    let actionResults = [];
    let fogReveals = [];
    let newMessages = [];
    let agreementMutations = [];
    // --- Agreement resolution (before other actions) ---
    {
        const agreementResult = resolveAgreementActions(colonies, agreements || [], actions, currentTick || 0);
        events.push(...agreementResult.events);
        actionResults.push(...agreementResult.actionResults);
        agreementMutations = agreementResult.mutations;
        const agreementTypes = new Set(['propose_agreement', 'accept_agreement', 'reject_agreement', 'break_agreement']);
        actions = actions.filter(a => !agreementTypes.has(a.type));
    }
    // --- Deduplicate actions per unit ---
    // Edge case handling (Issue #123):
    // 1. Multiple move/attack actions for the same unit → keep only the last one.
    // 2. found_settlement + move_unit for the same settler → found takes priority,
    //    move is rejected (founding consumes the settler in Phase -1 before movement).
    // 3. Resource-consuming actions (build, train, etc.) are processed in array order
    //    within each phase — first-come-first-served. If multiple actions exceed available
    //    resources, the first one(s) succeed and later ones fail with "Insufficient resources".
    {
        // Collect units that have found_settlement actions (these settlers will be consumed)
        const foundSettlerIds = new Set();
        for (const a of actions) {
            if (a.type === 'found_settlement') {
                const unitId = a.params?.unitId || null;
                if (unitId)
                    foundSettlerIds.add(unitId);
            }
        }
        const unitActions = new Map(); // unitId -> last action index
        const deduped = [];
        for (let i = 0; i < actions.length; i++) {
            const a = actions[i];
            const unitId = a.params?.unitId || null;
            if (unitId && (a.type === 'move_unit' || a.type === 'attack' || a.type === 'explore')) {
                unitActions.set(unitId, i);
            }
        }
        for (let i = 0; i < actions.length; i++) {
            const a = actions[i];
            const unitId = a.params?.unitId || null;
            if (unitId && (a.type === 'move_unit' || a.type === 'attack' || a.type === 'explore')) {
                // Reject movement for settlers that are being consumed by found_settlement
                if (foundSettlerIds.has(unitId)) {
                    actionResults.push({
                        actionId: a.id,
                        status: 'failed',
                        result: `Unit ${unitId} has a found_settlement action — movement rejected (settler will be consumed)`,
                    });
                    continue;
                }
                if (unitActions.get(unitId) === i) {
                    deduped.push(a); // keep only the last move/attack per unit
                }
                else {
                    actionResults.push({ actionId: a.id, status: 'failed', result: 'Superseded by later action for same unit' });
                }
            }
            else {
                deduped.push(a); // non-unit actions are always kept
            }
        }
        // Replace actions with deduped list for all subsequent phases
        actions = deduped;
    }
    // Build hex lookup
    const hexMap = new Map();
    for (const hex of hexes) {
        hexMap.set(hexKey(hex.x, hex.y), hex);
    }
    // Build set of all valid hex coordinates (used for fog reveals)
    const allHexCoords = new Set();
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
        const foundResult = resolveFoundSettlement(updatedUnits, updatedColonies, updatedSettlements, hexes, actions, allHexCoords);
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
    const unitPositionsBefore = new Map();
    for (const u of updatedUnits) {
        unitPositionsBefore.set(u.id, { x: u.hexX, y: u.hexY });
    }
    // --- Phase 0: Resolve movement actions + advance movement queues ---
    const hexLookup = createHexLookup(hexes.map(h => ({ x: h.x, y: h.y, terrain: h.terrain })));
    const hasMovingUnits = updatedUnits.some(u => u.movementQueue && u.movementQueue.length > 0);
    const nonFoundActions = actions.filter(a => a.type !== 'found_settlement');
    if (nonFoundActions.length > 0 || hasMovingUnits) {
        const moveResult = resolveMovement(updatedUnits, nonFoundActions, hexLookup);
        events.push(...moveResult.events);
        actionResults.push(...moveResult.actionResults);
    }
    // --- Phase 0.1: Auto-explore idle scouts ---
    // Scouts with no movement queue and no action this tick automatically
    // pathfind toward the nearest unexplored frontier hex.
    {
        const actionedUnitIds = new Set();
        for (const action of actions) {
            const unitId = action.params.unitId;
            if (unitId)
                actionedUnitIds.add(unitId);
        }
        const exploreResult = autoExploreIdleScouts(updatedUnits, hexes, hexLookup, actionedUnitIds);
        events.push(...exploreResult.events);
        // Advance auto-explore scouts' movement queues immediately this tick
        for (const unit of updatedUnits) {
            if (unit.type === 'scout' && unit.movementQueue && unit.movementQueue.length > 0) {
                // Only advance if this scout was just assigned an auto-explore path
                // (it wasn't tracked in unitPositionsBefore as moving)
                const before = unitPositionsBefore.get(unit.id);
                if (before && before.x === unit.hexX && before.y === unit.hexY) {
                    // Scout didn't move in Phase 0 — check if it has a new queue from auto-explore
                    const isAutoExplore = exploreResult.events.some(e => e.type === 'auto_explore' && e.unitId === unit.id);
                    if (isAutoExplore) {
                        const steps = movementStepsThisTick(unit.movementQueue, unit.type, hexLookup);
                        if (steps > 0) {
                            const moved = unit.movementQueue.slice(0, steps);
                            const destination = moved[moved.length - 1];
                            unit.hexX = destination.q;
                            unit.hexY = destination.r;
                            unit.movementQueue = unit.movementQueue.slice(steps);
                            events.push({
                                type: 'unit_moved',
                                colonyId: unit.colonyId,
                                unitId: unit.id,
                                data: {
                                    from: { x: before.x, y: before.y },
                                    to: { x: unit.hexX, y: unit.hexY },
                                    steps: moved.map(s => ({ x: s.q, y: s.r })),
                                    remainingPath: unit.movementQueue.length,
                                    autoExplore: true,
                                },
                            });
                        }
                    }
                }
            }
        }
    }
    // --- Phase 0.25: Resolve combat (after movement, before fog) ---
    // Units from different colonies sharing a hex fight automatically.
    {
        const combatResult = resolveCombat(updatedUnits, actions, combatSeed, agreements);
        if (combatResult.destroyedUnitIds.length > 0 || combatResult.events.length > 0) {
            updatedUnits = combatResult.units.map(u => ({
                ...u,
                movementQueue: u.movementQueue ? [...u.movementQueue] : [],
            }));
            events.push(...combatResult.events);
            actionResults.push(...combatResult.actionResults);
        }
    }
    // --- Phase 0.5: Fog of war reveals for units that moved ---
    const movedUnits = updatedUnits.filter(u => {
        const before = unitPositionsBefore.get(u.id);
        return before && (before.x !== u.hexX || before.y !== u.hexY);
    });
    if (movedUnits.length > 0) {
        // Build already-explored map from hex data
        const alreadyExplored = new Map();
        for (const hex of hexes) {
            if (hex.exploredBy) {
                for (const colonyId of hex.exploredBy) {
                    alreadyExplored.set(`${colonyId}:${hex.x},${hex.y}`, true);
                }
            }
        }
        // Build intel map for scouting reports
        const settlementHexes = new Map();
        for (const s of updatedSettlements) {
            settlementHexes.set(`${s.hexX},${s.hexY}`, { colonyId: s.colonyId, name: s.name });
        }
        const unitHexes = new Map();
        for (const u of updatedUnits) {
            const key = `${u.hexX},${u.hexY}`;
            if (!unitHexes.has(key))
                unitHexes.set(key, []);
            unitHexes.get(key).push({ colonyId: u.colonyId, type: u.type });
        }
        const fogResult = computeFogReveals(movedUnits, allHexCoords, alreadyExplored, { settlementHexes, unitHexes });
        fogReveals.push(...fogResult.reveals);
        events.push(...fogResult.events);
        // --- POI Discovery: check newly revealed hexes for discovery POIs ---
        const DISCOVERY_BONUSES = {
            ancient_ruins: { stone: 50, iron: 30 },
            abandoned_cache: { food: 30, timber: 20, stone: 20 },
            crystal_cavern: { iron: 80 },
        };
        for (const reveal of fogResult.reveals) {
            const hex = hexMap.get(hexKey(reveal.hex.q, reveal.hex.r));
            if (!hex?.poi)
                continue;
            if (hex.poi.discoveredBy)
                continue; // Already discovered by someone else
            const poiType = hex.poi.type;
            const bonus = DISCOVERY_BONUSES[poiType];
            // Mark POI as discovered
            hex.poi = { ...hex.poi, discoveredBy: reveal.colonyId, discoveredAtTick: currentTick ?? 0 };
            if (bonus) {
                // Apply one-time resource bonus to discovering colony
                const colony = updatedColonies.find(c => c.id === reveal.colonyId);
                if (colony) {
                    for (const [resource, amount] of Object.entries(bonus)) {
                        colony.resources[resource] += amount;
                    }
                    events.push({
                        type: 'poi_discovered',
                        colonyId: reveal.colonyId,
                        data: {
                            poiType,
                            x: reveal.hex.q,
                            y: reveal.hex.r,
                            bonus,
                            message: `Discovered ${poiType.replace(/_/g, ' ')}! Gained ${Object.entries(bonus).map(([r, a]) => `${a} ${r}`).join(', ')}.`,
                        },
                    });
                }
            }
            else {
                // Strategic POIs (watchtower, sacred_grove) — just announce discovery
                events.push({
                    type: 'poi_discovered',
                    colonyId: reveal.colonyId,
                    data: {
                        poiType,
                        x: reveal.hex.q,
                        y: reveal.hex.r,
                        message: `Discovered ${poiType.replace(/_/g, ' ')} at (${reveal.hex.q}, ${reveal.hex.r})!`,
                    },
                });
            }
        }
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
            movementQueue: [],
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
    // --- Phase 1.9: Resolve send_message actions ---
    const messageActions = actions.filter(a => a.type === 'send_message');
    if (messageActions.length > 0 && worldId && currentTick !== undefined) {
        const messageResult = resolveMessages(updatedColonies, actions, worldId, currentTick);
        events.push(...messageResult.events);
        actionResults.push(...messageResult.actionResults);
        newMessages = messageResult.messages;
    }
    // --- Phase 1.95: Resolve convert_resources actions (market) ---
    const convertActions = actions.filter(a => a.type === 'convert_resources');
    if (convertActions.length > 0) {
        const convertResult = resolveConvertResources(updatedSettlements, updatedColonies, actions);
        events.push(...convertResult.events);
        actionResults.push(...convertResult.actionResults);
    }
    // --- Phase 2: Resolve research actions + advance research queues ---
    const researchResult = resolveResearch(updatedColonies, updatedSettlements, actions);
    events.push(...researchResult.events);
    actionResults.push(...researchResult.actionResults);
    // Group settlements and units by colony
    const colonySettlements = new Map();
    const colonyUnits = new Map();
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
        if (colony.status !== 'active')
            continue;
        // Sanitize resources: replace null/NaN with 0 (guards against corrupted DB data)
        for (const key of ['food', 'timber', 'stone', 'iron', 'influence']) {
            if (colony.resources[key] == null || Number.isNaN(colony.resources[key])) {
                colony.resources[key] = 0;
            }
        }
        const mySettlements = colonySettlements.get(colony.id) ?? [];
        const myUnits = colonyUnits.get(colony.id) ?? [];
        // --- Production ---
        const totalProduction = { food: 0, timber: 0, stone: 0, iron: 0, influence: 0 };
        const totalUpkeep = { food: 0, timber: 0, stone: 0, iron: 0, influence: 0 };
        for (const settlement of mySettlements) {
            // Get neighboring hexes for this settlement
            const neighbors = hexNeighbors({ q: settlement.hexX, r: settlement.hexY });
            const nearbyHexes = [
                hexMap.get(hexKey(settlement.hexX, settlement.hexY)),
                ...neighbors.map(n => hexMap.get(hexKey(n.q, n.r))),
            ].filter(Boolean);
            const production = calculateProduction(settlement, nearbyHexes);
            const upkeep = calculateBuildingUpkeep(settlement);
            for (const key of Object.keys(totalProduction)) {
                totalProduction[key] += production[key] ?? 0;
                totalUpkeep[key] += upkeep[key] ?? 0;
            }
            // Population food consumption
            totalUpkeep.food += calculatePopulationConsumption(settlement);
        }
        // Unit food upkeep
        totalUpkeep.food += calculateUnitUpkeep(myUnits);
        // --- Apply research bonuses ---
        const researched = colony.researchedTechs ?? [];
        // Improved Agriculture: +30% food production
        if (researched.includes('improved_agriculture')) {
            totalProduction.food = Math.round(totalProduction.food * 1.3 * 100) / 100;
        }
        // Trade Routes: +5 influence per tick, +2 food per settlement beyond first
        if (researched.includes('trade_routes')) {
            totalProduction.influence += 5;
            if (mySettlements.length > 1) {
                totalProduction.food += (mySettlements.length - 1) * 2;
            }
        }
        // --- POI Resource Bonuses ---
        // Resource POIs within 3 hexes of a settlement provide bonus resources per tick
        const POI_RESOURCE_RANGE = 3;
        const poiBonuses = { food: 0, timber: 0, stone: 0, iron: 0, influence: 0 };
        const claimedPoiHexes = new Set();
        for (const settlement of mySettlements) {
            const settlementCoord = { q: settlement.hexX, r: settlement.hexY };
            // Scan all hexes with POIs and check distance
            for (const [key, hex] of hexMap.entries()) {
                if (!hex.poi)
                    continue;
                if (claimedPoiHexes.has(key))
                    continue; // Don't double-count
                if (hexDistance(settlementCoord, { q: hex.x, r: hex.y }) > POI_RESOURCE_RANGE)
                    continue;
                switch (hex.poi.type) {
                    case 'mineral_deposit':
                        poiBonuses.iron += 2;
                        poiBonuses.stone += 1;
                        claimedPoiHexes.add(key);
                        break;
                    case 'fertile_valley':
                        poiBonuses.food += 3;
                        claimedPoiHexes.add(key);
                        break;
                    case 'ancient_forest':
                        poiBonuses.timber += 2;
                        poiBonuses.food += 1;
                        claimedPoiHexes.add(key);
                        break;
                    // Discovery and strategic POIs don't produce resources here
                }
            }
        }
        for (const key of Object.keys(totalProduction)) {
            totalProduction[key] += poiBonuses[key];
        }
        // --- Apply net resources ---
        const net = { food: 0, timber: 0, stone: 0, iron: 0, influence: 0 };
        for (const key of Object.keys(net)) {
            net[key] = totalProduction[key] - totalUpkeep[key];
            colony.resources[key] = Math.round((colony.resources[key] + net[key]) * 100) / 100;
        }
        // Clamp ALL resources to 0 (stockpiles cannot go negative)
        for (const key of ['food', 'timber', 'stone', 'iron', 'influence']) {
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
                        }
                        else {
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
        // --- Trade agreement transfers ---
        if (agreements && agreements.length > 0) {
            const tradeResult = resolveTradeTransfers(colonies, agreements);
            events.push(...tradeResult.events);
        }
        // --- Stockpile decay: resources above cap decay each tick ---
        // Cap is determined by the highest-tier settlement the colony owns.
        // Granary buildings add bonus capacity.
        let highestTier = 'outpost';
        let totalGranaryLevels = 0;
        let totalWarehouseLevels = 0;
        for (const s of mySettlements) {
            const tierIdx = TIER_ORDER.indexOf(s.tier);
            if (tierIdx > TIER_ORDER.indexOf(highestTier)) {
                highestTier = s.tier;
            }
            for (const b of s.buildings) {
                if (b.type === 'granary')
                    totalGranaryLevels += b.level;
                if (b.type === 'warehouse')
                    totalWarehouseLevels += b.level;
            }
        }
        const baseCap = STOCKPILE_CAP[highestTier] ?? 500;
        const effectiveCap = baseCap + totalGranaryLevels * GRANARY_BONUS_PER_LEVEL + totalWarehouseLevels * WAREHOUSE_BONUS_PER_LEVEL;
        for (const key of ['food', 'timber', 'stone', 'iron']) {
            if (colony.resources[key] > effectiveCap) {
                // Hard ceiling: immediately clamp to cap × STOCKPILE_HARD_CEILING
                const hardCeiling = Math.round(effectiveCap * STOCKPILE_HARD_CEILING);
                let clamped = 0;
                if (colony.resources[key] > hardCeiling) {
                    clamped = Math.round((colony.resources[key] - hardCeiling) * 100) / 100;
                    colony.resources[key] = hardCeiling;
                }
                // Then apply percentage decay on remaining excess
                const excess = colony.resources[key] - effectiveCap;
                const decayed = Math.round(excess * STOCKPILE_DECAY_RATE * 100) / 100;
                colony.resources[key] = Math.round((colony.resources[key] - decayed) * 100) / 100;
                const totalDecayed = Math.round((clamped + decayed) * 100) / 100;
                events.push({
                    type: 'stockpile_decay',
                    colonyId: colony.id,
                    data: {
                        resource: key,
                        decayed: totalDecayed,
                        clamped,
                        cap: effectiveCap,
                        hardCeiling,
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
                settlements: mySettlements.map(s => ({
                    id: s.id,
                    name: s.name,
                    tier: s.tier,
                    buildingSlots: { used: s.buildings.length + s.buildQueue.length, max: BUILDING_SLOTS[s.tier] ?? 4 },
                    population: s.population,
                    maxPopulation: MAX_POPULATION[s.tier] ?? 50,
                })),
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
        // --- Food deficit: famine triggers on meaningful negative net food production ---
        // Suppress famine warnings when:
        // 1. Deficit is tiny (< 1.0/tick) — likely rounding noise or pop growth oscillation
        // 2. Stockpile covers >50 ticks of the deficit — colony has plenty of reserves
        // Only fires when deficit is significant AND reserves are running low.
        const ticksOfReserves = net.food < 0 ? colony.resources.food / Math.abs(net.food) : Infinity;
        if (net.food < -1.0 || (net.food < 0 && ticksOfReserves < 50)) {
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
                const tickDesertions = [];
                const moraleWarnings = [];
                for (const unit of updatedUnits.filter(u => u.colonyId === colony.id)) {
                    unit.morale = Math.max(0, unit.morale - effectiveMoraleLoss);
                    // Probabilistic desertion: each unit at/below threshold has DESERTION_CHANCE to desert
                    if (unit.morale <= DESERTION_THRESHOLD) {
                        const roll = Math.random();
                        if (roll < DESERTION_CHANCE) {
                            desertedUnitIds.push(unit.id);
                            tickDesertions.push({ type: unit.type, id: unit.id, morale: unit.morale });
                        }
                    }
                    else if (unit.morale <= MORALE_WARNING_THRESHOLD) {
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
        // --- Sacred Grove morale bonus ---
        // Units within 5 hexes of a sacred_grove get +0.01 morale/tick
        const SACRED_GROVE_RANGE = 5;
        const SACRED_GROVE_BONUS = 0.01;
        for (const unit of updatedUnits.filter(u => u.colonyId === colony.id)) {
            for (const hex of hexes) {
                if (!hex.poi || hex.poi.type !== 'sacred_grove')
                    continue;
                if (hexDistance({ q: unit.hexX, r: unit.hexY }, { q: hex.x, r: hex.y }) <= SACRED_GROVE_RANGE) {
                    unit.morale = Math.min(1.0, Math.round((unit.morale + SACRED_GROVE_BONUS) * 100) / 100);
                    break; // One grove is enough
                }
            }
        }
    }
    // --- Idle unit tracking ---
    // A unit is "active" if it moved, has a movement queue, or received an action this tick.
    const unitActionTargets = new Set();
    for (const action of actions) {
        const unitId = action.params.unitId;
        if (unitId)
            unitActionTargets.add(unitId);
    }
    // Newly trained units (not in unitPositionsBefore) start at 0
    for (const unit of updatedUnits) {
        if (desertedUnitIds.includes(unit.id))
            continue;
        const isNewUnit = !unitPositionsBefore.has(unit.id);
        if (isNewUnit) {
            unit.idleTicks = 0;
            continue;
        }
        const before = unitPositionsBefore.get(unit.id);
        const moved = before.x !== unit.hexX || before.y !== unit.hexY;
        const hasQueue = unit.movementQueue && unit.movementQueue.length > 0;
        const hadAction = unitActionTargets.has(unit.id);
        if (moved || hasQueue || hadAction) {
            unit.idleTicks = 0;
        }
        else {
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
    // Emit action_failed events so failures appear in the event feed
    for (const ar of actionResults) {
        if (ar.status === 'failed') {
            // Find the original action to get colony context
            const action = actions.find(a => a.id === ar.actionId);
            if (action) {
                events.push({
                    type: 'action_failed',
                    colonyId: action.colonyId,
                    data: {
                        actionId: ar.actionId,
                        actionType: action.type,
                        reason: ar.result || 'Unknown error',
                        params: action.params,
                    },
                });
            }
        }
    }
    // --- Legacy Score Tracking ---
    // Award points based on events that happened this tick
    for (const colony of updatedColonies) {
        if (colony.status !== 'active')
            continue;
        // +1 per tick alive
        colony.legacyScore = (colony.legacyScore ?? 0) + SCORE_PER_TICK;
        // Score from events
        for (const event of events) {
            if (!('colonyId' in event) || event.colonyId !== colony.id)
                continue;
            switch (event.type) {
                case 'settlement_founded':
                    colony.legacyScore += SCORE_SETTLEMENT_FOUNDED;
                    break;
                case 'settlement_upgraded':
                    if (event.data?.newTier === 'town')
                        colony.legacyScore += SCORE_UPGRADE_TOWN;
                    if (event.data?.newTier === 'city')
                        colony.legacyScore += SCORE_UPGRADE_CITY;
                    break;
                case 'building_complete':
                    colony.legacyScore += SCORE_BUILDING_BUILT;
                    break;
                case 'unit_trained':
                    colony.legacyScore += SCORE_UNIT_TRAINED;
                    break;
                case 'combat_resolved':
                    if (event.data?.winner === colony.id)
                        colony.legacyScore += SCORE_COMBAT_VICTORY;
                    break;
                case 'research_complete':
                    colony.legacyScore += SCORE_RESEARCH_COMPLETE;
                    break;
            }
        }
    }
    // --- Colony Neglect & Death ---
    const deadColonyIds = [];
    if (currentTick) {
        for (const colony of updatedColonies) {
            if (colony.status !== 'active')
                continue;
            const colonyUnits = survivingUnits.filter(u => u.colonyId === colony.id);
            const colonySettlements = updatedSettlements.filter(s => s.colonyId === colony.id);
            // Check for colony death: no units AND no settlements
            if (colonyUnits.length === 0 && colonySettlements.length === 0) {
                colony.status = 'dead';
                colony.diedAtTick = currentTick;
                colony.deathReason = 'All units lost and all settlements destroyed.';
                deadColonyIds.push(colony.id);
                events.push({
                    type: 'colony_dead',
                    colonyId: colony.id,
                    data: { reason: 'abandoned', tick: currentTick, message: colony.name + ' has fallen. All units deserted and settlements crumbled.' },
                });
                continue;
            }
            // Check for no units (but has settlements) — colony still dies, settlements decay
            if (colonyUnits.length === 0) {
                colony.status = 'dead';
                colony.diedAtTick = currentTick;
                colony.deathReason = 'All units lost. Settlements abandoned.';
                deadColonyIds.push(colony.id);
                events.push({
                    type: 'colony_dead',
                    colonyId: colony.id,
                    data: { reason: 'no_units', tick: currentTick, message: colony.name + ' has collapsed. No units remain to maintain the colony.' },
                });
                continue;
            }
            // Neglect checks (only if lastActionTick is tracked)
            const lastAction = colony.lastActionTick ?? 0;
            const ticksSinceAction = currentTick - lastAction;
            if (ticksSinceAction >= COLONY_NEGLECT_DECAY_TICKS) {
                // Accelerated morale decay for neglected colonies
                for (const unit of colonyUnits) {
                    unit.morale = Math.max(0, Math.round((unit.morale - COLONY_NEGLECT_MORALE_PENALTY) * 100) / 100);
                }
                // Emit decay event once per 50-tick interval
                if (ticksSinceAction % 50 === 0) {
                    events.push({
                        type: 'colony_neglected',
                        colonyId: colony.id,
                        data: {
                            ticksSinceAction,
                            message: colony.name + ' is deteriorating from neglect. Units are losing morale.',
                            unitsRemaining: colonyUnits.length,
                        },
                    });
                }
            }
            else if (ticksSinceAction >= COLONY_NEGLECT_WARNING_TICKS) {
                // Warning event (once when threshold is first crossed)
                if (ticksSinceAction === COLONY_NEGLECT_WARNING_TICKS) {
                    events.push({
                        type: 'colony_neglect_warning',
                        colonyId: colony.id,
                        data: {
                            ticksSinceAction,
                            message: colony.name + ' has been unattended for ' + Math.round(ticksSinceAction * 5 / 60) + ' hours. Decay will begin soon.',
                        },
                    });
                }
            }
        }
    }
    return {
        colonies: updatedColonies,
        settlements: updatedSettlements,
        units: survivingUnits,
        events,
        desertedUnitIds,
        deadColonyIds,
        actionResults,
        fogReveals,
        newMessages,
        agreementMutations,
    };
}
