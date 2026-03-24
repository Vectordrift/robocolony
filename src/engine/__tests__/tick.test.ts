import { describe, it, expect } from 'vitest';
import {
  resolveTick,
  calculateProduction,
  calculateBuildingUpkeep,
  calculateUnitUpkeep,
  TIER_MULTIPLIER,
  BUILDING_PRODUCTION,
  UNIT_UPKEEP,
  MORALE_LOSS_RATE,
  MORALE_RECOVERY_RATE,
  DESERTION_THRESHOLD,
  type Colony,
  type Settlement,
  type Unit,
  type HexTileState,
  type Resources,
} from '../tick.js';

// --- Factories ---

function makeColony(overrides: Partial<Colony> = {}): Colony {
  return {
    id: 'colony-1',
    worldId: 'world-1',
    name: 'Test Colony',
    resources: { food: 100, timber: 50, stone: 30, iron: 10, influence: 50 },
    status: 'active',
    ...overrides,
  };
}

function makeSettlement(overrides: Partial<Settlement> = {}): Settlement {
  return {
    id: 'settlement-1',
    colonyId: 'colony-1',
    worldId: 'world-1',
    name: 'Outpost Alpha',
    hexX: 0,
    hexY: 0,
    tier: 'outpost',
    buildings: [],
    loyalty: 100,
    population: 10,
    ...overrides,
  };
}

function makeUnit(overrides: Partial<Unit> = {}): Unit {
  return {
    id: 'unit-1',
    colonyId: 'colony-1',
    worldId: 'world-1',
    type: 'scout',
    hexX: 0,
    hexY: 0,
    health: 100,
    morale: 1.0,
    ...overrides,
  };
}

function makeHex(x: number, y: number, overrides: Partial<HexTileState> = {}): HexTileState {
  return {
    x,
    y,
    terrain: 'plains',
    resources: { food: 3, timber: 1, stone: 0, iron: 0 },
    settlementId: null,
    ...overrides,
  };
}

function makeHexRing(centerX: number, centerY: number): HexTileState[] {
  // Center + 6 neighbors (axial coords)
  const directions = [
    [1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1],
  ];
  return [
    makeHex(centerX, centerY),
    ...directions.map(([dq, dr]) => makeHex(centerX + dq, centerY + dr)),
  ];
}

// --- calculateProduction ---

describe('calculateProduction', () => {
  it('returns base population food with no buildings', () => {
    const settlement = makeSettlement({ population: 10 });
    const hexes = makeHexRing(0, 0);
    const production = calculateProduction(settlement, hexes);

    // 10 * 0.1 = 1.0 from population
    // 7 hexes * 3 food * 0.5 = 10.5 from hex yields
    expect(production.food).toBeCloseTo(11.5);
  });

  it('calculates building production scaled by tier', () => {
    const settlement = makeSettlement({
      tier: 'city',
      buildings: [{ type: 'farm', level: 2 }],
      population: 0,
    });
    const production = calculateProduction(settlement, []);

    // farm: 3 * 2 (level) * 2.0 (city) = 12
    expect(production.food).toBeCloseTo(12);
  });

  it('sums production from multiple buildings', () => {
    const settlement = makeSettlement({
      tier: 'outpost',
      buildings: [
        { type: 'farm', level: 1 },
        { type: 'lumberMill', level: 1 },
        { type: 'mine', level: 1 },
      ],
      population: 0,
    });
    const production = calculateProduction(settlement, []);

    expect(production.food).toBeCloseTo(3);   // farm: 3
    expect(production.timber).toBeCloseTo(3); // lumberMill: 3
    expect(production.iron).toBeCloseTo(2);   // mine: 2
  });

  it('includes nearby hex resource yields at 50%', () => {
    const settlement = makeSettlement({ population: 0 });
    const hexes = [
      makeHex(0, 0, { resources: { food: 0, timber: 0, stone: 0, iron: 0 } }),
      makeHex(1, 0, { resources: { food: 0, timber: 6, stone: 0, iron: 0 } }),
    ];
    const production = calculateProduction(settlement, hexes);

    expect(production.timber).toBeCloseTo(3); // 6 * 0.5
  });
});

// --- calculateBuildingUpkeep ---

describe('calculateBuildingUpkeep', () => {
  it('returns zero for buildings with no upkeep', () => {
    const settlement = makeSettlement({
      buildings: [{ type: 'farm', level: 3 }],
    });
    const upkeep = calculateBuildingUpkeep(settlement);
    expect(upkeep.food).toBe(0);
    expect(upkeep.timber).toBe(0);
  });

  it('calculates upkeep scaled by level', () => {
    const settlement = makeSettlement({
      buildings: [{ type: 'mine', level: 2 }],
    });
    const upkeep = calculateBuildingUpkeep(settlement);

    // mine: timber 1*2, food 1*2
    expect(upkeep.timber).toBe(2);
    expect(upkeep.food).toBe(2);
  });

  it('sums upkeep from multiple buildings', () => {
    const settlement = makeSettlement({
      buildings: [
        { type: 'mine', level: 1 },     // timber 1, food 1
        { type: 'barracks', level: 1 },  // food 2, iron 1
      ],
    });
    const upkeep = calculateBuildingUpkeep(settlement);

    expect(upkeep.food).toBe(3);    // 1 + 2
    expect(upkeep.timber).toBe(1);  // 1
    expect(upkeep.iron).toBe(1);    // 1
  });
});

// --- calculateUnitUpkeep ---

describe('calculateUnitUpkeep', () => {
  it('returns 0 for no units', () => {
    expect(calculateUnitUpkeep([])).toBe(0);
  });

  it('sums food upkeep for all units', () => {
    const units = [
      makeUnit({ type: 'scout' }),    // 1
      makeUnit({ type: 'soldier' }),   // 2
      makeUnit({ type: 'siege' }),     // 3
    ];
    expect(calculateUnitUpkeep(units)).toBe(6);
  });
});

// --- resolveTick ---

describe('resolveTick', () => {
  it('produces resources and adds them to colony', () => {
    const colony = makeColony({ resources: { food: 100, timber: 50, stone: 30, iron: 10, influence: 50 } });
    const settlement = makeSettlement({
      buildings: [{ type: 'farm', level: 1 }],
      population: 10,
    });
    const hexes = makeHexRing(0, 0);
    const result = resolveTick([colony], [settlement], [], hexes);

    // Food: 3 (farm) + 1.0 (pop) + 10.5 (hexes) = 14.5 produced, 0 upkeep
    expect(result.colonies[0].resources.food).toBeGreaterThan(100);
    expect(result.events.some(e => e.type === 'production')).toBe(true);
  });

  it('deducts unit upkeep from food', () => {
    const colony = makeColony({ resources: { food: 10, timber: 50, stone: 30, iron: 10, influence: 50 } });
    const settlement = makeSettlement({ population: 0 });
    const units = [
      makeUnit({ type: 'soldier' }), // 2 food
      makeUnit({ type: 'soldier', id: 'unit-2' }), // 2 food
    ];
    // No hexes around settlement = no hex yield
    const result = resolveTick([colony], [settlement], units, []);

    // Net food = 0 production - 4 upkeep = -4. Starting 10 + (-4) = 6
    expect(result.colonies[0].resources.food).toBeLessThan(10);
  });

  it('triggers famine and morale loss when food goes negative', () => {
    const colony = makeColony({ resources: { food: 0, timber: 50, stone: 30, iron: 10, influence: 50 } });
    const settlement = makeSettlement({ population: 0 });
    const units = [
      makeUnit({ type: 'siege' }), // 3 food upkeep
    ];
    const result = resolveTick([colony], [settlement], units, []);

    // Famine event
    expect(result.events.some(e => e.type === 'famine')).toBe(true);

    // Morale reduced
    expect(result.units[0].morale).toBeCloseTo(1.0 - MORALE_LOSS_RATE);

    // Food clamped to 0
    expect(result.colonies[0].resources.food).toBe(0);
  });

  it('deserts units when morale drops below threshold', () => {
    const colony = makeColony({ resources: { food: 0, timber: 50, stone: 30, iron: 10, influence: 50 } });
    const settlement = makeSettlement({ population: 0 });
    const units = [
      makeUnit({ type: 'siege', morale: DESERTION_THRESHOLD + 0.01 }), // barely above, will drop below
    ];
    const result = resolveTick([colony], [settlement], units, []);

    expect(result.desertedUnitIds).toContain('unit-1');
    expect(result.units.find(u => u.id === 'unit-1')).toBeUndefined();
    expect(result.events.some(e => e.type === 'desertion')).toBe(true);
  });

  it('recovers morale when food is positive', () => {
    const colony = makeColony({ resources: { food: 100, timber: 50, stone: 30, iron: 10, influence: 50 } });
    const settlement = makeSettlement({
      buildings: [{ type: 'farm', level: 3 }],
      population: 10,
    });
    const units = [
      makeUnit({ morale: 0.5 }),
    ];
    const hexes = makeHexRing(0, 0);
    const result = resolveTick([colony], [settlement], units, hexes);

    expect(result.units[0].morale).toBeCloseTo(0.5 + MORALE_RECOVERY_RATE);
  });

  it('does not process eliminated colonies', () => {
    const colony = makeColony({ status: 'eliminated', resources: { food: 0, timber: 0, stone: 0, iron: 0, influence: 0 } });
    const result = resolveTick([colony], [], [], []);

    // No production events for eliminated colony
    expect(result.events.filter(e => e.colonyId === colony.id)).toHaveLength(0);
  });

  it('handles multiple colonies independently', () => {
    const colony1 = makeColony({ id: 'c1', resources: { food: 100, timber: 50, stone: 30, iron: 10, influence: 50 } });
    const colony2 = makeColony({ id: 'c2', resources: { food: 5, timber: 50, stone: 30, iron: 10, influence: 50 } });

    const s1 = makeSettlement({ id: 's1', colonyId: 'c1', buildings: [{ type: 'farm', level: 2 }], population: 10 });
    const s2 = makeSettlement({ id: 's2', colonyId: 'c2', hexX: 5, hexY: 5, population: 0 });

    const u2 = makeUnit({ id: 'u2', colonyId: 'c2', type: 'siege' }); // 3 food

    const hexes = makeHexRing(0, 0);
    const result = resolveTick([colony1, colony2], [s1, s2], [u2], hexes);

    // Colony 1 should gain food (farm + hexes)
    expect(result.colonies.find(c => c.id === 'c1')!.resources.food).toBeGreaterThan(100);

    // Colony 2 should be in famine (no production, 3 food upkeep, started at 5)
    // Actually 5 - 3 = 2, not negative. Let's check.
    const c2Resources = result.colonies.find(c => c.id === 'c2')!.resources.food;
    expect(c2Resources).toBeLessThan(5);
  });

  it('caps morale recovery at 1.0', () => {
    const colony = makeColony();
    const settlement = makeSettlement({ buildings: [{ type: 'farm', level: 3 }], population: 20 });
    const units = [makeUnit({ morale: 0.99 })];
    const hexes = makeHexRing(0, 0);
    const result = resolveTick([colony], [settlement], units, hexes);

    expect(result.units[0].morale).toBe(1.0);
  });

  it('returns immutable results (does not mutate inputs)', () => {
    const colony = makeColony();
    const originalFood = colony.resources.food;
    const settlement = makeSettlement({ buildings: [{ type: 'farm', level: 1 }], population: 10 });
    const hexes = makeHexRing(0, 0);

    resolveTick([colony], [settlement], [], hexes);

    // Original colony should not be mutated
    expect(colony.resources.food).toBe(originalFood);
  });
});
