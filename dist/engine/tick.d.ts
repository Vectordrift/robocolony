/**
 * Tick engine — resolves one game tick.
 *
 * Pure function: takes world state in, returns updated state + events out.
 * No database access — the scheduler handles persistence.
 */
import type { HexCoord } from './hex.js';
import type { HexResources } from './mapgen.js';
import type { HexLookup } from './pathfinding.js';
import type { HexExploration } from './fog.js';
export interface Colony {
    id: string;
    worldId: string;
    name: string;
    resources: Resources;
    legacyScore: number;
    status: string;
    lastActionTick?: number;
    diedAtTick?: number;
    deathReason?: string;
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
export type BuildingType = 'farm' | 'lumberMill' | 'quarry' | 'mine' | 'barracks' | 'granary' | 'market' | 'workshop';
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
export interface MessageRecord {
    id: string;
    worldId: string;
    fromColony: string;
    toColony: string;
    sentAtTick: number;
    deliveredAtTick: number;
    content: string;
    read: boolean;
}
export interface ResearchQueueEntry {
    techId: string;
    ticksRemaining: number;
}
export type TechId = 'improved_agriculture' | 'fortifications' | 'advanced_scouting' | 'steel_weapons' | 'trade_routes' | 'siege_engineering';
export interface TechDefinition {
    id: TechId;
    name: string;
    description: string;
    cost: Partial<Resources>;
    ticks: number;
    requires?: TechId[];
}
export declare const TECH_TREE: Record<TechId, TechDefinition>;
export declare const SCORE_RESEARCH_COMPLETE = 75;
export interface TickResult {
    colonies: Colony[];
    settlements: Settlement[];
    units: Unit[];
    events: TickEvent[];
    desertedUnitIds: string[];
    deadColonyIds: string[];
    actionResults: ActionResult[];
    fogReveals: HexExploration[];
    newMessages: MessageRecord[];
    agreementMutations: AgreementMutation[];
}
/** Settlement tier multipliers for production */
export declare const TIER_MULTIPLIER: Record<string, number>;
/** Building production per level */
export declare const BUILDING_PRODUCTION: Record<BuildingType, Partial<Resources>>;
/** Building upkeep per level (resources consumed per tick) */
export declare const BUILDING_UPKEEP: Record<BuildingType, Partial<Resources>>;
/** Building construction costs */
export declare const BUILDING_COSTS: Record<BuildingType, Partial<Resources>>;
/** Maximum building level */
export declare const MAX_BUILDING_LEVEL = 3;
/** Building upgrade time in ticks (same as construction) */
export declare const UPGRADE_BUILD_TIME = 3;
/**
 * Calculate upgrade cost for a building at the given level.
 * Upgrading from level N to N+1 costs: base_cost × N (escalating).
 */
export declare function buildingUpgradeCost(type: BuildingType, currentLevel: number): Partial<Resources>;
/** Ticks required to construct any building */
export declare const BUILD_TIME = 3;
/** All valid building types */
export declare const VALID_BUILDING_TYPES: BuildingType[];
/** Unit food upkeep per tick */
export declare const UNIT_UPKEEP: Record<UnitType, number>;
/** Population food consumption per person per tick */
export declare const POP_FOOD_CONSUMPTION = 0.4;
/** Unit training costs (resources needed to recruit) */
export declare const UNIT_TRAINING_COSTS: Record<UnitType, Partial<Resources>>;
/** All valid unit types for training */
export declare const VALID_UNIT_TYPES: UnitType[];
/** Base morale loss per tick when food is negative (scaled by deficit severity) */
export declare const MORALE_LOSS_RATE = 0.03;
/** Morale threshold below which a unit may desert */
export declare const DESERTION_THRESHOLD = 0.2;
/** Probability a unit deserts each tick when at or below DESERTION_THRESHOLD */
export declare const DESERTION_CHANCE = 0.3;
/** Morale level at which a warning event fires (before desertion) */
export declare const MORALE_WARNING_THRESHOLD = 0.4;
/** Maximum morale loss multiplier from deficit severity */
export declare const MAX_DEFICIT_MULTIPLIER = 3;
export declare const SCORE_PER_TICK = 1;
export declare const SCORE_SETTLEMENT_FOUNDED = 50;
export declare const SCORE_UPGRADE_TOWN = 100;
export declare const SCORE_UPGRADE_CITY = 250;
export declare const SCORE_BUILDING_BUILT = 25;
export declare const SCORE_UNIT_TRAINED = 10;
export declare const SCORE_COMBAT_VICTORY = 100;
/** Morale recovery per tick when food is positive */
export declare const MORALE_RECOVERY_RATE = 0.1;
/** Ticks of inactivity before emitting idle unit warning */
export declare const IDLE_WARNING_TICKS = 3;
/** Ticks of colony inactivity before warning event */
export declare const COLONY_NEGLECT_WARNING_TICKS = 100;
/** Ticks of inactivity before accelerated decay begins */
export declare const COLONY_NEGLECT_DECAY_TICKS = 200;
/** Extra morale loss per tick for neglected colonies */
export declare const COLONY_NEGLECT_MORALE_PENALTY = 0.02;
/** Ticks after colony death before history is purged */
export declare const COLONY_DEATH_HISTORY_TICKS = 500;
/** Resource cost to found a new settlement */
export declare const FOUNDING_COST: Partial<Resources>;
/** Minimum hex distance between any two settlements */
export declare const MIN_SETTLEMENT_DISTANCE = 3;
/** Fog reveal radius for a newly founded settlement */
export declare const FOUNDING_REVEAL_RADIUS = 2;
/** Terrains where settlements cannot be founded */
/** Settlement upgrade requirements */
export declare const UPGRADE_COSTS: Record<string, {
    resources: Partial<Resources>;
    minPopulation: number;
    minBuildings: number;
}>;
/** Settlement tier progression order */
export declare const TIER_ORDER: string[];
/** Maximum population per settlement tier */
export declare const MAX_POPULATION: Record<string, number>;
/** Maximum number of building slots per settlement tier */
export declare const BUILDING_SLOTS: Record<string, number>;
/** Population growth rate: +1 per this many excess food */
export declare const POP_GROWTH_PER_FOOD = 5;
/** Stockpile capacity per settlement tier (per resource) */
export declare const STOCKPILE_CAP: Record<string, number>;
/** Additional stockpile capacity per granary level */
export declare const GRANARY_BONUS_PER_LEVEL = 200;
/** Fraction of excess resources that decay each tick (5%) */
export declare const STOCKPILE_DECAY_RATE = 0.05;
/** Hard ceiling multiplier: resources above cap × this are immediately clamped */
export declare const STOCKPILE_HARD_CEILING = 2;
/** Fraction of building cost refunded on demolish (25%) */
export declare const DEMOLISH_REFUND_RATE = 0.25;
/** Chance per tick per building to decay when colony food is at 0 */
export declare const DECAY_CHANCE_PER_BUILDING = 0.1;
/** Unit attack power by type */
export declare const UNIT_ATTACK: Record<UnitType, number>;
/** Unit defense power by type */
export declare const UNIT_DEFENSE: Record<UnitType, number>;
/** Morale loss for surviving units after combat */
export declare const COMBAT_MORALE_LOSS = 0.1;
/** Max random bonus multiplier for attack damage (0 to this value) */
export declare const COMBAT_RANDOM_BONUS = 0.3;
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
export declare function resolveBuilding(settlements: Settlement[], colonies: Colony[], actions: QueuedAction[]): BuildResult;
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
export declare function resolveUpgradeBuilding(settlements: Settlement[], colonies: Colony[], actions: QueuedAction[]): UpgradeBuildingResult;
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
export declare function resolveDemolish(settlements: Settlement[], colonies: Colony[], actions: QueuedAction[]): DemolishResult;
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
export declare function resolveFoundSettlement(units: Unit[], colonies: Colony[], settlements: Settlement[], hexes: HexTileState[], actions: QueuedAction[], allHexCoords: Set<string>): FoundSettlementResult;
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
export declare function resolveTrainUnit(colonies: Colony[], settlements: Settlement[], actions: QueuedAction[]): TrainUnitResult;
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
export declare function resolveUpgradeSettlement(settlements: Settlement[], colonies: Colony[], actions: QueuedAction[]): UpgradeSettlementResult;
/**
 * Resolve move_unit actions: compute path and set movement queue.
 * Then advance all units with existing movement queues.
 */
export declare function resolveMovement(units: Unit[], actions: QueuedAction[], hexLookup: HexLookup): {
    units: Unit[];
    events: TickEvent[];
    actionResults: ActionResult[];
};
/**
 * Calculate resource production for a single settlement.
 * Production = (sum of building output × level × tier multiplier) + (nearby hex yields × 0.5)
 */
export declare function calculateProduction(settlement: Settlement, nearbyHexes: HexTileState[]): Partial<Resources>;
/**
 * Calculate building upkeep for a settlement.
 */
export declare function calculateBuildingUpkeep(settlement: Settlement): Partial<Resources>;
/**
 * Calculate total unit upkeep for a colony.
 */
export declare function calculateUnitUpkeep(units: Unit[]): number;
/**
 * Calculate population food consumption for a settlement.
 */
export declare function calculatePopulationConsumption(settlement: Settlement): number;
export interface CombatResult {
    units: Unit[];
    destroyedUnitIds: string[];
    events: TickEvent[];
    actionResults: ActionResult[];
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
export declare function resolveCombat(units: Unit[], actions: QueuedAction[], seed?: number, activeAgreements?: Agreement[]): CombatResult;
/** Maximum messages a colony can send per tick */
export declare const MAX_MESSAGES_PER_TICK = 5;
/** Maximum message content length (characters) */
export declare const MAX_MESSAGE_LENGTH = 500;
/** Delivery delay in ticks (messages arrive 1 tick after sending) */
export declare const MESSAGE_DELIVERY_DELAY = 1;
export interface MessageResult {
    messages: MessageRecord[];
    events: TickEvent[];
    actionResults: ActionResult[];
}
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
export declare function resolveMessages(colonies: Colony[], actions: QueuedAction[], worldId: string, currentTick: number): MessageResult;
/** Base conversion rate: spend this many units to get 1 unit of target resource */
export declare const MARKET_CONVERSION_BASE_RATE = 3;
/** Conversion rate improvement per market level: rate = base - (level - 1) * this */
export declare const MARKET_CONVERSION_LEVEL_BONUS = 0.5;
/** Minimum conversion rate (best possible) */
export declare const MARKET_CONVERSION_MIN_RATE = 1.5;
/** Maximum amount convertible per action */
export declare const MARKET_CONVERSION_MAX_AMOUNT = 200;
interface ConvertResourcesResult {
    events: TickEvent[];
    actionResults: ActionResult[];
}
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
export declare function resolveConvertResources(settlements: Settlement[], colonies: Colony[], actions: QueuedAction[]): ConvertResourcesResult;
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
export declare function autoExploreIdleScouts(units: Unit[], hexes: HexTileState[], hexLookup: HexLookup, actionedUnitIds: Set<string>): {
    events: TickEvent[];
};
/**
 * Resolve a single game tick.
 *
 * 0. Resolve found_settlement actions (before movement — consumed settlers don't move)
 * 1. Resolve movement actions + advance movement queues
 * 1.5. Resolve combat (units sharing hex with enemies fight)
 * 2. Compute fog of war reveals for moved units + new settlements
 * 3. Resolve build actions + advance build queues
 * 4. Calculate production for each settlement (including new ones)
 * 5. Calculate upkeep (buildings + units)
 * 6. Apply net resources to each colony
 * 7. Handle deficits: morale loss → desertion
 * 8. Handle surplus: morale recovery
 */
export interface ResearchResult {
    events: TickEvent[];
    actionResults: ActionResult[];
}
/**
 * Resolve research actions and advance research queues.
 *
 * Phase 1: Process research actions — validate and start research
 * Phase 2: Advance all research queues (decrement ticksRemaining)
 */
export declare function resolveResearch(colonies: Colony[], settlements: Settlement[], actions: QueuedAction[]): ResearchResult;
export type AgreementType = 'non_aggression' | 'trade' | 'alliance';
export type AgreementStatus = 'proposed' | 'active' | 'rejected' | 'broken';
export interface TradeTerms {
    gives: Partial<Resources>;
    receives: Partial<Resources>;
}
export interface Agreement {
    id: string;
    worldId: string;
    type: AgreementType;
    proposedBy: string;
    proposedTo: string;
    status: AgreementStatus;
    terms: TradeTerms | Record<string, unknown>;
    proposedAtTick: number;
    acceptedAtTick: number | null;
}
export interface AgreementMutation {
    type: 'create' | 'update';
    agreement: Agreement;
}
export interface AgreementActionResult {
    events: TickEvent[];
    actionResults: ActionResult[];
    mutations: AgreementMutation[];
}
export interface TradeTransferResult {
    colonies: Colony[];
    events: TickEvent[];
}
export declare const BREAK_TRADE_COST = 50;
export declare const BREAK_COSTS: Record<AgreementType, number>;
export declare const PROPOSAL_EXPIRY_TICKS = 50;
/**
 * Resolve propose/accept/reject/break agreement actions.
 */
export declare function resolveAgreementActions(colonies: Colony[], agreements: Agreement[], actions: QueuedAction[], currentTick: number): AgreementActionResult;
/**
 * Transfer resources between colonies with active trade agreements.
 */
export declare function resolveTradeTransfers(colonies: Colony[], agreements: Agreement[]): TradeTransferResult;
export declare function resolveTick(colonies: Colony[], settlements: Settlement[], units: Unit[], hexes: HexTileState[], actions?: QueuedAction[], combatSeed?: number, worldId?: string, currentTick?: number, agreements?: Agreement[]): TickResult;
export {};
//# sourceMappingURL=tick.d.ts.map