/**
 * Tick engine — resolves one game tick.
 *
 * Pure function: takes world state in, returns updated state + events out.
 * No database access — the scheduler handles persistence.
 */

import type { HexCoord } from './hex.js';
import { hexNeighbors, hexDistance } from './hex.js';
import type { HexResources } from './mapgen.js';

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
}

export type UnitType = 'scout' | 'militia' | 'soldier' | 'siege' | 'settler';

export interface HexTileState {
  x: number;
  y: number;
  terrain: string;
  resources: HexResources;
  settlementId: string | null;
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
 * 1. Calculate production for each settlement
 * 2. Calculate upkeep (buildings + units)
 * 3. Apply net resources to each colony
 * 4. Handle deficits: morale loss → desertion
 * 5. Handle surplus: morale recovery
 */
export function resolveTick(
  colonies: Colony[],
  settlements: Settlement[],
  units: Unit[],
  hexes: HexTileState[],
): TickResult {
  const events: TickEvent[] = [];
  const desertedUnitIds: string[] = [];

  // Build hex lookup
  const hexMap = new Map<string, HexTileState>();
  for (const hex of hexes) {
    hexMap.set(hexKey(hex.x, hex.y), hex);
  }

  // Group settlements and units by colony
  const colonySettlements = new Map<string, Settlement[]>();
  const colonyUnits = new Map<string, Unit[]>();

  for (const s of settlements) {
    const list = colonySettlements.get(s.colonyId) ?? [];
    list.push(s);
    colonySettlements.set(s.colonyId, list);
  }
  for (const u of units) {
    const list = colonyUnits.get(u.colonyId) ?? [];
    list.push(u);
    colonyUnits.set(u.colonyId, list);
  }

  // Deep clone colonies so we can mutate
  const updatedColonies = colonies.map(c => ({
    ...c,
    resources: { ...c.resources },
  }));

  const updatedUnits = units.map(u => ({ ...u }));
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
  };
}
