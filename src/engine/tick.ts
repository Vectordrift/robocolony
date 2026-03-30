import type { HexCoord } from './hex.js';
import { hexNeighbors, hexDistance, hexRing } from './hex.js';
import type { HexResources } from './mapgen.js';
import { findPath, movementStepsThisTick, createHexLookup } from './pathfinding.js';
import type { HexLookup } from './pathfinding.js';
import { computeFogReveals, hexesWithinRadius } from './fog.js';
import type { HexExploration, MapIntel } from './fog.js';

// --- Types ---

export interface Colony {
  id: string;
  worldId: string;
  name: string;
  resources: Resources;
  legacyScore: number;
  status: string;
  lastActionTick?: number;
  newcomerProtectionUntilTick?: number;
  diedAtTick?: number;
  deathReason?: string;
}

export interface Resources {
  food: number;
  timber: number;
  stone: number;
  iron: number;
  steel?: number;
  influence: number;
}

export const RESOURCE_KEYS = ['food', 'timber', 'stone', 'iron', 'steel', 'influence'] as const;
export type ResourceKey = (typeof RESOURCE_KEYS)[number];

export function emptyResources(): Resources {
  return { food: 0, timber: 0, stone: 0, iron: 0, steel: 0, influence: 0 };
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

export type BuildingType = 'farm' | 'lumberMill' | 'quarry' | 'mine' | 'foundry' | 'barracks' | 'granary' | 'market' | 'workshop' | 'warehouse' | 'walls';

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

export type UnitType = 'scout' | 'militia' | 'soldier' | 'siege' | 'settler' | 'engineer';

export interface PoiState {
  type: string;
  discoveredBy?: string;
  discoveredAtTick?: number;
  surveyedBy?: string;
  surveyedAtTick?: number;
}

export interface HexTileState {
  x: number;
  y: number;
  terrain: string;
  resources: HexResources;
  settlementId: string | null;
  exploredBy?: string[];
  roads?: Record<string, RoadEdgeState>;
  poi?: PoiState | null;
}

export interface RoadEdgeState {
  colonyId: string;
  status: 'building' | 'built';
  remainingTicks?: number;
  builtAtTick?: number;
  lastSupportedTick: number;
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

function coordKey(coord: HexCoord): string {
  return `${coord.q},${coord.r}`;
}

function chooseScoutDestination(
  from: HexCoord,
  desired: HexCoord,
  hexLookup: HexLookup,
  reservedTargets: Set<string>,
): HexCoord {
  if (!reservedTargets.has(coordKey(desired))) {
    return desired;
  }

  for (let radius = 1; radius <= 3; radius++) {
    const candidates = hexRing(desired, radius)
      .sort((a, b) => {
        const distanceDiff = hexDistance(from, a) - hexDistance(from, b);
        if (distanceDiff !== 0) return distanceDiff;
        if (a.q !== b.q) return a.q - b.q;
        return a.r - b.r;
      });

    for (const candidate of candidates) {
      const candidateKey = coordKey(candidate);
      if (reservedTargets.has(candidateKey)) continue;
      if (!findPath(from, candidate, hexLookup)) continue;
      return candidate;
    }
  }

  return desired;
}

const PASSABLE_EXPLORE = new Set(['plains', 'forest', 'coast', 'desert', 'tundra', 'mountains']);

function buildExplorationMaps(hexes: HexTileState[]): {
  terrainMap: Map<string, string>;
  exploredByColony: Map<string, Set<string>>;
  allHexKeys: Set<string>;
} {
  const terrainMap = new Map<string, string>();
  const exploredByColony = new Map<string, Set<string>>();
  const allHexKeys = new Set<string>();

  for (const hex of hexes) {
    const key = coordKey({ q: hex.x, r: hex.y });
    terrainMap.set(key, hex.terrain);
    allHexKeys.add(key);

    for (const colonyId of hex.exploredBy ?? []) {
      if (!exploredByColony.has(colonyId)) {
        exploredByColony.set(colonyId, new Set());
      }
      exploredByColony.get(colonyId)!.add(key);
    }
  }

  return { terrainMap, exploredByColony, allHexKeys };
}

function chooseExploreTarget(
  scout: Unit,
  explored: Set<string>,
  terrainMap: Map<string, string>,
  allHexKeys: Set<string>,
  hexLookup: HexLookup,
  reservedTargets: Set<string>,
): { target: HexCoord; path: HexCoord[] } | null {
  const scoutPos: HexCoord = { q: scout.hexX, r: scout.hexY };
  const frontierCandidates: HexCoord[] = [];
  const frontierSeen = new Set<string>();

  for (const exploredKey of explored) {
    const [eq, er] = exploredKey.split(',').map(Number);
    for (const neighbor of hexNeighbors({ q: eq, r: er })) {
      const neighborKey = coordKey(neighbor);
      if (frontierSeen.has(neighborKey)) continue;
      frontierSeen.add(neighborKey);

      if (!allHexKeys.has(neighborKey)) continue;
      if (explored.has(neighborKey)) continue;
      if (reservedTargets.has(neighborKey)) continue;

      const terrain = terrainMap.get(neighborKey);
      if (!terrain || !PASSABLE_EXPLORE.has(terrain)) continue;

      frontierCandidates.push(neighbor);
    }
  }

  if (frontierCandidates.length === 0) return null;

  function frontierScore(candidate: HexCoord): number {
    let unexploredCount = 0;
    for (const neighbor of hexNeighbors(candidate)) {
      const neighborKey = coordKey(neighbor);
      if (allHexKeys.has(neighborKey) && !explored.has(neighborKey)) {
        unexploredCount++;
      }
    }
    return unexploredCount * 1000 + hexDistance(scoutPos, candidate);
  }

  frontierCandidates.sort((a, b) => frontierScore(b) - frontierScore(a));

  const farCandidates = frontierCandidates.filter(candidate => hexDistance(scoutPos, candidate) >= 2);
  const nearCandidates = frontierCandidates.filter(candidate => hexDistance(scoutPos, candidate) < 2);

  for (const candidates of [farCandidates, nearCandidates]) {
    for (let i = 0; i < Math.min(candidates.length, 15); i++) {
      const candidate = candidates[i];
      const path = findPath(scoutPos, candidate, hexLookup);
      if (path && path.length > 0) {
        return { target: candidate, path };
      }
    }
  }

  return null;
}

function buildPeaceAgreementLookup(activeAgreements?: Agreement[]): Set<string> {
  const peacePairs = new Set<string>();
  if (!activeAgreements) return peacePairs;

  for (const agreement of activeAgreements) {
    if (agreement.status !== 'active') continue;
    if (agreement.type !== 'non_aggression' && agreement.type !== 'alliance' && agreement.type !== 'ceasefire') continue;
    peacePairs.add([agreement.proposedBy, agreement.proposedTo].sort().join('|'));
  }

  return peacePairs;
}

function hasPeaceAgreement(peacePairs: Set<string>, colonyA: string, colonyB: string): boolean {
  return peacePairs.has([colonyA, colonyB].sort().join('|'));
}


export interface ResearchQueueEntry {
  techId: string;
  ticksRemaining: number;
}

export type TechId =
  | 'improved_agriculture'
  | 'fortifications'
  | 'advanced_scouting'
  | 'steel_weapons'
  | 'trade_routes'
  | 'siege_engineering'
  | 'crop_rotation'
  | 'metallurgy'
  | 'cartography'
  | 'professional_army'
  | 'currency'
  | 'civil_engineering';

export interface TechDefinition {
  id: TechId;
  name: string;
  description: string;
  cost: Partial<Resources>;
  ticks: number;
  tier: 1 | 2;
  requires?: TechId[];
}

export const TECH_TREE: Record<TechId, TechDefinition> = {
  improved_agriculture: {
    id: 'improved_agriculture',
    name: 'Improved Agriculture',
    description: 'Farm production +30%',
    cost: { food: 200, timber: 100 },
    ticks: 10,
    tier: 1,
  },
  fortifications: {
    id: 'fortifications',
    name: 'Fortifications',
    description: 'Settlement defense bonus — attackers take 2 damage per combat round',
    cost: { stone: 200, iron: 100, timber: 50 },
    ticks: 12,
    tier: 1,
  },
  advanced_scouting: {
    id: 'advanced_scouting',
    name: 'Advanced Scouting',
    description: 'Scout vision radius +3, scout movement speed +2',
    cost: { food: 150, timber: 100, iron: 50 },
    ticks: 8,
    tier: 1,
  },
  steel_weapons: {
    id: 'steel_weapons',
    name: 'Steel Weapons',
    description: 'Militia and soldier combat power +2',
    cost: { iron: 200, stone: 100, timber: 50 },
    ticks: 15,
    tier: 1,
    requires: ['fortifications'],
  },
  trade_routes: {
    id: 'trade_routes',
    name: 'Trade Routes',
    description: '+5 influence per tick, +2 food per settlement beyond first',
    cost: { food: 150, timber: 100, influence: 50 },
    ticks: 10,
    tier: 1,
    requires: ['improved_agriculture'],
  },
  siege_engineering: {
    id: 'siege_engineering',
    name: 'Siege Engineering',
    description: 'Siege units deal double damage to settlements',
    cost: { iron: 250, stone: 200, timber: 100 },
    ticks: 20,
    tier: 1,
    requires: ['steel_weapons'],
  },
  crop_rotation: {
    id: 'crop_rotation',
    name: 'Crop Rotation',
    description: 'Unlocks the next agricultural growth tier.',
    cost: { food: 300, timber: 150, iron: 50 },
    ticks: 12,
    tier: 2,
    requires: ['improved_agriculture'],
  },
  metallurgy: {
    id: 'metallurgy',
    name: 'Metallurgy',
    description: 'Unlocks advanced industrial refinement.',
    cost: { iron: 300, stone: 200, timber: 150 },
    ticks: 18,
    tier: 2,
    requires: ['fortifications'],
  },
  cartography: {
    id: 'cartography',
    name: 'Cartography',
    description: 'Unlocks large-scale mapping and frontier surveying.',
    cost: { food: 200, timber: 150, iron: 100 },
    ticks: 12,
    tier: 2,
    requires: ['advanced_scouting'],
  },
  professional_army: {
    id: 'professional_army',
    name: 'Professional Army',
    description: 'Unlocks more disciplined military organization.',
    cost: { food: 400, iron: 300, stone: 200 },
    ticks: 20,
    tier: 2,
    requires: ['steel_weapons'],
  },
  currency: {
    id: 'currency',
    name: 'Currency',
    description: 'Unlocks more advanced trade and market coordination.',
    cost: { food: 250, influence: 200, timber: 100 },
    ticks: 14,
    tier: 2,
    requires: ['trade_routes'],
  },
  civil_engineering: {
    id: 'civil_engineering',
    name: 'Civil Engineering',
    description: 'Unlocks advanced infrastructure planning and construction.',
    cost: { stone: 250, timber: 200, iron: 100 },
    ticks: 14,
    tier: 2,
    requires: ['siege_engineering'],
  },
};

export const TIER_1_TECHS = Object.values(TECH_TREE)
  .filter((tech) => tech.tier === 1)
  .map((tech) => tech.id);

export function canResearchTech(techId: TechId, researched: string[]): { ok: true } | { ok: false; reason: string } {
  const tech = TECH_TREE[techId];
  if (!tech) {
    return { ok: false, reason: `Unknown tech: ${techId}` };
  }

  if (tech.tier > 1) {
    const missingTierOne = TIER_1_TECHS.filter((id) => !researched.includes(id));
    if (missingTierOne.length > 0) {
      return {
        ok: false,
        reason: `Tier 2 research is locked until all Tier 1 techs are complete. Missing: ${missingTierOne.map((id) => TECH_TREE[id].name).join(', ')}`,
      };
    }
  }

  if (tech.requires) {
    const missing = tech.requires.filter((id) => !researched.includes(id));
    if (missing.length > 0) {
      return {
        ok: false,
        reason: `Missing prerequisite tech(s): ${missing.map((id) => TECH_TREE[id]?.name ?? id).join(', ')}`,
      };
    }
  }

  return { ok: true };
}


export interface TickResult {
  colonies: Colony[];
  settlements: Settlement[];
  units: Unit[];
  events: TickEvent[];
  desertedUnitIds: string[];
  disbandedUnitIds: string[];
  deadColonyIds: string[];
  actionResults: ActionResult[];
  fogReveals: HexExploration[];
  newMessages: MessageRecord[];
  agreementMutations: AgreementMutation[];
}

export const POI_SURVEY_INFLUENCE: Record<string, number> = {
  mineral_deposit: 10,
  fertile_valley: 10,
  ancient_forest: 10,
  ancient_ruins: 15,
  abandoned_cache: 12,
  crystal_cavern: 15,
  watchtower: 12,
  sacred_grove: 12,
};

export const WATCHTOWER_SURVEY_REVEAL_RADIUS = 2;
export const SACRED_GROVE_SURVEY_RANGE = 3;
export const SACRED_GROVE_SURVEY_MORALE_BONUS = 0.1;

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
  lumberMill: { timber: 5 },
  quarry:     { stone: 4 },
  mine:       { iron: 3 },
  foundry:    {},
  barracks:   {},
  granary:    {},
  market:     { influence: 2 },
  workshop:   {},
  warehouse:  {},
  walls:      {},
};

/** Building upkeep per level (resources consumed per tick) */
export const BUILDING_UPKEEP: Record<BuildingType, Partial<Resources>> = {
  farm:       { timber: 1 },
  lumberMill: { timber: 1, stone: 1 },
  quarry:     { timber: 1 },
  mine:       { timber: 1, food: 1 },
  foundry:    { iron: 2, timber: 1, food: 1 },
  barracks:   { food: 2, iron: 2, timber: 1 },
  granary:    { timber: 1 },
  market:     { food: 1, timber: 1 },
  workshop:   { food: 2, timber: 1, iron: 1 },
  warehouse:  { timber: 1, stone: 1 },
  walls:      { stone: 1 },
};

/** Building construction costs */
export const BUILDING_COSTS: Record<BuildingType, Partial<Resources>> = {
  farm:       { timber: 20 },
  lumberMill: { timber: 10, stone: 10 },
  quarry:     { stone: 20, iron: 10 },
  mine:       { stone: 30, timber: 20 },
  foundry:    { stone: 60, iron: 40, timber: 30 },
  barracks:   { timber: 40, stone: 20, iron: 10 },
  granary:    { timber: 25, stone: 10 },
  market:     { stone: 30, timber: 15, iron: 5 },
  workshop:   { stone: 40, timber: 30, iron: 20 },
  warehouse:  { stone: 30, timber: 20, iron: 10 },
  walls:      { stone: 30, timber: 20 },
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
  'farm', 'lumberMill', 'quarry', 'mine', 'foundry', 'barracks', 'granary', 'market', 'workshop', 'warehouse', 'walls',
];

export const BUILDING_TECH_REQUIREMENTS: Partial<Record<BuildingType, TechId>> = {
  foundry: 'metallurgy',
};

export const FOUNDRY_STEEL_OUTPUT_PER_LEVEL = 2;
export const FOUNDRY_IRON_CONVERSION_PER_LEVEL = 3;

/** Unit food upkeep per tick */
export const UNIT_UPKEEP: Record<UnitType, number> = {
  scout: 0.5,
  militia: 1.5,
  soldier: 3,
  siege: 4,
  settler: 3,
  engineer: 2,
};

/** Population food consumption per person per tick (reduced from 0.4 to enable faster growth) */
export const POP_FOOD_CONSUMPTION = 0.25;

/** Unit training costs (resources needed to recruit) */
export const UNIT_TRAINING_COSTS: Record<UnitType, Partial<Resources>> = {
  scout:   { food: 10, timber: 5 },
  militia:  { food: 15, timber: 10, iron: 5 },
  soldier:  { food: 25, timber: 10, iron: 15 },
  siege:    { food: 40, timber: 20, iron: 30, stone: 10 },
  settler:  { food: 30, timber: 15 },
  engineer: { food: 30, timber: 20, iron: 15, stone: 10 },
};

/** All valid unit types for training */
export const VALID_UNIT_TYPES: UnitType[] = ['scout', 'militia', 'soldier', 'siege', 'settler', 'engineer'];
export const ROAD_BUILD_TICKS = 2;
export const ROAD_DECAY_TICKS = 100;
export const ROAD_SUPPORT_RANGE = 2;
export const ROAD_COST: Partial<Resources> = {
  stone: 10,
  timber: 5,
};

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

/** Minimum morale from famine — units won't drop below this from starvation alone */
export const MORALE_FAMINE_FLOOR = 0.15;

/** Max desertions per colony per tick — prevents cascade wipes */
export const MAX_DESERTIONS_PER_TICK = 2;

/** Hex range within which a friendly settlement provides morale support */
export const GARRISON_MORALE_RANGE = 3;

/** Morale recovery per tick for units near a friendly settlement (even during famine) */
export const GARRISON_MORALE_RECOVERY = 0.02;

// --- Legacy Score Awards ---
// --- Snapshot-based scoring (recalculated every tick from current state) ---
export const SCORE_SETTLEMENT: Record<string, number> = { outpost: 10, town: 30, city: 100 };
export const SCORE_POP_PER_10 = 1;
export const SCORE_BUILDING_LEVEL = 5;
export const SCORE_UNIT: Record<string, number> = { scout: 2, militia: 5, soldier: 10, siege: 15, settler: 3, engineer: 4 };
export const SCORE_TECH = 25;
export const SCORE_EXPLORED_PER_10 = 1;

/** Morale recovery per tick when food is positive */
export const MORALE_RECOVERY_RATE = 0.10;

/** Military unit types that benefit from field army morale bonuses */
export const MILITARY_UNIT_TYPES: ReadonlySet<string> = new Set(['militia', 'soldier', 'siege']);

/** Passive morale recovery per tick for military units during famine (field cohesion/foraging) */
export const FIELD_ARMY_MORALE_RECOVERY = 0.01;

/** Famine morale loss multiplier for military units NOT near a settlement (hardened troops) */
export const MILITARY_FAMINE_RESISTANCE = 0.75;

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
export const FOUNDING_COST: Partial<Resources> = {
  food: 100,
  timber: 50,
};

/** Minimum hex distance between any two settlements */
export const MIN_SETTLEMENT_DISTANCE = 3;

/** Fog reveal radius for a newly founded settlement */
export const FOUNDING_REVEAL_RADIUS = 5;

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


/** Maximum number of building slots per settlement tier */
export const BUILDING_SLOTS: Record<string, number> = {
  outpost: 4,
  town: 6,
  city: 7,
};

/** Maximum number of farms per settlement (farms can be built multiple times) */
export const MAX_FARMS_PER_SETTLEMENT = 2;
/** Population growth rate: +1 per this many excess food */
export const POP_GROWTH_PER_FOOD = 3;

/** Stockpile capacity per settlement tier (per resource) */
export const STOCKPILE_CAP: Record<string, number> = {
  outpost: 500,
  town: 1000,
  city: 2000,
};

/** Additional stockpile capacity per granary level */
export const GRANARY_BONUS_PER_LEVEL = 200;

/** Additional stockpile capacity per warehouse level (all resources) */
export const WAREHOUSE_BONUS_PER_LEVEL = 150;

/** Fraction of excess resources that decay each tick (0.5% — halved from 1% per #166) */
export const STOCKPILE_DECAY_RATE = 0.005;

/** Hard ceiling multiplier: resources above cap × this are immediately clamped */
export const STOCKPILE_HARD_CEILING = 2.0;

/** Fraction of building cost refunded on demolish (25%) */
export const DEMOLISH_REFUND_RATE = 0.25;

/** Chance per tick per building to decay when colony food is at 0 */
export const DECAY_CHANCE_PER_BUILDING = 0.10;

// --- Combat Constants ---

/** Unit attack power by type */
export const UNIT_ATTACK: Record<UnitType, number> = {
  scout: 2,
  militia: 4,
  soldier: 8,
  siege: 12,
  settler: 0,
  engineer: 1,
};

/** Unit defense power by type */
export const UNIT_DEFENSE: Record<UnitType, number> = {
  scout: 1,
  militia: 3,
  soldier: 6,
  siege: 2,
  settler: 1,
  engineer: 2,
};

/** Morale loss for surviving units after combat (applied to all combatants) */
export const COMBAT_MORALE_LOSS = 0.1;

/** Max random bonus multiplier for attack damage (0 to this value) */
export const COMBAT_RANDOM_BONUS = 0.3;

/** Morale boost for units on the winning side of combat */
export const COMBAT_MORALE_WIN = 0.15;

/** Morale penalty for units on the losing side of combat (reduced from 0.15 to prevent death spirals #171) */
export const COMBAT_MORALE_LOSE = 0.10;

/** Maximum morale a unit can reach from combat victories */
export const COMBAT_MORALE_CAP = 1.0;

/** Range in hexes from own settlement for homeland defense morale bonus */
export const HOMELAND_DEFENSE_RANGE = 5;

/** Morale bonus for defending within HOMELAND_DEFENSE_RANGE of own settlement (buffed from 0.1 #171) */
export const HOMELAND_MORALE_BONUS = 0.15;

/** Minimum morale for units defending within their own settlement (homeland morale floor, raised from 0.6 #171) */
export const GARRISON_MORALE_FLOOR = 0.7;

/** Defense multiplier for units defending on a hex with a settlement that has walls */
export const WALLS_DEFENSE_MULTIPLIER = 1.5;

/** Attack bonus from steel_weapons for militia and soldier units */
export const STEEL_WEAPONS_ATTACK_BONUS = 2;

/** Retaliation damage applied by fortifications to attackers on a fortified settlement hex */
export const FORTIFICATIONS_RETALIATION_DAMAGE = 2;

/** Minimum damage dealt by military units per combat round (prevents 0-damage stalemates #173) */
export const COMBAT_MINIMUM_DAMAGE = 1;

/** Health threshold below which military units bleed out after combat (#174) */
export const COMBAT_BLEEDOUT_THRESHOLD = 5;
/** Health threshold below which military units require friendly shelter by end of tick */
export const CRITICAL_WOUND_THRESHOLD = 6;
export const NEWCOMER_PROTECTION_TICKS = 24;

/** Base health recovered per tick at a friendly settlement */
export const HEALING_PER_TICK = 5;

/** Additional healing per barracks level at a friendly settlement */
export const BARRACKS_HEALING_BONUS = 3;
/** Hard cap on total units that can occupy a single hex */
export const MAX_UNITS_PER_HEX = 12;

/** Adjacent military units can support a full contested hex at reduced effectiveness */
export const SUPPORT_COMBAT_ATTACK_MULTIPLIER = 0.5;

/** Supporting units take reduced incoming damage because they fight from adjacent hexes */
export const SUPPORT_COMBAT_DEFENSE_MULTIPLIER = 0.25;

/** Base loyalty recovered per tick at a friendly settlement */
export const SETTLEMENT_LOYALTY_RECOVERY = 1;

/** Extra loyalty recovered when a friendly unit garrisons the settlement hex */
export const SETTLEMENT_GARRISON_LOYALTY_BONUS = 2;

/** Legacy score awarded for capturing an enemy settlement */
export const SETTLEMENT_CAPTURE_SCORE = 50;

const UNFOUNDABLE_TERRAIN = new Set(['ocean', 'mountains']);

// --- Helpers ---

/** Truncate user-supplied IDs in error messages to prevent log bloat */
function truncId(id: string, maxLen = 50): string {
  if (id.length <= maxLen) return id;
  return id.substring(0, maxLen) + '…[truncated]';
}

function hexKey(x: number, y: number): string {
  return `${x},${y}`;
}

function parseHexKey(key: string): HexCoord | null {
  const [q, r] = key.split(',').map(Number);
  if (!Number.isFinite(q) || !Number.isFinite(r)) return null;
  return { q, r };
}

function isMilitaryUnit(unit: Unit): boolean {
  return MILITARY_UNIT_TYPES.has(unit.type);
}

function getRoadEntry(hex: HexTileState, to: HexCoord): RoadEdgeState | undefined {
  return hex.roads?.[hexKey(to.q, to.r)];
}

function setRoadEntry(hex: HexTileState, to: HexCoord, entry: RoadEdgeState): void {
  hex.roads = {
    ...(hex.roads ?? {}),
    [hexKey(to.q, to.r)]: entry,
  };
}

function removeRoadEntry(hex: HexTileState, to: HexCoord): void {
  if (!hex.roads) return;
  const next = { ...hex.roads };
  delete next[hexKey(to.q, to.r)];
  hex.roads = next;
}

function setRoadBetween(
  hexMap: Map<string, HexTileState>,
  from: HexCoord,
  to: HexCoord,
  entry: RoadEdgeState,
): void {
  const fromHex = hexMap.get(hexKey(from.q, from.r));
  const toHex = hexMap.get(hexKey(to.q, to.r));
  if (!fromHex || !toHex) return;
  setRoadEntry(fromHex, to, entry);
  setRoadEntry(toHex, from, entry);
}

function removeRoadBetween(
  hexMap: Map<string, HexTileState>,
  from: HexCoord,
  to: HexCoord,
): void {
  const fromHex = hexMap.get(hexKey(from.q, from.r));
  const toHex = hexMap.get(hexKey(to.q, to.r));
  if (!fromHex || !toHex) return;
  removeRoadEntry(fromHex, to);
  removeRoadEntry(toHex, from);
}

function hasFriendlySettlementSupport(
  colonyId: string,
  from: HexCoord,
  to: HexCoord,
  settlements: Settlement[],
): boolean {
  return settlements.some((settlement) =>
    settlement.colonyId === colonyId
    && (
      hexDistance(from, { q: settlement.hexX, r: settlement.hexY }) <= ROAD_SUPPORT_RANGE
      || hexDistance(to, { q: settlement.hexX, r: settlement.hexY }) <= ROAD_SUPPORT_RANGE
    ),
  );
}

/**
 * Check if a colony has enough resources for a cost.
 */
function hasResources(resources: Resources, cost: Partial<Resources>): boolean {
  for (const [key, amount] of Object.entries(cost)) {
    if ((amount as number) > 0 && (resources[key as keyof Resources] ?? 0) < (amount as number)) {
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
      resources[key as keyof Resources] = (resources[key as keyof Resources] ?? 0) - (amount as number);
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
  // Actions are processed in array order (first-come-first-served for resource deduction).
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
    // Exception: farms can be built multiple times (up to MAX_FARMS_PER_SETTLEMENT)
    if (bType === 'farm') {
      const existingFarms = settlement.buildings.filter(b => b.type === 'farm').length;
      const queuedFarms = settlement.buildQueue.filter(bq => bq.type === 'farm').length;
      if (existingFarms + queuedFarms >= MAX_FARMS_PER_SETTLEMENT) {
        actionResults.push({
          actionId: action.id,
          status: 'failed',
          result: `Settlement ${settlementId} already has the maximum ${MAX_FARMS_PER_SETTLEMENT} farms`,
        });
        continue;
      }
    } else {
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

    const requiredTech = BUILDING_TECH_REQUIREMENTS[bType];
    const researchedTechs: string[] = (colony as Colony & { researchedTechs?: string[] }).researchedTechs ?? [];
    if (requiredTech && !researchedTechs.includes(requiredTech)) {
      actionResults.push({
        actionId: action.id,
        status: 'failed',
        result: `${bType} requires ${TECH_TREE[requiredTech].name}`,
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
        result: `Colony ${truncId(action.colonyId)} not found`,
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
        result: `Colony ${truncId(action.colonyId)} not found`,
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
 * Resolve disband actions.
 *
 * Validates:
 * - Unit exists and belongs to the colony
 * - Unit is not on a hex with enemy units (cannot disband in combat)
 *
 * On success: unit is removed from the game. No resource refund.
 */
export function resolveDisband(
  units: Unit[],
  actions: QueuedAction[],
): { units: Unit[]; events: TickEvent[]; actionResults: ActionResult[]; disbandedUnitIds: string[] } {
  const events: TickEvent[] = [];
  const actionResults: ActionResult[] = [];
  const disbandedUnitIds = new Set<string>();

  // Build a map of hex -> set of colonyIds (to detect enemy presence)
  const hexColonies = new Map<string, Set<string>>();
  for (const u of units) {
    const key = hexKey(u.hexX, u.hexY);
    const set = hexColonies.get(key) ?? new Set<string>();
    set.add(u.colonyId);
    hexColonies.set(key, set);
  }

  const disbandActions = actions.filter(a => a.type === 'disband');

  for (const action of disbandActions) {
    const unitId = action.params?.unitId as string;
    if (!unitId) {
      actionResults.push({ actionId: action.id, status: 'failed', result: 'Missing unitId' });
      continue;
    }

    const unit = units.find(u => u.id === unitId);
    if (!unit) {
      actionResults.push({ actionId: action.id, status: 'failed', result: `Unit ${unitId} not found` });
      continue;
    }

    if (unit.colonyId !== action.colonyId) {
      actionResults.push({ actionId: action.id, status: 'failed', result: `Unit ${unitId} does not belong to your colony` });
      continue;
    }

    // Cannot disband in combat — check if enemy units share this hex
    const key = hexKey(unit.hexX, unit.hexY);
    const coloniesOnHex = hexColonies.get(key);
    if (coloniesOnHex && coloniesOnHex.size > 1) {
      actionResults.push({ actionId: action.id, status: 'failed', result: `Cannot disband unit in combat — enemy units present at (${unit.hexX}, ${unit.hexY})` });
      continue;
    }

    // Already being disbanded this tick (duplicate action)
    if (disbandedUnitIds.has(unitId)) {
      actionResults.push({ actionId: action.id, status: 'failed', result: `Unit ${unitId} already disbanded` });
      continue;
    }

    // Disband the unit
    disbandedUnitIds.add(unitId);
    actionResults.push({ actionId: action.id, status: 'resolved', result: `Disbanded ${unit.type} at (${unit.hexX}, ${unit.hexY})` });
    events.push({
      type: 'unit_disbanded',
      colonyId: unit.colonyId,
      unitId: unit.id,
      data: {
        unitType: unit.type,
        hexX: unit.hexX,
        hexY: unit.hexY,
      },
    });
  }

  // Remove disbanded units
  const remainingUnits = units.filter(u => !disbandedUnitIds.has(u.id));

  return { units: remainingUnits, events, actionResults, disbandedUnitIds: [...disbandedUnitIds] };
}

export function resolvePoiSurvey(
  colonies: Colony[],
  units: Unit[],
  hexes: HexTileState[],
  actions: QueuedAction[],
  currentTick: number,
): { events: TickEvent[]; actionResults: ActionResult[] } {
  const events: TickEvent[] = [];
  const actionResults: ActionResult[] = [];
  const colonyById = new Map(colonies.map(colony => [colony.id, colony]));
  const unitById = new Map(units.map(unit => [unit.id, unit]));
  const hexMap = new Map(hexes.map(hex => [hexKey(hex.x, hex.y), hex]));
  const surveyedHexes = new Set<string>();

  for (const action of actions.filter(a => a.type === 'survey_poi')) {
    const unitId = action.params.unitId as string | undefined;
    if (!unitId) {
      actionResults.push({ actionId: action.id, status: 'failed', result: 'Missing unitId' });
      continue;
    }

    const unit = unitById.get(unitId);
    if (!unit) {
      actionResults.push({ actionId: action.id, status: 'failed', result: `Unit ${unitId} not found` });
      continue;
    }
    if (unit.type !== 'scout') {
      actionResults.push({ actionId: action.id, status: 'failed', result: 'Only scouts can survey POIs' });
      continue;
    }

    const hex = hexMap.get(hexKey(unit.hexX, unit.hexY));
    if (!hex?.poi) {
      actionResults.push({ actionId: action.id, status: 'failed', result: `No POI at (${unit.hexX}, ${unit.hexY})` });
      continue;
    }
    if (hex.poi.discoveredBy !== unit.colonyId) {
      actionResults.push({
        actionId: action.id,
        status: 'failed',
        result: 'Your colony must discover a POI before surveying it',
      });
      continue;
    }

    const surveyKey = `${unit.hexX},${unit.hexY}`;
    if (hex.poi.surveyedBy || surveyedHexes.has(surveyKey)) {
      actionResults.push({
        actionId: action.id,
        status: 'failed',
        result: `POI at (${unit.hexX}, ${unit.hexY}) has already been surveyed`,
      });
      continue;
    }

    hex.poi = {
      ...hex.poi,
      surveyedBy: unit.colonyId,
      surveyedAtTick: currentTick,
    };
    surveyedHexes.add(surveyKey);

    const colony = colonyById.get(unit.colonyId);
    const influenceBonus = POI_SURVEY_INFLUENCE[hex.poi.type] ?? 10;
    if (colony) {
      colony.resources.influence += influenceBonus;
    }

    const eventData: Record<string, unknown> = {
      poiType: hex.poi.type,
      x: unit.hexX,
      y: unit.hexY,
      influenceBonus,
      summary: '',
    };

    switch (hex.poi.type) {
      case 'watchtower': {
        const revealTargets = hexesWithinRadius(
          { q: unit.hexX, r: unit.hexY },
          WATCHTOWER_SURVEY_REVEAL_RADIUS,
          new Set(hexMap.keys()),
        );
        let revealedCount = 0;
        for (const coord of revealTargets) {
          const targetHex = hexMap.get(hexKey(coord.q, coord.r));
          if (!targetHex) continue;
          const exploredBy = targetHex.exploredBy ?? [];
          if (!exploredBy.includes(unit.colonyId)) {
            targetHex.exploredBy = [...exploredBy, unit.colonyId];
            revealedCount++;
          }
        }
        eventData.revealedHexes = revealedCount;
        eventData.summary = `Surveyed a watchtower and charted ${revealedCount} nearby hexes.`;
        break;
      }
      case 'sacred_grove': {
        let affectedUnits = 0;
        for (const otherUnit of units) {
          if (otherUnit.colonyId !== unit.colonyId) continue;
          if (hexDistance({ q: unit.hexX, r: unit.hexY }, { q: otherUnit.hexX, r: otherUnit.hexY }) > SACRED_GROVE_SURVEY_RANGE) continue;
          const before = otherUnit.morale;
          otherUnit.morale = Math.min(1, otherUnit.morale + SACRED_GROVE_SURVEY_MORALE_BONUS);
          if (otherUnit.morale > before) affectedUnits++;
        }
        eventData.moraleBonus = SACRED_GROVE_SURVEY_MORALE_BONUS;
        eventData.affectedUnits = affectedUnits;
        eventData.summary = `Surveyed a sacred grove and steadied ${affectedUnits} nearby units.`;
        break;
      }
      case 'ancient_ruins':
        eventData.summary = 'Surveyed ancient ruins and recovered strategic lore from the frontier.';
        break;
      case 'abandoned_cache':
        eventData.summary = 'Surveyed an abandoned cache and mapped a reliable frontier resupply site.';
        break;
      case 'crystal_cavern':
        eventData.summary = 'Surveyed a crystal cavern and recorded a rare mineral landmark.';
        break;
      case 'mineral_deposit':
        eventData.summary = 'Surveyed a mineral deposit and marked it as a strategic extraction site.';
        break;
      case 'fertile_valley':
        eventData.summary = 'Surveyed a fertile valley and charted a valuable frontier breadbasket.';
        break;
      case 'ancient_forest':
        eventData.summary = 'Surveyed an ancient forest and logged a prime frontier timber reserve.';
        break;
      default:
        eventData.summary = 'Surveyed a point of interest.';
        break;
    }

    events.push({
      type: 'poi_surveyed',
      colonyId: unit.colonyId,
      unitId: unit.id,
      data: eventData,
    });
    actionResults.push({
      actionId: action.id,
      status: 'resolved',
      result: eventData.summary as string,
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
  existingUnits: Unit[] = [],
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
  const unitsPerHex = new Map<string, number>();
  for (const unit of existingUnits) {
    const key = hexKey(unit.hexX, unit.hexY);
    unitsPerHex.set(key, (unitsPerHex.get(key) ?? 0) + 1);
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
        result: `Colony ${truncId(action.colonyId)} not found`,
      });
      continue;
    }

    const researched: string[] = ((colony as Colony & { researchedTechs?: string[] }).researchedTechs) ?? [];
    if (uType === 'engineer' && !researched.includes('civil_engineering')) {
      actionResults.push({
        actionId: action.id,
        status: 'failed',
        result: 'Engineer training requires Civil Engineering',
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

    const settlementHexKey = hexKey(settlement.hexX, settlement.hexY);
    const occupiedCount = (unitsPerHex.get(settlementHexKey) ?? 0) + newUnits.filter(
      unit => unit.hexX === settlement.hexX && unit.hexY === settlement.hexY,
    ).length;
    if (occupiedCount >= MAX_UNITS_PER_HEX) {
      actionResults.push({
        actionId: action.id,
        status: 'failed',
        result: `Settlement hex is full (max ${MAX_UNITS_PER_HEX} units)`,
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

export interface RoadProgressResult {
  events: TickEvent[];
}

export function progressRoads(
  hexes: HexTileState[],
  settlements: Settlement[],
  currentTick: number,
): RoadProgressResult {
  const events: TickEvent[] = [];
  const hexMap = new Map<string, HexTileState>(hexes.map((hex) => [hexKey(hex.x, hex.y), hex]));
  const processedEdges = new Set<string>();

  for (const hex of hexes) {
    for (const [neighborKey, road] of Object.entries(hex.roads ?? {})) {
      const from = { q: hex.x, r: hex.y };
      const to = parseHexKey(neighborKey);
      if (!to) continue;

      const dedupKey = [hexKey(from.q, from.r), hexKey(to.q, to.r)].sort().join('|');
      if (processedEdges.has(dedupKey)) continue;
      processedEdges.add(dedupKey);

      if (road.status === 'building') {
        const remainingTicks = (road.remainingTicks ?? ROAD_BUILD_TICKS) - 1;
        if (remainingTicks <= 0) {
          const builtRoad: RoadEdgeState = {
            colonyId: road.colonyId,
            status: 'built',
            builtAtTick: currentTick,
            lastSupportedTick: currentTick,
          };
          setRoadBetween(hexMap, from, to, builtRoad);
          events.push({
            type: 'road_complete',
            colonyId: road.colonyId,
            data: {
              fromX: from.q,
              fromY: from.r,
              toX: to.q,
              toY: to.r,
            },
          });
        } else {
          setRoadBetween(hexMap, from, to, {
            ...road,
            remainingTicks,
          });
        }
        continue;
      }

      if (hasFriendlySettlementSupport(road.colonyId, from, to, settlements)) {
        if (road.lastSupportedTick !== currentTick) {
          setRoadBetween(hexMap, from, to, {
            ...road,
            lastSupportedTick: currentTick,
          });
        }
        continue;
      }

      if (currentTick - road.lastSupportedTick >= ROAD_DECAY_TICKS) {
        removeRoadBetween(hexMap, from, to);
        events.push({
          type: 'road_decayed',
          colonyId: road.colonyId,
          data: {
            fromX: from.q,
            fromY: from.r,
            toX: to.q,
            toY: to.r,
          },
        });
      }
    }
  }

  return { events };
}

export interface BuildRoadResult {
  events: TickEvent[];
  actionResults: ActionResult[];
}

export function resolveBuildRoad(
  units: Unit[],
  colonies: Colony[],
  settlements: Settlement[],
  hexes: HexTileState[],
  actions: QueuedAction[],
  currentTick: number,
): BuildRoadResult {
  const events: TickEvent[] = [];
  const actionResults: ActionResult[] = [];
  const roadActions = actions.filter((action) => action.type === 'build_road');
  if (roadActions.length === 0) {
    return { events, actionResults };
  }

  const unitMap = new Map(units.map((unit) => [unit.id, unit]));
  const colonyMap = new Map(colonies.map((colony) => [colony.id, colony]));
  const hexMap = new Map(hexes.map((hex) => [hexKey(hex.x, hex.y), hex]));

  for (const action of roadActions) {
    const unit = unitMap.get(action.params.unitId as string);
    if (!unit) {
      actionResults.push({ actionId: action.id, status: 'failed', result: `Unit ${truncId(String(action.params.unitId ?? ''))} not found` });
      continue;
    }

    if (unit.colonyId !== action.colonyId) {
      actionResults.push({ actionId: action.id, status: 'failed', result: `Unit ${truncId(unit.id)} does not belong to this colony` });
      continue;
    }

    if (unit.type !== 'engineer') {
      actionResults.push({ actionId: action.id, status: 'failed', result: 'Only engineers can build roads' });
      continue;
    }

    const colony = colonyMap.get(action.colonyId);
    if (!colony) {
      actionResults.push({ actionId: action.id, status: 'failed', result: `Colony ${truncId(action.colonyId)} not found` });
      continue;
    }

    const researched: string[] = ((colony as Colony & { researchedTechs?: string[] }).researchedTechs) ?? [];
    if (!researched.includes('civil_engineering')) {
      actionResults.push({ actionId: action.id, status: 'failed', result: 'Civil Engineering is required before building roads' });
      continue;
    }

    const from = { q: action.params.fromX as number, r: action.params.fromY as number };
    const to = { q: action.params.toX as number, r: action.params.toY as number };
    if (hexDistance(from, to) !== 1) {
      actionResults.push({ actionId: action.id, status: 'failed', result: 'Road endpoints must be adjacent hexes' });
      continue;
    }

    if (!((unit.hexX === from.q && unit.hexY === from.r) || (unit.hexX === to.q && unit.hexY === to.r))) {
      actionResults.push({ actionId: action.id, status: 'failed', result: 'Engineer must stand on one of the road endpoints' });
      continue;
    }

    const fromHex = hexMap.get(hexKey(from.q, from.r));
    const toHex = hexMap.get(hexKey(to.q, to.r));
    if (!fromHex || !toHex) {
      actionResults.push({ actionId: action.id, status: 'failed', result: 'Road endpoints must be on the map' });
      continue;
    }

    if (fromHex.terrain === 'ocean' || toHex.terrain === 'ocean') {
      actionResults.push({ actionId: action.id, status: 'failed', result: 'Roads cannot be built through ocean hexes' });
      continue;
    }

    if (getRoadEntry(fromHex, to)) {
      actionResults.push({ actionId: action.id, status: 'failed', result: 'A road already exists or is under construction on that edge' });
      continue;
    }

    if (!hasResources(colony.resources, ROAD_COST)) {
      actionResults.push({ actionId: action.id, status: 'failed', result: 'Insufficient resources for road: need 10 stone, 5 timber' });
      continue;
    }

    deductResources(colony.resources, ROAD_COST);
    setRoadBetween(hexMap, from, to, {
      colonyId: colony.id,
      status: 'building',
      remainingTicks: ROAD_BUILD_TICKS,
      lastSupportedTick: currentTick,
    });

    events.push({
      type: 'road_started',
      colonyId: colony.id,
      unitId: unit.id,
      data: {
        fromX: from.q,
        fromY: from.r,
        toX: to.q,
        toY: to.r,
        ticksRemaining: ROAD_BUILD_TICKS,
      },
    });
    actionResults.push({
      actionId: action.id,
      status: 'resolved',
      result: `Road construction started between (${from.q},${from.r}) and (${to.q},${to.r})`,
    });
  }

  return { events, actionResults };
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
        result: `Colony ${truncId(action.colonyId)} not found`,
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
  hexes: HexTileState[],
): { units: Unit[]; events: TickEvent[]; actionResults: ActionResult[] } {
  const events: TickEvent[] = [];
  const actionResults: ActionResult[] = [];
  const reservedScoutTargetsByColony = new Map<string, Set<string>>();
  const { terrainMap, exploredByColony, allHexKeys } = buildExplorationMaps(hexes);
  const occupancy = new Map<string, number>();

  // Build unit lookup for ownership/existence checks
  const unitMap = new Map<string, Unit>();
  for (const u of units) {
    unitMap.set(u.id, u);
    const key = hexKey(u.hexX, u.hexY);
    occupancy.set(key, (occupancy.get(key) ?? 0) + 1);
  }

  // Phase 1: Process move_unit, attack, and explore actions — compute paths and set queues
  // Attack actions work the same as move_unit — pathfind toward target hex.
  // Combat is resolved automatically when opposing units share a hex.
  const moveActions = actions.filter(a => a.type === 'move_unit' || a.type === 'attack' || a.type === 'explore');

  for (const action of moveActions) {
    const unitId = action.params.unitId as string;

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

    const from: HexCoord = { q: unit.hexX, r: unit.hexY };
    let to: HexCoord = from;
    let resultMessage = '';

    if (action.type === 'explore') {
      if (unit.type !== 'scout') {
        actionResults.push({
          actionId: action.id,
          status: 'failed',
          result: 'Only scouts can explore',
        });
        continue;
      }

      const explored = exploredByColony.get(unit.colonyId);
      if (!explored) {
        actionResults.push({
          actionId: action.id,
          status: 'failed',
          result: 'No explored frontier available yet',
        });
        continue;
      }

      const reservedTargets = reservedScoutTargetsByColony.get(unit.colonyId) ?? new Set<string>();
      reservedScoutTargetsByColony.set(unit.colonyId, reservedTargets);
      const choice = chooseExploreTarget(unit, explored, terrainMap, allHexKeys, hexLookup, reservedTargets);
      if (!choice) {
        actionResults.push({
          actionId: action.id,
          status: 'failed',
          result: 'No unexplored frontier hex available',
        });
        continue;
      }

      to = choice.target;
      unit.movementQueue = choice.path;
      reservedTargets.add(coordKey(to));
      resultMessage = `Exploration path computed: ${choice.path.length} steps`;
    } else {
      const targetX = action.params.targetX as number;
      const targetY = action.params.targetY as number;
      const desired: HexCoord = { q: targetX, r: targetY };
      to = desired;

      if (action.type === 'move_unit' && unit.type === 'scout') {
        const reservedTargets = reservedScoutTargetsByColony.get(unit.colonyId) ?? new Set<string>();
        reservedScoutTargetsByColony.set(unit.colonyId, reservedTargets);
        to = chooseScoutDestination(from, desired, hexLookup, reservedTargets);
        reservedTargets.add(coordKey(to));
      }

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

      unit.movementQueue = path;
      const redirected = to.q !== desired.q || to.r !== desired.r;
      resultMessage = redirected
        ? `Path computed: ${path.length} steps (destination adjusted to ${to.q},${to.r} to avoid scout overlap)`
        : `Path computed: ${path.length} steps`;
    }

    actionResults.push({
      actionId: action.id,
      status: 'resolved',
      result: resultMessage,
    });
    events.push({
      type: 'movement_queued',
      colonyId: unit.colonyId,
      unitId: unit.id,
      data: {
        from: { x: from.q, y: from.r },
        to: { x: to.q, y: to.r },
        pathLength: unit.movementQueue.length,
      },
    });
  }

  // Phase 2: Advance all units with movement queues
  for (const unit of units) {
    if (!unit.movementQueue || unit.movementQueue.length === 0) continue;

    const steps = movementStepsThisTick(unit.movementQueue, unit.type, hexLookup, { q: unit.hexX, r: unit.hexY });

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

    const moved: HexCoord[] = [];
    let blockedByFullHex = false;
    let current = { q: unit.hexX, r: unit.hexY };
    for (const next of unit.movementQueue.slice(0, steps)) {
      const nextKey = hexKey(next.q, next.r);
      const currentOccupancy = occupancy.get(nextKey) ?? 0;
      if (currentOccupancy >= MAX_UNITS_PER_HEX) {
        blockedByFullHex = true;
        break;
      }

      const currentKey = hexKey(current.q, current.r);
      occupancy.set(currentKey, Math.max(0, (occupancy.get(currentKey) ?? 1) - 1));
      occupancy.set(nextKey, currentOccupancy + 1);
      moved.push(next);
      current = next;
    }

    if (moved.length === 0 && blockedByFullHex) {
      events.push({
        type: 'movement_blocked',
        colonyId: unit.colonyId,
        unitId: unit.id,
        data: {
          hexX: unit.hexX,
          hexY: unit.hexY,
          reason: 'hex_full',
        },
      });
      continue;
    }
    const destination = moved[moved.length - 1];

    // Move unit
    const prevX = unit.hexX;
    const prevY = unit.hexY;
    unit.hexX = destination.q;
    unit.hexY = destination.r;

    // Drain queue
    unit.movementQueue = unit.movementQueue.slice(moved.length);

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

    if (blockedByFullHex) {
      events.push({
        type: 'movement_blocked',
        colonyId: unit.colonyId,
        unitId: unit.id,
        data: {
          hexX: unit.hexX,
          hexY: unit.hexY,
          reason: 'hex_full',
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
  const production = emptyResources();

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
  const upkeep = emptyResources();

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

// --- Combat Resolution ---

export interface CombatResult {
  units: Unit[];
  destroyedUnitIds: string[];
  events: TickEvent[];
  actionResults: ActionResult[];
  capturedSettlements: Array<{ settlementId: string; fromColony: string; toColony: string }>;
}

function isColonyProtected(colony: Colony, currentTick?: number): boolean {
  return currentTick !== undefined && (colony.newcomerProtectionUntilTick ?? 0) >= currentTick;
}

function buildProtectedHexMaps(
  colonies: Colony[],
  settlements: Settlement[],
  units: Unit[],
  currentTick?: number,
): {
  protectedColonyIds: Set<string>;
  protectedHexes: Map<string, Set<string>>;
  settlementOwnersByHex: Map<string, string>;
  unitOwnersByHex: Map<string, Set<string>>;
} {
  const protectedColonyIds = new Set(
    colonies.filter(colony => isColonyProtected(colony, currentTick)).map(colony => colony.id),
  );
  const protectedHexes = new Map<string, Set<string>>();
  const settlementOwnersByHex = new Map<string, string>();
  const unitOwnersByHex = new Map<string, Set<string>>();

  for (const settlement of settlements) {
    const key = hexKey(settlement.hexX, settlement.hexY);
    settlementOwnersByHex.set(key, settlement.colonyId);
    if (protectedColonyIds.has(settlement.colonyId)) {
      const owners = protectedHexes.get(key) ?? new Set<string>();
      owners.add(settlement.colonyId);
      protectedHexes.set(key, owners);
    }
  }

  for (const unit of units) {
    if (unit.health <= 0) continue;
    const key = hexKey(unit.hexX, unit.hexY);
    const unitOwners = unitOwnersByHex.get(key) ?? new Set<string>();
    unitOwners.add(unit.colonyId);
    unitOwnersByHex.set(key, unitOwners);
    if (protectedColonyIds.has(unit.colonyId)) {
      const owners = protectedHexes.get(key) ?? new Set<string>();
      owners.add(unit.colonyId);
      protectedHexes.set(key, owners);
    }
  }

  return { protectedColonyIds, protectedHexes, settlementOwnersByHex, unitOwnersByHex };
}

/**
 * Simple seeded PRNG (mulberry32). Used for deterministic combat results.
 * Pass seed=undefined for non-deterministic (Math.random) behavior.
 */
function createRng(seed?: number): () => number {
  if (seed === undefined) return Math.random;
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
export function resolveCombat(
  units: Unit[],
  actions: QueuedAction[],
  seed?: number,
  activeAgreements?: Agreement[],
  settlements?: Settlement[],
  colonies?: Colony[],
  protectedColonyIds?: Set<string>,
): CombatResult {
  const rng = createRng(seed);
  const events: TickEvent[] = [];
  const actionResults: ActionResult[] = [];
  const destroyedUnitIds: string[] = [];
  const combatDamageReceived = new Map<string, number>();
  const researchedTechsByColony = new Map<string, Set<string>>();

  if (colonies) {
    for (const colony of colonies) {
      const researched = new Set<string>(((colony as Colony & { researchedTechs?: string[] }).researchedTechs) ?? []);
      researchedTechsByColony.set(colony.id, researched);
    }
  }

  // Build peace-treaty lookup for active non-aggression, alliance, and ceasefire agreements.
  const napPairs = buildPeaceAgreementLookup(activeAgreements);
  const peaceAgreementType = new Map<string, AgreementType>();
  if (activeAgreements) {
    for (const agr of activeAgreements) {
      if (!hasPeaceAgreement(napPairs, agr.proposedBy, agr.proposedTo)) continue;
      const pair = [agr.proposedBy, agr.proposedTo].sort().join('|');
      peaceAgreementType.set(pair, agr.type);
    }
  }

  // Note: attack actions are handled as move_unit by resolveMovement() — pathfinding
  // toward the target hex. Combat resolution below handles the fighting when they arrive.

  // Group units by hex
  const hexUnits = new Map<string, Unit[]>();
  for (const unit of units) {
    const key = hexKey(unit.hexX, unit.hexY);
    const list = hexUnits.get(key) ?? [];
    list.push(unit);
    hexUnits.set(key, list);
  }

  const assignedSupportHexByUnitId = new Map<string, string>();
  const sortedCombatHexes = [...hexUnits.entries()]
    .filter(([, unitsOnHex]) => new Set(unitsOnHex.map(u => u.colonyId)).size > 1)
    .map(([hex]) => hex)
    .sort();

  // For each hex, check if there are units from multiple colonies
  for (const hex of sortedCombatHexes) {
    const unitsOnHex = hexUnits.get(hex) ?? [];
    const colonies = new Set(unitsOnHex.map(u => u.colonyId));
    if (colonies.size < 2) continue;

    // --- NAP enforcement ---
    // Check if ALL colony pairs on this hex have NAPs. If so, skip combat entirely.
    // If only some pairs have NAPs, combat still happens but NAP-protected units don't target each other.
    const colonyIds = [...colonies];
    let allPairsProtected = true;
    for (let i = 0; i < colonyIds.length; i++) {
      for (let j = i + 1; j < colonyIds.length; j++) {
        if (!hasPeaceAgreement(napPairs, colonyIds[i], colonyIds[j])) {
          allPairsProtected = false;
          break;
        }
      }
      if (!allPairsProtected) break;
    }

    if (allPairsProtected) {
      // All colonies on this hex have mutual NAPs — no combat, emit nap_blocked_combat event
      const [hexX, hexY] = hex.split(',').map(Number);
      const pairTypes = new Set<string>();
      for (let i = 0; i < colonyIds.length; i++) {
        for (let j = i + 1; j < colonyIds.length; j++) {
          const pair = [colonyIds[i], colonyIds[j]].sort().join('|');
          pairTypes.add((peaceAgreementType.get(pair) ?? 'treaty').replace(/_/g, ' '));
        }
      }
      const reason = `${[...pairTypes].join(' / ')} prevents combat`;
      for (const colonyId of colonyIds) {
        events.push({
          type: 'nap_blocked_combat',
          colonyId,
          data: {
            hexX,
            hexY,
            colonies: colonyIds.filter(c => c !== colonyId),
            reason,
          },
        });
      }
      continue; // Skip combat on this hex entirely
    }

    const combatParticipants = [...unitsOnHex];
    const supportUnitIds = new Set<string>();
    const parsedHex = parseHexKey(hex);
    if (parsedHex && unitsOnHex.length >= MAX_UNITS_PER_HEX) {
      const involvedColonies = new Set(unitsOnHex.map(unit => unit.colonyId));
      const neighboringHexes = hexNeighbors(parsedHex)
        .map(candidate => ({ key: hexKey(candidate.q, candidate.r), coord: candidate }))
        .sort((a, b) => a.key.localeCompare(b.key));

      for (const neighbor of neighboringHexes) {
        const neighborUnits = hexUnits.get(neighbor.key) ?? [];
        for (const unit of neighborUnits) {
          if (assignedSupportHexByUnitId.has(unit.id)) continue;
          if (!isMilitaryUnit(unit)) continue;
          if (!involvedColonies.has(unit.colonyId)) continue;
          if (unit.health <= 0) continue;
          supportUnitIds.add(unit.id);
          assignedSupportHexByUnitId.set(unit.id, hex);
          combatParticipants.push(unit);
        }
      }
    }

    // Combat! Units on this hex fight, with adjacent support on full contested hexes.
    // Each participant attacks a random enemy participant that is NOT NAP-protected.
    // Support units remain on adjacent hexes, deal reduced damage, and take reduced damage.
    // We process all attacks simultaneously (no kill-order advantage).

    // Calculate damage dealt by each unit
    const damageDealt = new Map<string, number>(); // target unitId → total damage
    const combatLog: Array<{
      attackerId: string;
      attackerType: string;
      attackerColony: string;
      targetId: string;
      targetType: string;
      targetColony: string;
      damage: number;
      supporting: boolean;
    }> = [];

    for (const attacker of combatParticipants) {
      const attackerSupporting = supportUnitIds.has(attacker.id);
      const attackerTechs = researchedTechsByColony.get(attacker.colonyId) ?? new Set<string>();
      const attackPower = (
        UNIT_ATTACK[attacker.type]
        + ((attacker.type === 'militia' || attacker.type === 'soldier') && attackerTechs.has('steel_weapons')
          ? STEEL_WEAPONS_ATTACK_BONUS
          : 0)
      ) * (attackerSupporting ? SUPPORT_COMBAT_ATTACK_MULTIPLIER : 1);
      if (attackPower <= 0) continue; // settlers can't attack

      // Find enemy units (from different colony AND not NAP-protected)
      const enemies = combatParticipants.filter(u =>
        u.colonyId !== attacker.colonyId
        && !hasPeaceAgreement(napPairs, attacker.colonyId, u.colonyId)
        && !(protectedColonyIds?.has(attacker.colonyId) || protectedColonyIds?.has(u.colonyId))
      );
      if (enemies.length === 0) continue;

      // Pick a random enemy target
      const target = enemies[Math.floor(rng() * enemies.length)];

      // Calculate damage with random bonus
      const bonus = rng() * COMBAT_RANDOM_BONUS;
      const rawDamage = attackPower * (1 + bonus);
      // Military units always deal at least COMBAT_MINIMUM_DAMAGE (#173)
      let effectiveDamage = Math.max(COMBAT_MINIMUM_DAMAGE, rawDamage - UNIT_DEFENSE[target.type]);

      if (supportUnitIds.has(target.id)) {
        effectiveDamage *= SUPPORT_COMBAT_DEFENSE_MULTIPLIER;
      }

      // Walls defense bonus: defending units on a settlement hex with walls take reduced damage
      if (settlements) {
        const defenderSettlement = settlements.find(
          s => s.colonyId === target.colonyId && s.hexX === target.hexX && s.hexY === target.hexY
        );
        if (defenderSettlement && defenderSettlement.buildings.some(b => b.type === 'walls') && !supportUnitIds.has(target.id)) {
          effectiveDamage = effectiveDamage / WALLS_DEFENSE_MULTIPLIER;
        }
      }

      const roundedDamage = Math.round(effectiveDamage * 100) / 100;

      const currentDamage = damageDealt.get(target.id) ?? 0;
      damageDealt.set(target.id, currentDamage + roundedDamage);

      if (settlements) {
        const hostileSettlement = settlements.find(
          s => s.colonyId !== attacker.colonyId && s.hexX === attacker.hexX && s.hexY === attacker.hexY
        );
        if (hostileSettlement) {
          const settlementOwnerTechs = researchedTechsByColony.get(hostileSettlement.colonyId) ?? new Set<string>();
          if (settlementOwnerTechs.has('fortifications')) {
            const retaliationDamage = damageDealt.get(attacker.id) ?? 0;
            damageDealt.set(attacker.id, retaliationDamage + FORTIFICATIONS_RETALIATION_DAMAGE);
          }
        }
      }

      combatLog.push({
        attackerId: attacker.id,
        attackerType: attacker.type,
        attackerColony: attacker.colonyId,
        targetId: target.id,
        targetType: target.type,
        targetColony: target.colonyId,
        damage: roundedDamage,
        supporting: attackerSupporting,
      });
    }

    if (combatLog.length === 0) continue;

    // Apply damage simultaneously
    const casualties: Array<{
      unitId: string;
      unitType: string;
      colonyId: string;
      damageReceived: number;
    }> = [];

    for (const unit of combatParticipants) {
      const totalDamage = damageDealt.get(unit.id) ?? 0;
      if (totalDamage > 0) {
        combatDamageReceived.set(unit.id, totalDamage);
      }
      if (totalDamage > 0) {
        unit.health = Math.round(unit.health - totalDamage);
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
    // --- Post-combat morale: winners vs losers ---
    // Determine winner per hex: the colony that dealt the most total damage wins.
    // Ties go to the side with fewer casualties.
    const [hexX, hexY] = hex.split(',').map(Number);
    const damageByColony = new Map<string, number>();
    const casualtiesByColony = new Map<string, number>();
    for (const log of combatLog) {
      damageByColony.set(log.attackerColony, (damageByColony.get(log.attackerColony) ?? 0) + log.damage);
    }
    for (const c of casualties) {
      casualtiesByColony.set(c.colonyId, (casualtiesByColony.get(c.colonyId) ?? 0) + 1);
    }

    // Find the colony that dealt the most damage
    let winnerColony: string | null = null;
    let maxDamage = 0;
    for (const [colId, dmg] of damageByColony) {
      if (dmg > maxDamage || (dmg === maxDamage && (casualtiesByColony.get(colId) ?? 0) < (casualtiesByColony.get(winnerColony ?? '') ?? 0))) {
        maxDamage = dmg;
        winnerColony = colId;
      }
    }

    // Check homeland defense bonus: is this hex within HOMELAND_DEFENSE_RANGE of any settlement?
    const homelandColonies = new Set<string>();
    if (settlements) {
      for (const s of settlements) {
        const dist = hexDistance({ q: hexX, r: hexY }, { q: s.hexX, r: s.hexY });
        if (dist <= HOMELAND_DEFENSE_RANGE) {
          homelandColonies.add(s.colonyId);
        }
      }
    }

    // Apply morale changes to surviving units
    for (const unit of unitsOnHex) {
      if (destroyedUnitIds.includes(unit.id)) continue;

      // Base combat morale loss (all combatants)
      let moraleChange = -COMBAT_MORALE_LOSS;

      if (winnerColony === unit.colonyId) {
        // Winner: net change = -COMBAT_MORALE_LOSS + COMBAT_MORALE_WIN
        moraleChange += COMBAT_MORALE_WIN;
      } else {
        // Loser: additional penalty
        moraleChange -= COMBAT_MORALE_LOSE;
      }

      // Homeland defense bonus
      if (homelandColonies.has(unit.colonyId)) {
        moraleChange += HOMELAND_MORALE_BONUS;
      }

      unit.morale = Math.round(Math.min(COMBAT_MORALE_CAP, Math.max(0, unit.morale + moraleChange)) * 100) / 100;

      // Garrison morale floor: units defending near their own settlement never drop below GARRISON_MORALE_FLOOR
      if (homelandColonies.has(unit.colonyId) && unit.morale < GARRISON_MORALE_FLOOR) {
        unit.morale = GARRISON_MORALE_FLOOR;
      }
    }

    // Emit combat_resolved event (visible to all involved colonies)
    const involvedColonies = [...colonies];
    for (const colonyId of involvedColonies) {
      events.push({
        type: 'combat_resolved',
        colonyId,
        data: {
          hexX,
          hexY,
          winnerColony,
          isHomeland: homelandColonies.has(colonyId),
          participants: combatParticipants.map(u => ({
            unitId: u.id,
            unitType: u.type,
            colonyId: u.colonyId,
            healthBefore: u.health + (damageDealt.get(u.id) ?? 0),
            healthAfter: u.health,
            morale: u.morale,
            destroyed: destroyedUnitIds.includes(u.id),
            supporting: supportUnitIds.has(u.id),
          })),
          casualties: casualties.length,
          combatLog,
        },
      });
    }
  }

  // --- Settler auto-flee: critically wounded settlers flee from combat hexes (#170) ---
  // Settlers at ≤ 10 HP on hexes with enemy units are auto-killed.
  // This prevents near-dead settlers from acting as permanent damage sponges.
  const SETTLER_CRITICAL_HP = 10;
  for (const unit of units) {
    if (destroyedUnitIds.includes(unit.id)) continue;
    if (unit.type !== 'settler') continue;
    if (unit.health > SETTLER_CRITICAL_HP) continue;

    // Check if there are enemy units on the same hex
    const unitKey = hexKey(unit.hexX, unit.hexY);
    const hexGroup = hexUnits.get(unitKey);
    if (!hexGroup) continue;
    const hasEnemies = hexGroup.some(u => u.colonyId !== unit.colonyId && !destroyedUnitIds.includes(u.id));
    if (!hasEnemies) continue;

    // Critically wounded settler in enemy-occupied hex — auto-kill
    destroyedUnitIds.push(unit.id);
    unit.health = 0;
    events.push({
      type: 'unit_destroyed',
      colonyId: unit.colonyId,
      unitId: unit.id,
      data: {
        unitType: 'settler',
        hexX: unit.hexX,
        hexY: unit.hexY,
        killedInCombat: true,
        damageReceived: combatDamageReceived.get(unit.id) ?? 0,
        reason: 'Critically wounded settler perished in contested territory',
      },
    });
  }

  // --- Military unit bleedout: near-dead military units perish after combat (#174) ---
  // Units at ≤ COMBAT_BLEEDOUT_THRESHOLD HP are destroyed after combat resolution.
  // This prevents zombie militia/soldiers lingering at 1 HP forever.
  for (const unit of units) {
    if (destroyedUnitIds.includes(unit.id)) continue;
    if (unit.type === 'settler' || unit.type === 'scout') continue; // settlers handled above, scouts don't fight
    if (!MILITARY_UNIT_TYPES.has(unit.type)) continue;
    if (unit.health > COMBAT_BLEEDOUT_THRESHOLD) continue;

    // Only bleedout units that participated in combat (on a contested hex)
    const unitKey = hexKey(unit.hexX, unit.hexY);
    const hexGroup = hexUnits.get(unitKey);
    if (!hexGroup) continue;
    const wasInCombat = hexGroup.some(u => u.colonyId !== unit.colonyId && !destroyedUnitIds.includes(u.id))
      || destroyedUnitIds.some(dId => {
        const destroyed = units.find(u => u.id === dId);
        return destroyed && destroyed.hexX === unit.hexX && destroyed.hexY === unit.hexY && destroyed.colonyId !== unit.colonyId;
      });
    if (!wasInCombat) continue;

    destroyedUnitIds.push(unit.id);
    unit.health = 0;
    events.push({
      type: 'unit_destroyed',
      colonyId: unit.colonyId,
      unitId: unit.id,
      data: {
        unitType: unit.type,
        hexX: unit.hexX,
        hexY: unit.hexY,
        killedInCombat: true,
        damageReceived: combatDamageReceived.get(unit.id) ?? 0,
        reason: `Critically wounded ${unit.type} bled out after combat`,
      },
    });
  }

  // Remove destroyed units
  const survivingUnits = units.filter(u => !destroyedUnitIds.includes(u.id));

  // --- Settlement capture: transfer settlements when defenders are eliminated ---
  // A hostile army occupying an undefended settlement hex can capture it even if
  // no combat happens on this tick. This prevents indefinite siege stalemates where
  // attackers clear defenders but cannot finish the conquest without another fight.
  const capturedSettlements: Array<{ settlementId: string; fromColony: string; toColony: string }> = [];
  if (settlements) {
    for (const settlement of settlements) {
      const occupyingUnits = survivingUnits.filter(
        u => u.hexX === settlement.hexX && u.hexY === settlement.hexY
      );
      if (occupyingUnits.length === 0) continue;

      // Check if the settlement's colony still has surviving units on this hex
      const defenderAlive = occupyingUnits.some(
        u => u.colonyId === settlement.colonyId
      );
      if (defenderAlive) continue;

      // Check if any enemy units occupy this hex
      const attackerUnits = occupyingUnits.filter(
        u => u.colonyId !== settlement.colonyId
      );
      if (attackerUnits.length === 0) continue;

      // Find which colony has the most surviving units on the hex (the capturer)
      const unitsByColony = new Map<string, number>();
      for (const u of attackerUnits) {
        unitsByColony.set(u.colonyId, (unitsByColony.get(u.colonyId) ?? 0) + 1);
      }
      let capturerColony = '';
      let maxUnits = 0;
      for (const [colId, count] of unitsByColony) {
        if (count > maxUnits) {
          maxUnits = count;
          capturerColony = colId;
        }
      }

      // Transfer settlement
      const oldColonyId = settlement.colonyId;
      settlement.colonyId = capturerColony;
      settlement.loyalty = 50; // Captured settlements start at 50 loyalty

      capturedSettlements.push({
        settlementId: settlement.id,
        fromColony: oldColonyId,
        toColony: capturerColony,
      });

      // Public event: settlement captured
      const involvedColonies = new Set([oldColonyId, capturerColony]);
      for (const colId of involvedColonies) {
        events.push({
          type: 'settlement_captured',
          colonyId: colId,
          data: {
            settlementId: settlement.id,
            settlementName: settlement.name,
            hexX: settlement.hexX,
            hexY: settlement.hexY,
            fromColony: oldColonyId,
            toColony: capturerColony,
            tier: settlement.tier,
            buildings: settlement.buildings.length,
          },
        });
      }
    }
  }

  return {
    units: survivingUnits,
    destroyedUnitIds,
    events,
    actionResults,
    capturedSettlements,
  };
}

// --- Message Resolution ---

/** Maximum messages a colony can send per tick */
export const MAX_MESSAGES_PER_TICK = 5;

/** Maximum message content length (characters) */
export const MAX_MESSAGE_LENGTH = 500;

/** Delivery delay in ticks (messages arrive 1 tick after sending) */
export const MESSAGE_DELIVERY_DELAY = 1;

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
export function resolveMessages(
  colonies: Colony[],
  actions: QueuedAction[],
  worldId: string,
  currentTick: number,
): MessageResult {
  const events: TickEvent[] = [];
  const actionResults: ActionResult[] = [];
  const newMessages: MessageRecord[] = [];

  const messageActions = actions.filter(a => a.type === 'send_message');
  if (messageActions.length === 0) {
    return { messages: newMessages, events, actionResults };
  }

  // Build colony lookup
  const colonyMap = new Map<string, Colony>();
  for (const c of colonies) {
    colonyMap.set(c.id, c);
  }

  // Track messages sent per colony this tick (for rate limiting)
  const sentCount = new Map<string, number>();

  for (const action of messageActions) {
    const toColonyId = action.params.toColonyId as string;
    const content = action.params.message as string;

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

    const message: MessageRecord = {
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
const CONVERTIBLE_RESOURCES: (keyof Resources)[] = ['food', 'timber', 'stone', 'iron'];

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
export function resolveConvertResources(
  settlements: Settlement[],
  colonies: Colony[],
  actions: QueuedAction[],
): ConvertResourcesResult {
  const events: TickEvent[] = [];
  const actionResults: ActionResult[] = [];

  const convertActions = actions.filter(a => a.type === 'convert_resources');
  if (convertActions.length === 0) {
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

  for (const action of convertActions) {
    const settlementId = action.params.settlementId as string;
    const fromResource = action.params.fromResource as keyof Resources;
    const toResource = action.params.toResource as keyof Resources;
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

    if ((colony.resources[fromResource] ?? 0) < amount) {
      actionResults.push({
        actionId: action.id,
        status: 'failed',
        result: `Insufficient ${fromResource}: have ${colony.resources[fromResource] ?? 0}, need ${amount}`,
      });
      continue;
    }

    // --- All checks passed: perform conversion ---
    const conversionRate = Math.max(
      MARKET_CONVERSION_MIN_RATE,
      MARKET_CONVERSION_BASE_RATE - (market.level - 1) * MARKET_CONVERSION_LEVEL_BONUS,
    );
    const received = Math.round((amount / conversionRate) * 100) / 100;

    colony.resources[fromResource] = Math.round(((colony.resources[fromResource] ?? 0) - amount) * 100) / 100;
    colony.resources[toResource] = Math.round(((colony.resources[toResource] ?? 0) + received) * 100) / 100;

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
export function autoExploreIdleScouts(
  units: Unit[],
  hexes: HexTileState[],
  hexLookup: HexLookup,
  actionedUnitIds: Set<string>,
): { events: TickEvent[] } {
  const events: TickEvent[] = [];
  const { terrainMap, exploredByColony, allHexKeys } = buildExplorationMaps(hexes);
  const reservedTargetsByColony = new Map<string, Set<string>>();

  // Find idle scouts
  const idleScouts = units.filter(u =>
    u.type === 'scout' &&
    (!u.movementQueue || u.movementQueue.length === 0) &&
    !actionedUnitIds.has(u.id)
  );

  for (const scout of idleScouts) {
    const exploredOrUndefined = exploredByColony.get(scout.colonyId);
    if (!exploredOrUndefined) continue;
    const explored: Set<string> = exploredOrUndefined;
    const reservedTargets = reservedTargetsByColony.get(scout.colonyId) ?? new Set<string>();
    reservedTargetsByColony.set(scout.colonyId, reservedTargets);
    const choice = chooseExploreTarget(scout, explored, terrainMap, allHexKeys, hexLookup, reservedTargets);
    if (!choice) continue;

    // Set movement queue
    scout.movementQueue = choice.path;
    reservedTargets.add(coordKey(choice.target));

    events.push({
      type: 'auto_explore',
      colonyId: scout.colonyId,
      unitId: scout.id,
      data: {
        from: { x: scout.hexX, y: scout.hexY },
        to: { x: choice.target.q, y: choice.target.r },
        pathLength: choice.path.length,
      },
    });
  }

  return { events };
}

// --- Tick Resolution ---

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

// --- Research Resolution ---

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
export function resolveResearch(
  colonies: Colony[],
  settlements: Settlement[],
  actions: QueuedAction[],
): ResearchResult {
  const events: TickEvent[] = [];
  const actionResults: ActionResult[] = [];

  const researchActions = actions.filter(a => a.type === 'research');

  // Phase 1: Process research actions
  for (const action of researchActions) {
    const colony = colonies.find(c => c.id === action.colonyId);
    if (!colony) {
      actionResults.push({ actionId: action.id, status: 'failed', result: 'Colony not found' });
      continue;
    }

    const techId = action.params.techId as TechId;
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
    const researched: string[] = (colony as any).researchedTechs ?? [];
    if (researched.includes(techId)) {
      actionResults.push({ actionId: action.id, status: 'failed', result: `Tech '${tech.name}' is already researched` });
      continue;
    }

    // Check prerequisites
    const eligibility = canResearchTech(techId, researched);
    if (!eligibility.ok) {
      actionResults.push({ actionId: action.id, status: 'failed', result: eligibility.reason });
      continue;
    }

    // Check not already in queue
    const queue: ResearchQueueEntry[] = (colony as any).researchQueue ?? [];
    if (queue.some(q => q.techId === techId)) {
      actionResults.push({ actionId: action.id, status: 'failed', result: `Tech '${tech.name}' is already being researched` });
      continue;
    }

    // Check max 1 research at a time
    if (queue.length >= 1) {
      actionResults.push({ actionId: action.id, status: 'failed', result: 'Research queue is full (max 1 at a time). Wait for current research to complete.' });
      continue;
    }

    // Check resources — must check ALL before proceeding
    let resourceShortage = false;
    for (const [resource, amount] of Object.entries(tech.cost)) {
      const key = resource as keyof Resources;
      if ((colony.resources[key] ?? 0) < (amount as number)) {
        actionResults.push({ actionId: action.id, status: 'failed', result: `Not enough ${resource}: need ${amount}, have ${Math.floor(colony.resources[key] ?? 0)}` });
        resourceShortage = true;
      }
    }
    if (resourceShortage) continue;

    // Deduct resources
    for (const [resource, amount] of Object.entries(tech.cost)) {
      colony.resources[resource as keyof Resources] -= amount as number;
    }

    // Add to queue
    queue.push({ techId, ticksRemaining: tech.ticks });
    (colony as any).researchQueue = queue;

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
    if (colony.status !== 'active') continue;

    const queue: ResearchQueueEntry[] = (colony as any).researchQueue ?? [];
    if (queue.length === 0) continue;

    const researched: string[] = (colony as any).researchedTechs ?? [];
    const completed: string[] = [];

    for (let i = queue.length - 1; i >= 0; i--) {
      queue[i].ticksRemaining--;
      if (queue[i].ticksRemaining <= 0) {
        const techId = queue[i].techId;
        const tech = TECH_TREE[techId as TechId];
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

    (colony as any).researchQueue = queue;
    (colony as any).researchedTechs = researched;
  }

  return { events, actionResults };
}


// ===== Agreement Types & Constants =====

export type AgreementType = 'non_aggression' | 'trade' | 'alliance' | 'ceasefire';
export type AgreementStatus = 'proposed' | 'active' | 'rejected' | 'broken';

export interface TradeTerms {
  gives: Partial<Resources>;
  receives: Partial<Resources>;
  intervalTicks?: number;
}

export interface CeasefireTerms {
  durationTicks: number;
}

export interface AllianceTerms {
  visionSharing?: true;
}

export interface Agreement {
  id: string;
  worldId: string;
  type: AgreementType;
  proposedBy: string;
  proposedTo: string;
  status: AgreementStatus;
  terms: TradeTerms | CeasefireTerms | AllianceTerms | Record<string, unknown>;
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

export const BREAK_TRADE_COST = 50;
export const BREAK_COSTS: Record<AgreementType, number> = {
  non_aggression: 30,
  trade: 50,
  alliance: 100,
  ceasefire: 20,
};

export const PROPOSAL_EXPIRY_TICKS = 50;
export const DEFAULT_CEASEFIRE_DURATION_TICKS = 25;
export const MIN_CEASEFIRE_DURATION_TICKS = 5;
export const MAX_CEASEFIRE_DURATION_TICKS = 100;
export const MIN_TRADE_INTERVAL_TICKS = 1;
export const MAX_TRADE_INTERVAL_TICKS = 25;

function normalizeResourceTerms(
  value: unknown,
  fieldName: 'gives' | 'receives',
): { valid: true; value: Partial<Resources> } | { valid: false; error: string } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { valid: false, error: `'terms.${fieldName}' must be an object with resource amounts` };
  }

  const normalized: Partial<Resources> = {};
  for (const [key, amount] of Object.entries(value)) {
    if (!['food', 'timber', 'stone', 'iron', 'steel', 'influence'].includes(key)) {
      return { valid: false, error: `Unknown resource '${key}' in terms.${fieldName}` };
    }
    if (typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0) {
      return { valid: false, error: `'terms.${fieldName}.${key}' must be a positive number` };
    }
    normalized[key as keyof Resources] = Math.round(amount * 100) / 100;
  }

  if (Object.keys(normalized).length === 0) {
    return { valid: false, error: `'terms.${fieldName}' must include at least one resource` };
  }

  return { valid: true, value: normalized };
}

export function normalizeAgreementTerms(
  agreementType: AgreementType,
  rawTerms: unknown,
): { valid: true; terms: Agreement['terms'] } | { valid: false; error: string } {
  const terms = rawTerms && typeof rawTerms === 'object' && !Array.isArray(rawTerms)
    ? rawTerms as Record<string, unknown>
    : {};

  switch (agreementType) {
    case 'trade': {
      const gives = normalizeResourceTerms(terms.gives, 'gives');
      if (!gives.valid) return gives;
      const receives = normalizeResourceTerms(terms.receives, 'receives');
      if (!receives.valid) return receives;

      let intervalTicks = 1;
      if (terms.intervalTicks !== undefined) {
        if (!Number.isInteger(terms.intervalTicks) || (terms.intervalTicks as number) < MIN_TRADE_INTERVAL_TICKS || (terms.intervalTicks as number) > MAX_TRADE_INTERVAL_TICKS) {
          return {
            valid: false,
            error: `'terms.intervalTicks' must be an integer between ${MIN_TRADE_INTERVAL_TICKS} and ${MAX_TRADE_INTERVAL_TICKS}`,
          };
        }
        intervalTicks = terms.intervalTicks as number;
      }

      return {
        valid: true,
        terms: {
          gives: gives.value,
          receives: receives.value,
          ...(intervalTicks > 1 ? { intervalTicks } : {}),
        },
      };
    }

    case 'ceasefire': {
      const rawDuration = terms.durationTicks;
      const durationTicks = rawDuration === undefined
        ? DEFAULT_CEASEFIRE_DURATION_TICKS
        : rawDuration;
      if (typeof durationTicks !== 'number' || !Number.isInteger(durationTicks) || durationTicks < MIN_CEASEFIRE_DURATION_TICKS || durationTicks > MAX_CEASEFIRE_DURATION_TICKS) {
        return {
          valid: false,
          error: `'terms.durationTicks' must be an integer between ${MIN_CEASEFIRE_DURATION_TICKS} and ${MAX_CEASEFIRE_DURATION_TICKS}`,
        };
      }
      return {
        valid: true,
        terms: { durationTicks: durationTicks as number },
      };
    }

    case 'alliance': {
      if (terms.visionSharing !== undefined && terms.visionSharing !== true) {
        return { valid: false, error: `'terms.visionSharing' must be true when provided` };
      }
      return {
        valid: true,
        terms: terms.visionSharing ? { visionSharing: true } : {},
      };
    }

    case 'non_aggression':
      return { valid: true, terms: {} };
  }
}

/**
 * Resolve propose/accept/reject/break agreement actions.
 */
export function resolveAgreementActions(
  colonies: Colony[],
  agreements: Agreement[],
  actions: QueuedAction[],
  currentTick: number,
  worldId?: string,
): AgreementActionResult {
  const events: TickEvent[] = [];
  const actionResults: ActionResult[] = [];
  const mutations: AgreementMutation[] = [];

  const agreementActions = actions.filter(a =>
    ['propose_agreement', 'accept_agreement', 'reject_agreement', 'break_agreement'].includes(a.type)
  );

  for (const action of agreementActions) {
    const colony = colonies.find(c => c.id === action.colonyId);
    if (!colony) {
      actionResults.push({ actionId: action.id, status: 'failed', result: 'Colony not found' });
      continue;
    }

    if (action.type === 'propose_agreement') {
      const targetColonyId = action.params?.targetColonyId as string;
      const agreementType = action.params?.agreementType as AgreementType;
      if (!targetColonyId || !agreementType) {
        actionResults.push({ actionId: action.id, status: 'failed', result: 'Missing targetColonyId or agreementType' });
        continue;
      }
      const targetColony = colonies.find(c => c.id === targetColonyId);
      if (!targetColony) {
        actionResults.push({ actionId: action.id, status: 'failed', result: 'Target colony not found' });
        continue;
      }
      const existing = agreements.find(a =>
        a.type === agreementType &&
        (a.status === 'proposed' || a.status === 'active') &&
        ((a.proposedBy === colony.id && a.proposedTo === targetColonyId) ||
         (a.proposedBy === targetColonyId && a.proposedTo === colony.id))
      );
      if (existing) {
        actionResults.push({ actionId: action.id, status: 'failed', result: `Already have ${existing.status} ${agreementType} agreement` });
        continue;
      }
      const normalizedTerms = normalizeAgreementTerms(agreementType, action.params?.terms);
      if (!normalizedTerms.valid) {
        actionResults.push({ actionId: action.id, status: 'failed', result: normalizedTerms.error });
        continue;
      }
      const newAgreement: Agreement = {
        id: `agr_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
        worldId: worldId || '',
        type: agreementType,
        proposedBy: colony.id,
        proposedTo: targetColonyId,
        status: 'proposed',
        terms: normalizedTerms.terms,
        proposedAtTick: currentTick,
        acceptedAtTick: null,
      };
      mutations.push({ type: 'create', agreement: newAgreement });
      actionResults.push({ actionId: action.id, status: 'resolved' });
      events.push({ type: 'agreement_proposed', colonyId: colony.id, data: { agreementId: newAgreement.id, agreementType, targetColonyId, visibility: [colony.id, targetColonyId] } });
    }

    if (action.type === 'accept_agreement') {
      const agreementId = action.params?.agreementId as string;
      const agreement = agreements.find(a => a.id === agreementId);
      if (!agreement) { actionResults.push({ actionId: action.id, status: 'failed', result: 'Agreement not found' }); continue; }
      if (agreement.proposedTo !== colony.id) { actionResults.push({ actionId: action.id, status: 'failed', result: 'Only the recipient can accept' }); continue; }
      if (agreement.status !== 'proposed') { actionResults.push({ actionId: action.id, status: 'failed', result: `Agreement is ${agreement.status}` }); continue; }
      agreement.status = 'active';
      agreement.acceptedAtTick = currentTick;
      mutations.push({ type: 'update', agreement: { ...agreement } });
      actionResults.push({ actionId: action.id, status: 'resolved' });
      events.push({ type: 'agreement_accepted', colonyId: colony.id, data: { agreementId, agreementType: agreement.type, partnerColonyId: agreement.proposedBy, visibility: [colony.id, agreement.proposedBy] } });
    }

    if (action.type === 'reject_agreement') {
      const agreementId = action.params?.agreementId as string;
      const agreement = agreements.find(a => a.id === agreementId);
      if (!agreement) { actionResults.push({ actionId: action.id, status: 'failed', result: 'Agreement not found' }); continue; }
      if (agreement.proposedTo !== colony.id) { actionResults.push({ actionId: action.id, status: 'failed', result: 'Only the recipient can reject' }); continue; }
      if (agreement.status !== 'proposed') { actionResults.push({ actionId: action.id, status: 'failed', result: `Agreement is ${agreement.status}` }); continue; }
      agreement.status = 'rejected';
      mutations.push({ type: 'update', agreement: { ...agreement } });
      actionResults.push({ actionId: action.id, status: 'resolved' });
      events.push({ type: 'agreement_rejected', colonyId: colony.id, data: { agreementId, agreementType: agreement.type, visibility: [colony.id, agreement.proposedBy] } });
    }

    if (action.type === 'break_agreement') {
      const agreementId = action.params?.agreementId as string;
      const agreement = agreements.find(a => a.id === agreementId);
      if (!agreement) { actionResults.push({ actionId: action.id, status: 'failed', result: 'Agreement not found' }); continue; }
      if (agreement.status !== 'active') { actionResults.push({ actionId: action.id, status: 'failed', result: `Agreement is ${agreement.status}` }); continue; }
      if (agreement.proposedBy !== colony.id && agreement.proposedTo !== colony.id) { actionResults.push({ actionId: action.id, status: 'failed', result: 'Not party to this agreement' }); continue; }
      const influenceCost = BREAK_COSTS[agreement.type] || 50;
      if ((colony.resources?.influence ?? 0) < influenceCost) { actionResults.push({ actionId: action.id, status: 'failed', result: `Need ${influenceCost} influence` }); continue; }
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
    if (agreement.status === 'active' && agreement.type === 'ceasefire') {
      const terms = agreement.terms as CeasefireTerms;
      const durationTicks = terms.durationTicks ?? DEFAULT_CEASEFIRE_DURATION_TICKS;
      const acceptedAtTick = agreement.acceptedAtTick ?? currentTick;
      if ((currentTick - acceptedAtTick) >= durationTicks) {
        agreement.status = 'broken';
        mutations.push({ type: 'update', agreement: { ...agreement } });
        events.push({
          type: 'agreement_broken',
          colonyId: agreement.proposedBy,
          data: {
            agreementId: agreement.id,
            agreementType: agreement.type,
            brokenBy: 'system',
            reason: 'Ceasefire duration elapsed',
            visibility: [agreement.proposedBy, agreement.proposedTo],
          },
        });
      }
    }
  }

  return { events, actionResults, mutations };
}

/**
 * Auto-diplomacy: colonies automatically respond to pending agreement proposals (#167).
 *
 * After PROPOSAL_AUTO_RESPOND_TICKS, if the recipient colony hasn't manually responded,
 * the system auto-evaluates the proposal:
 * - Non-aggression pacts: auto-accept (generally beneficial for both sides)
 * - Alliances: auto-accept if not currently at war with proposer
 * - Trade agreements: auto-reject (AI can't evaluate fairness of terms)
 *
 * Also generates auto-reply messages when colonies receive diplomatic messages
 * and haven't responded within AUTO_MESSAGE_REPLY_TICKS.
 */
export const PROPOSAL_AUTO_RESPOND_TICKS = 10; // ~50 minutes — give players time to respond manually

export function resolveAutoDiplomacy(
  colonies: Colony[],
  agreements: Agreement[],
  units: { colonyId: string; hexX: number; hexY: number }[],
  currentTick: number,
  worldId: string,
): { events: TickEvent[]; mutations: AgreementMutation[]; messages: MessageRecord[] } {
  const events: TickEvent[] = [];
  const mutations: AgreementMutation[] = [];
  const messages: MessageRecord[] = [];

  // Build a set of colony pairs currently in combat (enemy units on same hex)
  const atWar = new Set<string>();
  const unitsByHex = new Map<string, string[]>();
  for (const u of units) {
    const key = `${u.hexX},${u.hexY}`;
    if (!unitsByHex.has(key)) unitsByHex.set(key, []);
    unitsByHex.get(key)!.push(u.colonyId);
  }
  for (const [, colIds] of unitsByHex) {
    const unique = [...new Set(colIds)];
    for (let i = 0; i < unique.length; i++) {
      for (let j = i + 1; j < unique.length; j++) {
        atWar.add([unique[i], unique[j]].sort().join('|'));
      }
    }
  }

  // Colony name lookup
  const colonyNameMap = new Map<string, string>();
  for (const c of colonies) {
    colonyNameMap.set(c.id, c.name);
  }

  // Process pending proposals that have been waiting long enough
  for (const agreement of agreements) {
    if (agreement.status !== 'proposed') continue;
    const waitTicks = currentTick - agreement.proposedAtTick;
    if (waitTicks < PROPOSAL_AUTO_RESPOND_TICKS) continue;

    const proposerName = colonyNameMap.get(agreement.proposedBy) ?? 'Unknown Colony';
    const recipientName = colonyNameMap.get(agreement.proposedTo) ?? 'Unknown Colony';
    const pairKey = [agreement.proposedBy, agreement.proposedTo].sort().join('|');

    let autoAccept = false;
    let reason = '';

    switch (agreement.type) {
      case 'non_aggression':
        // Always accept NAPs — peace is generally beneficial
        autoAccept = true;
        reason = `${recipientName} has agreed to the non-aggression pact. Peace serves both our colonies well.`;
        break;

      case 'alliance':
        // Accept alliances if not currently at war with proposer
        if (atWar.has(pairKey)) {
          autoAccept = false;
          reason = `${recipientName} declines the alliance proposal — our colonies are currently in conflict. Cease hostilities first.`;
        } else {
          autoAccept = true;
          reason = `${recipientName} accepts the alliance. Together we are stronger.`;
        }
        break;

      case 'trade':
        // Auto-reject trade — can't evaluate terms
        autoAccept = false;
        reason = `${recipientName} has reviewed the trade terms but declines at this time. The terms do not align with our current economic priorities.`;
        break;
      case 'ceasefire':
        autoAccept = true;
        reason = atWar.has(pairKey)
          ? `${recipientName} accepts the ceasefire. Let the current fighting end before it consumes us both.`
          : `${recipientName} accepts the ceasefire. We will hold our fire for now.`;
        break;
    }

    if (autoAccept) {
      agreement.status = 'active';
      agreement.acceptedAtTick = currentTick;
      mutations.push({ type: 'update', agreement: { ...agreement } });
      events.push({
        type: 'agreement_accepted',
        colonyId: agreement.proposedTo,
        data: {
          agreementId: agreement.id,
          agreementType: agreement.type,
          partnerColonyId: agreement.proposedBy,
          autoResponse: true,
          visibility: [agreement.proposedBy, agreement.proposedTo],
        },
      });
    } else {
      agreement.status = 'rejected';
      mutations.push({ type: 'update', agreement: { ...agreement } });
      events.push({
        type: 'agreement_rejected',
        colonyId: agreement.proposedTo,
        data: {
          agreementId: agreement.id,
          agreementType: agreement.type,
          autoResponse: true,
          visibility: [agreement.proposedBy, agreement.proposedTo],
        },
      });
    }

    // Generate a diplomatic message explaining the decision
    const msg: MessageRecord = {
      id: `msg_auto_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
      worldId,
      fromColony: agreement.proposedTo,
      toColony: agreement.proposedBy,
      sentAtTick: currentTick,
      deliveredAtTick: currentTick,
      content: reason,
      read: false,
    };
    messages.push(msg);
    events.push({
      type: 'message_received',
      colonyId: agreement.proposedBy,
      data: {
        messageId: msg.id,
        fromColony: agreement.proposedTo,
        fromColonyName: recipientName,
        autoResponse: true,
      },
    });
  }

  return { events, mutations, messages };
}

/**
 * Transfer resources between colonies with active trade agreements.
 */
export function resolveTradeTransfers(
  colonies: Colony[],
  agreements: Agreement[],
  currentTick: number,
): TradeTransferResult {
  const events: TickEvent[] = [];
  const activeTradeAgreements = agreements.filter(a => a.type === 'trade' && a.status === 'active');

  for (const agreement of activeTradeAgreements) {
    const terms = agreement.terms as TradeTerms;
    if (!terms?.gives || !terms?.receives) continue;
    const intervalTicks = terms.intervalTicks ?? 1;
    if (intervalTicks > 1 && currentTick % intervalTicks !== 0) continue;
    const giver = colonies.find(c => c.id === agreement.proposedBy);
    const receiver = colonies.find(c => c.id === agreement.proposedTo);
    if (!giver || !receiver) continue;

    let canTransfer = true;
    for (const [res, amount] of Object.entries(terms.gives)) {
      if ((giver.resources[res as keyof Resources] ?? 0) < (amount ?? 0)) { canTransfer = false; break; }
    }
    if (!canTransfer) continue;
    for (const [res, amount] of Object.entries(terms.receives)) {
      if ((receiver.resources[res as keyof Resources] ?? 0) < (amount ?? 0)) { canTransfer = false; break; }
    }
    if (!canTransfer) continue;

    for (const [res, amount] of Object.entries(terms.gives)) {
      const key = res as keyof Resources;
      giver.resources[key] = (giver.resources[key] ?? 0) - (amount ?? 0);
      receiver.resources[key] = (receiver.resources[key] ?? 0) + (amount ?? 0);
    }
    for (const [res, amount] of Object.entries(terms.receives)) {
      const key = res as keyof Resources;
      receiver.resources[key] = (receiver.resources[key] ?? 0) - (amount ?? 0);
      giver.resources[key] = (giver.resources[key] ?? 0) + (amount ?? 0);
    }
    events.push({ type: 'trade_transfer', colonyId: giver.id, data: { agreementId: agreement.id, from: giver.id, to: receiver.id, visibility: [giver.id, receiver.id] } });
  }

  return { colonies, events };
}

export function resolveTick(
  colonies: Colony[],
  settlements: Settlement[],
  units: Unit[],
  hexes: HexTileState[],
  actions: QueuedAction[] = [],
  combatSeed?: number,
  worldId?: string,
  currentTick?: number,
  agreements?: Agreement[],
): TickResult {
  const events: TickEvent[] = [];
  const desertedUnitIds: string[] = [];
  const criticalWoundUnitIds: string[] = [];
  let actionResults: ActionResult[] = [];
  let fogReveals: HexExploration[] = [];
  let newMessages: MessageRecord[] = [];
  let agreementMutations: AgreementMutation[] = [];
  const combatHexesThisTick = new Set<string>();
  const combatParticipantIdsThisTick = new Set<string>();
  const capturedSettlementIdsThisTick = new Set<string>();

  // --- Agreement resolution (before other actions) ---
  {
    const agreementResult = resolveAgreementActions(colonies, agreements || [], actions, currentTick || 0, worldId);
    events.push(...agreementResult.events);
    actionResults.push(...agreementResult.actionResults);
    agreementMutations = agreementResult.mutations;
    const agreementTypes = new Set(['propose_agreement', 'accept_agreement', 'reject_agreement', 'break_agreement']);
    actions = actions.filter(a => !agreementTypes.has(a.type));
  }

  // --- Auto-diplomacy: respond to pending proposals (#167) ---
  // After manual agreement actions are resolved, auto-respond to proposals
  // that have been pending for PROPOSAL_AUTO_RESPOND_TICKS ticks.
  {
    // Apply agreement mutations so far to get current state
    const currentAgreements = [...(agreements || [])];
    for (const mut of agreementMutations) {
      if (mut.type === 'update') {
        const idx = currentAgreements.findIndex(a => a.id === mut.agreement.id);
        if (idx >= 0) currentAgreements[idx] = mut.agreement;
      } else if (mut.type === 'create') {
        currentAgreements.push(mut.agreement);
      }
    }
    const autoDipResult = resolveAutoDiplomacy(colonies, currentAgreements, units, currentTick || 0, worldId || '');
    events.push(...autoDipResult.events);
    agreementMutations.push(...autoDipResult.mutations);
    newMessages.push(...autoDipResult.messages);
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
    // Collect units that have found_settlement or disband actions (these units will be consumed/removed)
    const consumedUnitIds = new Set<string>();
    for (const a of actions) {
      if (a.type === 'found_settlement' || a.type === 'disband') {
        const unitId = (a.params?.unitId as string) || null;
        if (unitId) consumedUnitIds.add(unitId);
      }
    }

    const unitActions = new Map<string, number>(); // unitId -> last action index
    const deduped: QueuedAction[] = [];
    for (let i = 0; i < actions.length; i++) {
      const a = actions[i];
      const unitId = (a.params?.unitId as string) || null;
      if (unitId && (a.type === 'move_unit' || a.type === 'attack' || a.type === 'explore' || a.type === 'survey_poi')) {
        unitActions.set(unitId, i);
      }
    }
    for (let i = 0; i < actions.length; i++) {
      const a = actions[i];
      const unitId = (a.params?.unitId as string) || null;
      if (unitId && (a.type === 'move_unit' || a.type === 'attack' || a.type === 'explore' || a.type === 'survey_poi')) {
        // Reject movement for units that are being consumed by found_settlement or disband
        if (consumedUnitIds.has(unitId)) {
          const reason = actions.find(x => (x.type === 'found_settlement' || x.type === 'disband') && x.params?.unitId === unitId)?.type;
          actionResults.push({
            actionId: a.id,
            status: 'failed',
            result: `Unit ${unitId} has a ${reason} action — unit action rejected`,
          });
          continue;
        }
        if (unitActions.get(unitId) === i) {
          deduped.push(a); // keep only the last move/attack per unit
        } else {
          actionResults.push({ actionId: a.id, status: 'failed', result: 'Superseded by later action for same unit' });
        }
      } else {
        deduped.push(a); // non-unit actions are always kept
      }
    }
    // Replace actions with deduped list for all subsequent phases
    actions = deduped;
  }

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

  // --- Newcomer protection: protected colonies cannot initiate attacks ---
  if (currentTick !== undefined) {
    const colonyById = new Map(updatedColonies.map(colony => [colony.id, colony]));
    const allowedActions: QueuedAction[] = [];
    for (const action of actions) {
      if (action.type !== 'attack') {
        allowedActions.push(action);
        continue;
      }

      const actingColony = colonyById.get(action.colonyId);
      if (actingColony && isColonyProtected(actingColony, currentTick)) {
        actionResults.push({
          actionId: action.id,
          status: 'failed',
          result: `Colony ${actingColony.name} is under newcomer protection until tick ${actingColony.newcomerProtectionUntilTick}`,
        });
        continue;
      }

      allowedActions.push(action);
    }
    actions = allowedActions;
  }

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

  // --- Phase -0.5: Resolve disband actions (before movement — disbanded units don't move) ---
  const tickDisbandedUnitIds: string[] = [];
  const disbandActions = actions.filter(a => a.type === 'disband');
  if (disbandActions.length > 0) {
    const disbandResult = resolveDisband(updatedUnits, actions);
    updatedUnits = disbandResult.units.map(u => ({
      ...u,
      movementQueue: u.movementQueue ? [...u.movementQueue] : [],
    }));
    events.push(...disbandResult.events);
    actionResults.push(...disbandResult.actionResults);
    tickDisbandedUnitIds.push(...disbandResult.disbandedUnitIds);
  }

  // Track unit positions before movement for fog-of-war
  const unitPositionsBefore = new Map<string, { x: number; y: number }>();
  for (const u of updatedUnits) {
    unitPositionsBefore.set(u.id, { x: u.hexX, y: u.hexY });
  }

  // --- Phase 0: Resolve movement actions + advance movement queues ---
  if (currentTick !== undefined) {
    const roadProgress = progressRoads(hexes, updatedSettlements, currentTick);
    events.push(...roadProgress.events);
  }
  const roadBuildResult = currentTick !== undefined
    ? resolveBuildRoad(updatedUnits, updatedColonies, updatedSettlements, hexes, actions, currentTick)
    : { events: [], actionResults: [] };
  events.push(...roadBuildResult.events);
  actionResults.push(...roadBuildResult.actionResults);
  const hexLookup = createHexLookup(hexes.map(h => ({ x: h.x, y: h.y, terrain: h.terrain, roads: h.roads })));
  const hasMovingUnits = updatedUnits.some(u => u.movementQueue && u.movementQueue.length > 0);
  const nonFoundActions = actions.filter(a => a.type !== 'found_settlement' && a.type !== 'build_road');
  if (nonFoundActions.length > 0 || hasMovingUnits) {
    const moveResult = resolveMovement(updatedUnits, nonFoundActions, hexLookup, hexes);
    events.push(...moveResult.events);
    actionResults.push(...moveResult.actionResults);
  }

  // --- Newcomer protection: block illegal movement into protected or hostile occupied hexes ---
  if (currentTick !== undefined) {
    const { protectedHexes, settlementOwnersByHex, unitOwnersByHex } = buildProtectedHexMaps(
      updatedColonies,
      updatedSettlements,
      updatedUnits,
      currentTick,
    );
    const colonyById = new Map(updatedColonies.map(colony => [colony.id, colony]));

    for (const unit of updatedUnits) {
      const before = unitPositionsBefore.get(unit.id);
      if (!before) continue;
      if (before.x === unit.hexX && before.y === unit.hexY) continue;

      const destinationKey = hexKey(unit.hexX, unit.hexY);
      const destinationProtectedOwners = protectedHexes.get(destinationKey) ?? new Set<string>();
      const destinationUnitOwners = unitOwnersByHex.get(destinationKey) ?? new Set<string>();
      const destinationSettlementOwner = settlementOwnersByHex.get(destinationKey);
      const actingColony = colonyById.get(unit.colonyId);
      const actingProtected = actingColony ? isColonyProtected(actingColony, currentTick) : false;

      const enteringProtectedEnemyHex = [...destinationProtectedOwners].some(owner => owner !== unit.colonyId);
      const enteringEnemyOccupiedHex = [...destinationUnitOwners].some(owner => owner !== unit.colonyId)
        || (destinationSettlementOwner !== undefined && destinationSettlementOwner !== unit.colonyId);

      if (!enteringProtectedEnemyHex && !(actingProtected && enteringEnemyOccupiedHex)) continue;

      unit.hexX = before.x;
      unit.hexY = before.y;
      unit.movementQueue = [];

      events.push({
        type: 'movement_blocked',
        colonyId: unit.colonyId,
        unitId: unit.id,
        data: {
          hexX: before.x,
          hexY: before.y,
          reason: enteringProtectedEnemyHex ? 'newcomer_protection' : 'protected_colony_cannot_enter_enemy_territory',
        },
      });
    }
  }

  // --- Phase 0.1: Auto-explore idle scouts ---
  // Scouts with no movement queue and no action this tick automatically
  // pathfind toward the nearest unexplored frontier hex.
  {
    const actionedUnitIds = new Set<string>();
    for (const action of actions) {
      const unitId = action.params.unitId as string | undefined;
      if (unitId) actionedUnitIds.add(unitId);
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
          const isAutoExplore = exploreResult.events.some(
            e => e.type === 'auto_explore' && e.unitId === unit.id
          );
          if (isAutoExplore) {
            const steps = movementStepsThisTick(unit.movementQueue, unit.type, hexLookup, { q: unit.hexX, r: unit.hexY });
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

  // --- Treaty enforcement: hostile units cannot occupy settlement hexes protected by active peace agreements ---
  {
    const peacePairs = buildPeaceAgreementLookup(agreements);
    const settlementByHex = new Map(updatedSettlements.map(settlement => [hexKey(settlement.hexX, settlement.hexY), settlement]));
    const terrainByHex = new Map(hexes.map(hex => [hexKey(hex.x, hex.y), hex.terrain]));

    const isValidEvictionHex = (unit: Unit, candidate: HexCoord, settlementOwner: string): boolean => {
      const candidateKey = hexKey(candidate.q, candidate.r);
      const terrain = terrainByHex.get(candidateKey);
      if (!terrain) return false;
      if (!findPath({ q: unit.hexX, r: unit.hexY }, candidate, hexLookup)) return false;

      const settlement = settlementByHex.get(candidateKey);
      if (!settlement) return true;
      if (settlement.colonyId === unit.colonyId) return true;
      return !hasPeaceAgreement(peacePairs, unit.colonyId, settlement.colonyId) && settlement.colonyId !== settlementOwner;
    };

    for (const unit of updatedUnits) {
      const settlement = settlementByHex.get(hexKey(unit.hexX, unit.hexY));
      if (!settlement) continue;
      if (settlement.colonyId === unit.colonyId) continue;
      if (!hasPeaceAgreement(peacePairs, unit.colonyId, settlement.colonyId)) continue;

      const before = unitPositionsBefore.get(unit.id);
      let evictionTarget: HexCoord | null = null;

      if (before && (before.x !== unit.hexX || before.y !== unit.hexY)) {
        const previousHex = { q: before.x, r: before.y };
        if (isValidEvictionHex(unit, previousHex, settlement.colonyId)) {
          evictionTarget = previousHex;
        }
      }

      if (!evictionTarget) {
        const fallbackNeighbors = hexNeighbors({ q: unit.hexX, r: unit.hexY })
          .sort((a, b) => {
            if (a.q !== b.q) return a.q - b.q;
            return a.r - b.r;
          });
        evictionTarget = fallbackNeighbors.find(candidate => isValidEvictionHex(unit, candidate, settlement.colonyId)) ?? null;
      }

      if (!evictionTarget) continue;

      unit.hexX = evictionTarget.q;
      unit.hexY = evictionTarget.r;
      unit.movementQueue = [];

      events.push({
        type: 'movement_blocked',
        colonyId: unit.colonyId,
        unitId: unit.id,
        data: {
          hexX: unit.hexX,
          hexY: unit.hexY,
          reason: 'peace_treaty_protected_settlement',
        },
      });
    }
  }

  // --- Phase 0.25: Resolve combat (after movement, before fog) ---
  // Units from different colonies sharing a hex fight automatically.
  {
    for (const unit of updatedUnits) {
      if (unit.health <= 0) continue;
      const hexKey = `${unit.hexX},${unit.hexY}`;
      const coloniesOnHex = updatedUnits.filter(
        other => other.health > 0 && other.hexX === unit.hexX && other.hexY === unit.hexY
      );
      if (new Set(coloniesOnHex.map(other => other.colonyId)).size > 1) {
        combatHexesThisTick.add(hexKey);
      }
    }

    const protectedColonyIds = new Set(
      updatedColonies.filter(colony => isColonyProtected(colony, currentTick)).map(colony => colony.id),
    );
    const combatResult = resolveCombat(
      updatedUnits,
      actions,
      combatSeed,
      agreements,
      updatedSettlements,
      updatedColonies,
      protectedColonyIds,
    );
    if (combatResult.destroyedUnitIds.length > 0 || combatResult.events.length > 0) {
      updatedUnits = combatResult.units.map(u => ({
        ...u,
        movementQueue: u.movementQueue ? [...u.movementQueue] : [],
      }));
      events.push(...combatResult.events);
      actionResults.push(...combatResult.actionResults);

      for (const event of combatResult.events) {
        if (event.type !== 'combat_resolved') continue;
        const participants = (event.data as { participants?: Array<{ unitId: string }> }).participants ?? [];
        for (const participant of participants) {
          combatParticipantIdsThisTick.add(participant.unitId);
        }
      }
    }

    // Handle settlement captures: award legacy score, check for colony elimination
    if (combatResult.capturedSettlements.length > 0) {
      for (const capture of combatResult.capturedSettlements) {
        capturedSettlementIdsThisTick.add(capture.settlementId);
        // Award legacy score to capturer
        const capturer = updatedColonies.find(c => c.id === capture.toColony);
        if (capturer) {
          capturer.legacyScore = (capturer.legacyScore ?? 0) + SETTLEMENT_CAPTURE_SCORE;
        }

        // Check if the losing colony has any settlements left
        const loser = updatedColonies.find(c => c.id === capture.fromColony);
        if (loser) {
          const remainingSettlements = updatedSettlements.filter(s => s.colonyId === loser.id);
          if (remainingSettlements.length === 0) {
            // Colony eliminated!
            loser.status = 'eliminated';
            loser.diedAtTick = currentTick;
            loser.deathReason = 'All settlements captured';

            events.push({
              type: 'colony_eliminated',
              colonyId: loser.id,
              data: {
                colonyName: loser.name,
                eliminatedBy: capture.toColony,
                reason: 'All settlements captured',
                tick: currentTick,
              },
            });
          }
        }
      }
    }
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

    // Build intel map for scouting reports
    const settlementHexes = new Map<string, { colonyId: string; name: string }>();
    for (const s of updatedSettlements) {
      settlementHexes.set(`${s.hexX},${s.hexY}`, { colonyId: s.colonyId, name: s.name });
    }
    const unitHexes = new Map<string, Array<{ colonyId: string; type: string }>>();
    for (const u of updatedUnits) {
      const key = `${u.hexX},${u.hexY}`;
      if (!unitHexes.has(key)) unitHexes.set(key, []);
      unitHexes.get(key)!.push({ colonyId: u.colonyId, type: u.type });
    }

    const fogResult = computeFogReveals(movedUnits, allHexCoords, alreadyExplored, { settlementHexes, unitHexes });
    fogReveals.push(...fogResult.reveals);
    events.push(...fogResult.events);

    // --- POI Discovery: check newly revealed hexes for discovery POIs ---
    const DISCOVERY_BONUSES: Record<string, Partial<Resources>> = {
      ancient_ruins:   { stone: 50, iron: 30 },
      abandoned_cache: { food: 30, timber: 20, stone: 20 },
      crystal_cavern:  { iron: 80 },
    };

    for (const reveal of fogResult.reveals) {
      const hex = hexMap.get(hexKey(reveal.hex.q, reveal.hex.r));
      if (!hex?.poi) continue;
      if (hex.poi.discoveredBy) continue; // Already discovered by someone else

      const poiType = hex.poi.type;
      const bonus = DISCOVERY_BONUSES[poiType];

      // Mark POI as discovered
      hex.poi = { ...hex.poi, discoveredBy: reveal.colonyId, discoveredAtTick: currentTick ?? 0 };

      if (bonus) {
        // Apply one-time resource bonus to discovering colony
        const colony = updatedColonies.find(c => c.id === reveal.colonyId);
        if (colony) {
          for (const [resource, amount] of Object.entries(bonus)) {
            colony.resources[resource as keyof Resources] += amount as number;
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
      } else {
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
    const trainResult = resolveTrainUnit(updatedColonies, updatedSettlements, actions, updatedUnits);
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

  // --- Phase 1.96: Resolve POI survey actions ---
  const surveyActions = actions.filter(a => a.type === 'survey_poi');
  if (surveyActions.length > 0 && currentTick !== undefined) {
    const surveyResult = resolvePoiSurvey(updatedColonies, updatedUnits, hexes, actions, currentTick);
    events.push(...surveyResult.events);
    actionResults.push(...surveyResult.actionResults);
  }


  // --- Phase 2: Resolve research actions + advance research queues ---
  const researchResult = resolveResearch(updatedColonies, updatedSettlements, actions);
  events.push(...researchResult.events);
  actionResults.push(...researchResult.actionResults);

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
    for (const key of RESOURCE_KEYS) {
      if (colony.resources[key] == null || Number.isNaN(colony.resources[key] as number)) {
        colony.resources[key] = 0;
      }
    }

    const mySettlements = colonySettlements.get(colony.id) ?? [];
    const myUnits = colonyUnits.get(colony.id) ?? [];

    // --- Production ---
    const totalProduction = emptyResources();
    const totalUpkeep = emptyResources();

    for (const settlement of mySettlements) {
      // Get neighboring hexes for this settlement
      const neighbors = hexNeighbors({ q: settlement.hexX, r: settlement.hexY });
      const nearbyHexes: HexTileState[] = [
        hexMap.get(hexKey(settlement.hexX, settlement.hexY)),
        ...neighbors.map(n => hexMap.get(hexKey(n.q, n.r))),
      ].filter(Boolean) as HexTileState[];

      const production = calculateProduction(settlement, nearbyHexes);
      const upkeep = calculateBuildingUpkeep(settlement);

      for (const key of RESOURCE_KEYS) {
        totalProduction[key] += (production[key] as number) ?? 0;
        totalUpkeep[key] += (upkeep[key] as number) ?? 0;
      }

      // Population food consumption
      totalUpkeep.food += calculatePopulationConsumption(settlement);
    }

    // Unit food upkeep
    totalUpkeep.food += calculateUnitUpkeep(myUnits);

    // --- Apply research bonuses ---
    const researched: string[] = (colony as any).researchedTechs ?? [];

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
    const poiBonuses = emptyResources();
    const claimedPoiHexes = new Set<string>();

    for (const settlement of mySettlements) {
      const settlementCoord: HexCoord = { q: settlement.hexX, r: settlement.hexY };
      // Scan all hexes with POIs and check distance
      for (const [key, hex] of hexMap.entries()) {
        if (!hex.poi) continue;
        if (claimedPoiHexes.has(key)) continue; // Don't double-count
        if (hexDistance(settlementCoord, { q: hex.x, r: hex.y }) > POI_RESOURCE_RANGE) continue;

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

    for (const key of RESOURCE_KEYS) {
      totalProduction[key] += poiBonuses[key] ?? 0;
    }

    const foundryLevels = mySettlements.reduce((total, settlement) => (
      total + settlement.buildings
        .filter((building) => building.type === 'foundry')
        .reduce((buildingTotal, building) => buildingTotal + building.level, 0)
    ), 0);
    if (foundryLevels > 0) {
      const ironDemand = foundryLevels * FOUNDRY_IRON_CONVERSION_PER_LEVEL;
      const ironAvailable = Math.max(0, (colony.resources.iron ?? 0) + totalProduction.iron - totalUpkeep.iron);
      const ironSpent = Math.min(ironDemand, ironAvailable);
      const steelProduced = Math.round((ironSpent / FOUNDRY_IRON_CONVERSION_PER_LEVEL) * FOUNDRY_STEEL_OUTPUT_PER_LEVEL * 100) / 100;

      totalUpkeep.iron += ironSpent;
      totalProduction.steel = (totalProduction.steel ?? 0) + steelProduced;
    }

    // --- Apply net resources ---
    const net = emptyResources();
    for (const key of RESOURCE_KEYS) {
      net[key] = (totalProduction[key] ?? 0) - (totalUpkeep[key] ?? 0);
      colony.resources[key] = Math.round(((colony.resources[key] ?? 0) + net[key]) * 100) / 100;
    }

    // Clamp ALL resources to 0 (stockpiles cannot go negative)
    for (const key of RESOURCE_KEYS) {
      if ((colony.resources[key] ?? 0) < 0) {
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

    // --- Trade agreement transfers ---
    if (agreements && agreements.length > 0) {
      const tradeResult = resolveTradeTransfers(colonies, agreements, currentTick ?? 0);
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
        if (b.type === 'granary') totalGranaryLevels += b.level;
        if (b.type === 'warehouse') totalWarehouseLevels += b.level;
      }
    }
    const baseCap = STOCKPILE_CAP[highestTier] ?? 500;
    const effectiveCap = baseCap + totalGranaryLevels * GRANARY_BONUS_PER_LEVEL + totalWarehouseLevels * WAREHOUSE_BONUS_PER_LEVEL;

    for (const key of ['food', 'timber', 'stone', 'iron', 'steel'] as (keyof Resources)[]) {
      if ((colony.resources[key] ?? 0) > effectiveCap) {
        // Hard ceiling: immediately clamp to cap × STOCKPILE_HARD_CEILING
        const hardCeiling = Math.round(effectiveCap * STOCKPILE_HARD_CEILING);
        let clamped = 0;
        if ((colony.resources[key] ?? 0) > hardCeiling) {
          clamped = Math.round(((colony.resources[key] ?? 0) - hardCeiling) * 100) / 100;
          colony.resources[key] = hardCeiling;
        }
        // Then apply percentage decay on remaining excess
        const excess = (colony.resources[key] ?? 0) - effectiveCap;
        const decayed = Math.round(excess * STOCKPILE_DECAY_RATE * 100) / 100;
        colony.resources[key] = Math.round(((colony.resources[key] ?? 0) - decayed) * 100) / 100;
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

    // --- Captured settlement stabilization ---
    // Captured settlements start at 50 loyalty and recover over time while pacified.
    // A friendly garrison on the settlement hex speeds up the recovery.
    for (const settlement of mySettlements) {
      if (settlement.loyalty >= 100) continue;
      if (capturedSettlementIdsThisTick.has(settlement.id)) continue;
      if (combatHexesThisTick.has(hexKey(settlement.hexX, settlement.hexY))) continue;

      const hasEnemiesOnHex = updatedUnits.some(
        u => u.colonyId !== colony.id && u.hexX === settlement.hexX && u.hexY === settlement.hexY && u.health > 0,
      );
      if (hasEnemiesOnHex) continue;

      const hasFriendlyGarrison = myUnits.some(
        u => u.hexX === settlement.hexX && u.hexY === settlement.hexY && u.health > 0,
      );
      const loyaltyGain = SETTLEMENT_LOYALTY_RECOVERY + (hasFriendlyGarrison ? SETTLEMENT_GARRISON_LOYALTY_BONUS : 0);
      const previousLoyalty = settlement.loyalty;
      settlement.loyalty = Math.min(100, settlement.loyalty + loyaltyGain);

      if (settlement.loyalty > previousLoyalty) {
        events.push({
          type: 'settlement_loyalty_changed',
          colonyId: colony.id,
          settlementId: settlement.id,
          data: {
            loyaltyBefore: previousLoyalty,
            loyaltyAfter: settlement.loyalty,
            gain: settlement.loyalty - previousLoyalty,
            garrisoned: hasFriendlyGarrison,
          },
        });
      }
    }

    // --- Garrison healing: units at friendly settlements recover HP and morale (#165, #177) ---
    // Units on the same hex as a friendly settlement heal each tick unless that hex
    // was contested this tick. Barracks provide an additional healing bonus.
    const GARRISON_HEAL_MORALE = 0.08; // Base morale recovery per tick (buffed from 0.05 #171)
    for (const unit of myUnits) {
      if (unit.health >= 100 && unit.morale >= 1.0) continue; // Fully healthy
      // Check if unit is on a friendly settlement hex
      const garrisonSettlement = mySettlements.find(
        s => s.hexX === unit.hexX && s.hexY === unit.hexY
      );
      if (!garrisonSettlement) continue;

      // Check there are no enemies on this hex
      const unitHexKey = `${unit.hexX},${unit.hexY}`;
      const hasEnemiesOnHex = updatedUnits.some(
        u => u.colonyId !== colony.id && u.hexX === unit.hexX && u.hexY === unit.hexY && u.health > 0
      );
      if (hasEnemiesOnHex) continue;
      if (combatHexesThisTick.has(unitHexKey)) continue;

      // Calculate barracks bonus
      let barracksBonus = 0;
      for (const b of garrisonSettlement.buildings) {
        if (b.type === 'barracks') barracksBonus += BARRACKS_HEALING_BONUS * b.level;
      }

      const oldHealth = unit.health;
      const oldMorale = unit.morale;
      unit.health = Math.min(100, Math.round((unit.health + HEALING_PER_TICK + barracksBonus) * 100) / 100);
      unit.morale = Math.min(1.0, Math.round((unit.morale + GARRISON_HEAL_MORALE) * 1000) / 1000);

      if (unit.health > oldHealth || unit.morale > oldMorale) {
        events.push({
          type: 'garrison_heal',
          colonyId: colony.id,
          unitId: unit.id,
          data: {
            settlementId: garrisonSettlement.id,
            healthBefore: oldHealth,
            healthAfter: unit.health,
            moraleBefore: oldMorale,
            moraleAfter: unit.morale,
            barracksBonus,
          },
        });
      }
    }

        // Critically wounded units need to reach a friendly settlement to survive.
    for (const unit of myUnits) {
      if (criticalWoundUnitIds.includes(unit.id)) continue;
      if (!MILITARY_UNIT_TYPES.has(unit.type)) continue;
      if (unit.health > CRITICAL_WOUND_THRESHOLD) continue;

      const onFriendlySettlement = mySettlements.some(
        settlement => settlement.hexX === unit.hexX && settlement.hexY === unit.hexY,
      );
      if (onFriendlySettlement) continue;

      criticalWoundUnitIds.push(unit.id);
      unit.health = 0;
      events.push({
        type: 'unit_destroyed',
        colonyId: colony.id,
        unitId: unit.id,
        data: {
          unitType: unit.type,
          hexX: unit.hexX,
          hexY: unit.hexY,
          killedInCombat: false,
          damageReceived: 0,
          reason: `Critically wounded ${unit.type} perished without reaching a friendly settlement`,
        },
      });
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
        // Units near friendly settlements have reduced morale loss (garrison effect)
        const tickDesertions: Array<{ type: string; id: string; morale: number }> = [];
        const moraleWarnings: Array<{ type: string; id: string; morale: number }> = [];

        // Build settlement positions for garrison range check
        const colonySettlements = updatedSettlements.filter(s => s.colonyId === colony.id);

        for (const unit of updatedUnits.filter(u => u.colonyId === colony.id)) {
          // Check if unit is near a friendly settlement (garrison effect)
          const nearSettlement = colonySettlements.some(s =>
            hexDistance({ q: unit.hexX, r: unit.hexY }, { q: s.hexX, r: s.hexY }) <= GARRISON_MORALE_RANGE
          );

          // Apply morale loss with famine floor — units won't starve below MORALE_FAMINE_FLOOR
          // Garrisoned units lose morale at half rate
          // Military units in the field take reduced famine damage (hardened troops)
          const isMilitary = MILITARY_UNIT_TYPES.has(unit.type);
          const fieldResistance = (!nearSettlement && isMilitary) ? MILITARY_FAMINE_RESISTANCE : 1.0;
          const unitMoraleLoss = nearSettlement ? effectiveMoraleLoss * 0.5 : effectiveMoraleLoss * fieldResistance;
          unit.morale = Math.max(MORALE_FAMINE_FLOOR, unit.morale - unitMoraleLoss);

          // Probabilistic desertion: each unit at/below threshold has DESERTION_CHANCE to desert
          // Capped at MAX_DESERTIONS_PER_TICK per colony to prevent cascade wipes
          if (unit.morale <= DESERTION_THRESHOLD && tickDesertions.length < MAX_DESERTIONS_PER_TICK) {
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
              desertionCapped: tickDesertions.length >= MAX_DESERTIONS_PER_TICK,
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
    } else {
      // --- Garrison morale recovery (even during famine) ---
      // Units near friendly settlements get small morale boost — garrison cohesion
      // This addresses siege morale decay (#143) and gives units near home a fighting chance
      const colonySettlements = updatedSettlements.filter(s => s.colonyId === colony.id);
      for (const unit of updatedUnits.filter(u => u.colonyId === colony.id)) {
        const nearSettlement = colonySettlements.some(s =>
          hexDistance({ q: unit.hexX, r: unit.hexY }, { q: s.hexX, r: s.hexY }) <= GARRISON_MORALE_RANGE
        );
        if (nearSettlement && unit.morale < 1.0) {
          unit.morale = Math.min(1.0, unit.morale + GARRISON_MORALE_RECOVERY);
        } else if (!nearSettlement && MILITARY_UNIT_TYPES.has(unit.type) && unit.morale < 1.0) {
          // --- Field army cohesion (even during famine) ---
          // Military units in the field get small passive morale recovery from unit cohesion
          // and foraging. Not enough to prevent eventual decay, but slows the death spiral
          // so offensive campaigns are viable. (#152)
          unit.morale = Math.min(1.0, Math.round((unit.morale + FIELD_ARMY_MORALE_RECOVERY) * 100) / 100);
        }
      }
    }

    // --- Sacred Grove morale bonus ---
    // Units within 5 hexes of a sacred_grove get +0.01 morale/tick
    const SACRED_GROVE_RANGE = 5;
    const SACRED_GROVE_BONUS = 0.01;
    for (const unit of updatedUnits.filter(u => u.colonyId === colony.id)) {
      for (const hex of hexes) {
        if (!hex.poi || hex.poi.type !== 'sacred_grove') continue;
        if (hexDistance({ q: unit.hexX, r: unit.hexY }, { q: hex.x, r: hex.y }) <= SACRED_GROVE_RANGE) {
          unit.morale = Math.min(1.0, Math.round((unit.morale + SACRED_GROVE_BONUS) * 100) / 100);
          break; // One grove is enough
        }
      }
    }
  }

  // --- Passive morale recovery (#171) ---
  // All units recover a small amount of morale each tick — represents natural resilience
  // and rest. This prevents morale death spirals by giving losers a baseline recovery rate.
  // Stacks with garrison, sacred grove, and food-based recovery.
  const PASSIVE_MORALE_RECOVERY = 0.02;
  for (const unit of updatedUnits) {
    if (desertedUnitIds.includes(unit.id)) continue;
    if (unit.health <= 0) continue;
    if (unit.morale < 1.0) {
      unit.morale = Math.min(1.0, Math.round((unit.morale + PASSIVE_MORALE_RECOVERY) * 100) / 100);
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
    const foughtThisTick = combatParticipantIdsThisTick.has(unit.id);

    if (moved || hasQueue || hadAction || foughtThisTick) {
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
  const removedUnitIds = new Set([...desertedUnitIds, ...criticalWoundUnitIds]);
  const survivingUnits = updatedUnits.filter(u => !removedUnitIds.has(u.id));

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


  // --- Snapshot Score (recalculated every tick from current state) ---
  for (const colony of updatedColonies) {
    if (colony.status !== 'active') { continue; }
    let score = 0;

    // Settlements: tier-based
    const mySettlements = colonySettlements.get(colony.id) ?? [];
    for (const s of mySettlements) {
      score += SCORE_SETTLEMENT[s.tier] ?? 10;
      // Buildings: per level
      for (const b of (s.buildings ?? [])) {
        score += SCORE_BUILDING_LEVEL * (b.level || 1);
      }
      // Population: per 10
      score += Math.floor(s.population / 10) * SCORE_POP_PER_10;
    }

    // Army: per unit type
    const myUnits = colonyUnits.get(colony.id) ?? [];
    for (const u of myUnits) {
      score += SCORE_UNIT[u.type] ?? 2;
    }

    // Research: per completed tech
    const researched: string[] = (colony as any).researchedTechs ?? [];
    score += researched.length * SCORE_TECH;

    // Territory: per 10 explored hexes
    const exploredCount = hexes.filter(h => h.exploredBy?.includes(colony.id)).length;
    score += Math.floor(exploredCount / 10) * SCORE_EXPLORED_PER_10;

    colony.legacyScore = score;
  }


  // --- Colony Neglect & Death ---
  const deadColonyIds: string[] = [];
  if (currentTick) {
    for (const colony of updatedColonies) {
      if (colony.status !== 'active') continue;

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
      } else if (ticksSinceAction >= COLONY_NEGLECT_WARNING_TICKS) {
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
    disbandedUnitIds: tickDisbandedUnitIds,
    deadColonyIds,
    actionResults,
    fogReveals,
    newMessages,
    agreementMutations,
  };
}
