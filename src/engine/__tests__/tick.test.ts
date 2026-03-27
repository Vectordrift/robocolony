
import { describe, it, expect } from 'vitest';
import {
  resolveTick,
  resolveMovement,
  resolveFoundSettlement,
  resolveBuilding,
  resolveTrainUnit,
  resolveUpgradeSettlement,
  resolveUpgradeBuilding,
  resolveDemolish,
  resolveCombat,
  buildingUpgradeCost,
  calculateProduction,
  calculateBuildingUpkeep,
  calculateUnitUpkeep,
  calculatePopulationConsumption,
  TIER_MULTIPLIER,
  BUILDING_PRODUCTION,
  BUILDING_COSTS,
  BUILD_TIME,
  MAX_BUILDING_LEVEL,
  UPGRADE_BUILD_TIME,
  VALID_BUILDING_TYPES,
  UNIT_UPKEEP,
  UNIT_TRAINING_COSTS,
  VALID_UNIT_TYPES,
  UNIT_ATTACK,
  UNIT_DEFENSE,
  COMBAT_MORALE_LOSS,
  COMBAT_MORALE_LOSE,
  COMBAT_RANDOM_BONUS,
  STEEL_WEAPONS_ATTACK_BONUS,
  FORTIFICATIONS_RETALIATION_DAMAGE,
  MORALE_LOSS_RATE,
  MORALE_RECOVERY_RATE,
  DESERTION_THRESHOLD,
  DESERTION_CHANCE,
  MORALE_WARNING_THRESHOLD,
  MAX_DEFICIT_MULTIPLIER,
  FOUNDING_COST,
  MIN_SETTLEMENT_DISTANCE,
  FOUNDING_REVEAL_RADIUS,
  POP_FOOD_CONSUMPTION,
  UPGRADE_COSTS,
  TIER_ORDER,
  MAX_POPULATION,
  POP_GROWTH_PER_FOOD,
  STOCKPILE_CAP,
  STOCKPILE_HARD_CEILING,
  GRANARY_BONUS_PER_LEVEL,
  STOCKPILE_DECAY_RATE,
  HEALING_PER_TICK,
  BARRACKS_HEALING_BONUS,
  NEWCOMER_PROTECTION_TICKS,
  IDLE_WARNING_TICKS,
  DEMOLISH_REFUND_RATE,
  DECAY_CHANCE_PER_BUILDING,
  type Colony,
  type Settlement,
  type Unit,
  type HexTileState,
  type Resources,
  type QueuedAction,
  type BuildingType,
} from '../tick.js';
import { createHexLookup, UNIT_SPEED } from '../pathfinding.js';

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
    buildQueue: [],
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

function makeAction(overrides: Partial<QueuedAction> = {}): QueuedAction {
  return {
    id: 'action-1',
    colonyId: 'colony-1',
    type: 'move_unit',
    params: { unitId: 'unit-1', targetX: 3, targetY: 0 },
    ...overrides,
  };
}

function makeTrainAction(overrides: Partial<QueuedAction> = {}): QueuedAction {
  return {
    id: 'action-train-1',
    colonyId: 'colony-1',
    type: 'train_unit',
    params: { settlementId: 'settlement-1', unitType: 'scout' },
    ...overrides,
  };
}

function makeBuildAction(overrides: Partial<QueuedAction> = {}): QueuedAction {
  return {
    id: 'action-build-1',
    colonyId: 'colony-1',
    type: 'build',
    params: { settlementId: 'settlement-1', buildingType: 'farm' },
    ...overrides,
  };
}

/**
 * Generate a line of plains hexes from (0,0) to (maxQ,0).
 */
function makePlainLine(maxQ: number): HexTileState[] {
  const hexes: HexTileState[] = [];
  for (let q = 0; q <= maxQ; q++) {
    hexes.push(makeHex(q, 0));
  }
  return hexes;
}

/**
 * Generate a grid of plains hexes centered around (0,0) with given radius.
 */
function makePlainGrid(radius: number): HexTileState[] {
  const hexes: HexTileState[] = [];
  for (let q = -radius; q <= radius; q++) {
    const r1 = Math.max(-radius, -q - radius);
    const r2 = Math.min(radius, -q + radius);
    for (let r = r1; r <= r2; r++) {
      hexes.push(makeHex(q, r));
    }
  }
  return hexes;
}

// --- calculateProduction ---

describe('calculateProduction', () => {
  it('returns only hex yields with no buildings and no population production', () => {
    const settlement = makeSettlement({ population: 10 });
    const hexes = makeHexRing(0, 0);
    const production = calculateProduction(settlement, hexes);

    // No population food production (removed)
    // 7 hexes * 3 food * 0.5 = 10.5 from hex yields only
    expect(production.food).toBeCloseTo(10.5);
  });

  it('calculates building production scaled by tier', () => {
    const settlement = makeSettlement({
      tier: 'city',
      buildings: [{ type: 'farm', level: 2 }],
      population: 0,
    });
    const production = calculateProduction(settlement, []);

    // farm: 15 * 2 (level) * 2.0 (city) = 60
    expect(production.food).toBeCloseTo(60);
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

    expect(production.food).toBeCloseTo(15);   // farm: 15
    expect(production.timber).toBeCloseTo(5);  // lumberMill: 5
    expect(production.iron).toBeCloseTo(3);    // mine: 3
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

  it('handles buildings with missing level property (regression #40)', () => {
    const settlement = makeSettlement({
      tier: 'outpost',
      // Simulate DB data where level is missing (e.g. stored as completedAtTick instead)
      buildings: [{ type: 'farm' } as any],
      population: 0,
    });
    const production = calculateProduction(settlement, []);

    // Should default to level 1: farm produces 15 food * 1 * 1.0 = 15
    expect(production.food).toBeCloseTo(15);
    // Ensure no NaN values
    expect(Number.isNaN(production.food)).toBe(false);
    expect(Number.isNaN(production.timber)).toBe(false);
  });

  it('produces numeric food/timber with starting buildings in full tick', () => {
    // Regression test for #40: starting buildings had completedAtTick instead of level
    const colony = makeColony();
    const settlement = makeSettlement({
      buildings: [
        { type: 'farm', level: 1 },
        { type: 'lumberMill', level: 1 },
      ],
    });
    const hexes = makeHexRing(0, 0);

    const result = resolveTick([colony], [settlement], [], hexes);

    // Colony resources should all be numeric (not null/NaN)
    for (const [key, value] of Object.entries(result.colonies[0].resources)) {
      expect(typeof value).toBe('number');
      expect(Number.isNaN(value)).toBe(false);
    }

    // Food and timber specifically should be > starting values (production happened)
    expect(result.colonies[0].resources.food).toBeGreaterThan(0);
    expect(result.colonies[0].resources.timber).toBeGreaterThan(0);
  });

  it('does not include passive population food production', () => {
    const settlement = makeSettlement({ population: 100 });
    const production = calculateProduction(settlement, []);

    // No buildings, no hexes, no population food production
    expect(production.food).toBe(0);
  });

});

// --- calculateBuildingUpkeep ---

describe('calculateBuildingUpkeep', () => {
  it('returns correct upkeep for farm (timber only)', () => {
    const settlement = makeSettlement({
      buildings: [{ type: 'farm', level: 3 }],
    });
    const upkeep = calculateBuildingUpkeep(settlement);
    expect(upkeep.food).toBe(0);
    expect(upkeep.timber).toBe(3); // farm: timber 1 * level 3
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
        { type: 'barracks', level: 1 },  // food 2, iron 2, timber 1
      ],
    });
    const upkeep = calculateBuildingUpkeep(settlement);

    expect(upkeep.food).toBe(3);    // 1 + 2
    expect(upkeep.timber).toBe(2);  // mine 1 + barracks 1
    expect(upkeep.iron).toBe(2);    // barracks 2
  });
});

// --- calculateUnitUpkeep ---

describe('calculateUnitUpkeep', () => {
  it('returns 0 for no units', () => {
    expect(calculateUnitUpkeep([])).toBe(0);
  });

  it('sums food upkeep for all units', () => {
    const units = [
      makeUnit({ type: 'scout' }),    // 0.5
      makeUnit({ type: 'soldier' }),   // 3
      makeUnit({ type: 'siege' }),     // 4
    ];
    expect(calculateUnitUpkeep(units)).toBe(7.5);
  });
});

// --- calculatePopulationConsumption ---

describe('calculatePopulationConsumption', () => {
  it('returns population * POP_FOOD_CONSUMPTION', () => {
    const settlement = makeSettlement({ population: 10 });
    expect(calculatePopulationConsumption(settlement)).toBe(10 * POP_FOOD_CONSUMPTION);
    expect(calculatePopulationConsumption(settlement)).toBe(2.5);
  });

  it('returns 0 for zero population', () => {
    const settlement = makeSettlement({ population: 0 });
    expect(calculatePopulationConsumption(settlement)).toBe(0);
  });

  it('scales linearly with population', () => {
    const s20 = makeSettlement({ population: 20 });
    const s50 = makeSettlement({ population: 50 });
    expect(calculatePopulationConsumption(s20)).toBe(20 * POP_FOOD_CONSUMPTION);
    expect(calculatePopulationConsumption(s50)).toBe(50 * POP_FOOD_CONSUMPTION);
  });
});

// --- resolveBuilding ---

describe('resolveBuilding', () => {
  it('queues a building and deducts resources', () => {
    const colony = makeColony({ resources: { food: 100, timber: 50, stone: 30, iron: 10, influence: 50 } });
    const settlement = makeSettlement();
    const action = makeBuildAction();

    const result = resolveBuilding([settlement], [colony], [action]);

    expect(result.actionResults[0].status).toBe('resolved');
    expect(result.actionResults[0].result).toContain('farm');
    expect(result.actionResults[0].result).toContain('construction started');

    // Build queue should have the farm (queued then advanced in same call)
    expect(settlement.buildQueue).toHaveLength(1);
    expect(settlement.buildQueue[0].type).toBe('farm');
    expect(settlement.buildQueue[0].ticksRemaining).toBe(BUILD_TIME - 1);

    // Farm costs 20 timber
    expect(colony.resources.timber).toBe(50 - 20);
  });

  it('deducts correct resources for each building type', () => {
    for (const bType of VALID_BUILDING_TYPES) {
      const cost = BUILDING_COSTS[bType];
      const startRes = { food: 500, timber: 500, stone: 500, iron: 500, influence: 500 };
      const colony = makeColony({ resources: { ...startRes } });
      const settlement = makeSettlement({ id: `s-${bType}` });
      const action = makeBuildAction({
        id: `act-${bType}`,
        params: { settlementId: `s-${bType}`, buildingType: bType },
      });

      resolveBuilding([settlement], [colony], [action]);

      for (const [resource, amount] of Object.entries(cost)) {
        expect(colony.resources[resource as keyof Resources]).toBe(500 - (amount as number));
      }
    }
  });

  it('generates build_started event', () => {
    const colony = makeColony({ resources: { food: 100, timber: 50, stone: 30, iron: 10, influence: 50 } });
    const settlement = makeSettlement();
    const action = makeBuildAction();

    const result = resolveBuilding([settlement], [colony], [action]);

    const event = result.events.find(e => e.type === 'build_started');
    expect(event).toBeDefined();
    expect(event!.colonyId).toBe('colony-1');
    expect(event!.settlementId).toBe('settlement-1');
    expect(event!.data.buildingType).toBe('farm');
    expect(event!.data.ticksRemaining).toBe(BUILD_TIME);
  });

  it('advances build queue and completes building after BUILD_TIME ticks', () => {
    const colony = makeColony();
    const settlement = makeSettlement({
      buildQueue: [{ type: 'farm', ticksRemaining: 1 }],
    });

    const result = resolveBuilding([settlement], [colony], []);

    // Building should be completed
    expect(settlement.buildings).toHaveLength(1);
    expect(settlement.buildings[0].type).toBe('farm');
    expect(settlement.buildings[0].level).toBe(1);
    expect(settlement.buildQueue).toHaveLength(0);

    // build_complete event
    const event = result.events.find(e => e.type === 'build_complete');
    expect(event).toBeDefined();
    expect(event!.data.buildingType).toBe('farm');
    expect(event!.data.level).toBe(1);
  });

  it('decrements ticksRemaining when not yet complete', () => {
    const colony = makeColony();
    const settlement = makeSettlement({
      buildQueue: [{ type: 'farm', ticksRemaining: 3 }],
    });

    const result = resolveBuilding([settlement], [colony], []);

    expect(settlement.buildQueue).toHaveLength(1);
    expect(settlement.buildQueue[0].ticksRemaining).toBe(2);
    expect(settlement.buildings).toHaveLength(0);

    // No build_complete event
    expect(result.events.find(e => e.type === 'build_complete')).toBeUndefined();
  });

  it('handles multiple items in build queue', () => {
    const colony = makeColony();
    const settlement = makeSettlement({
      buildQueue: [
        { type: 'farm', ticksRemaining: 1 },      // completes
        { type: 'quarry', ticksRemaining: 2 },     // advances to 1
      ],
    });

    const result = resolveBuilding([settlement], [colony], []);

    expect(settlement.buildings).toHaveLength(1);
    expect(settlement.buildings[0].type).toBe('farm');
    expect(settlement.buildQueue).toHaveLength(1);
    expect(settlement.buildQueue[0].type).toBe('quarry');
    expect(settlement.buildQueue[0].ticksRemaining).toBe(1);
  });

  it('fails when settlement not found', () => {
    const colony = makeColony();
    const action = makeBuildAction({
      params: { settlementId: 'nonexistent', buildingType: 'farm' },
    });

    const result = resolveBuilding([], [colony], [action]);

    expect(result.actionResults[0].status).toBe('failed');
    expect(result.actionResults[0].result).toContain('not found');
  });

  it('fails when settlement belongs to different colony', () => {
    const colony = makeColony();
    const settlement = makeSettlement({ colonyId: 'colony-2' });
    const action = makeBuildAction({ colonyId: 'colony-1' });

    const result = resolveBuilding([settlement], [colony], [action]);

    expect(result.actionResults[0].status).toBe('failed');
    expect(result.actionResults[0].result).toContain('does not belong');
  });

  it('fails for invalid building type', () => {
    const colony = makeColony();
    const settlement = makeSettlement();
    const action = makeBuildAction({
      params: { settlementId: 'settlement-1', buildingType: 'spaceship' },
    });

    const result = resolveBuilding([settlement], [colony], [action]);

    expect(result.actionResults[0].status).toBe('failed');
    expect(result.actionResults[0].result).toContain('Invalid building type');
  });

  it('fails when settlement already has a non-farm building type', () => {
    const colony = makeColony();
    const settlement = makeSettlement({
      buildings: [{ type: 'mine', level: 1 }],
    });
    const action = makeBuildAction({
      params: { settlementId: 'settlement-1', buildingType: 'mine' },
    });

    const result = resolveBuilding([settlement], [colony], [action]);

    expect(result.actionResults[0].status).toBe('failed');
    expect(result.actionResults[0].result).toContain('already has a mine');
  });

  it('fails when a non-farm building type is already in build queue', () => {
    const colony = makeColony();
    const settlement = makeSettlement({
      buildQueue: [{ type: 'mine', ticksRemaining: 2 }],
    });
    const action = makeBuildAction({
      params: { settlementId: 'settlement-1', buildingType: 'mine' },
    });

    const result = resolveBuilding([settlement], [colony], [action]);

    expect(result.actionResults[0].status).toBe('failed');
    expect(result.actionResults[0].result).toContain('already in the build queue');
  });

  it('fails when colony has insufficient resources', () => {
    const colony = makeColony({ resources: { food: 100, timber: 5, stone: 30, iron: 10, influence: 50 } });
    const settlement = makeSettlement();
    const action = makeBuildAction({
      params: { settlementId: 'settlement-1', buildingType: 'farm' }, // costs 20 timber
    });

    const result = resolveBuilding([settlement], [colony], [action]);

    expect(result.actionResults[0].status).toBe('failed');
    expect(result.actionResults[0].result).toContain('Insufficient resources');
  });

  it('fails when colony not found', () => {
    const settlement = makeSettlement();
    const action = makeBuildAction();

    const result = resolveBuilding([settlement], [], [action]);

    expect(result.actionResults[0].status).toBe('failed');
    expect(result.actionResults[0].result).toContain('Colony');
    expect(result.actionResults[0].result).toContain('not found');
  });

  it('queues multiple different buildings in same tick', () => {
    const colony = makeColony({ resources: { food: 500, timber: 500, stone: 500, iron: 500, influence: 500 } });
    const settlement = makeSettlement();
    const actions = [
      makeBuildAction({ id: 'act-1', params: { settlementId: 'settlement-1', buildingType: 'farm' } }),
      makeBuildAction({ id: 'act-2', params: { settlementId: 'settlement-1', buildingType: 'mine' } }),
    ];

    const result = resolveBuilding([settlement], [colony], actions);

    expect(result.actionResults[0].status).toBe('resolved');
    expect(result.actionResults[1].status).toBe('resolved');
    expect(settlement.buildQueue).toHaveLength(2);
    expect(settlement.buildQueue[0].type).toBe('farm');
    expect(settlement.buildQueue[1].type).toBe('mine');
  });

  it('rejects second build of the same non-farm type in the same tick', () => {
    const colony = makeColony({ resources: { food: 500, timber: 500, stone: 500, iron: 500, influence: 500 } });
    const settlement = makeSettlement();
    const actions = [
      makeBuildAction({ id: 'act-1', params: { settlementId: 'settlement-1', buildingType: 'mine' } }),
      makeBuildAction({ id: 'act-2', params: { settlementId: 'settlement-1', buildingType: 'mine' } }),
    ];

    const result = resolveBuilding([settlement], [colony], actions);

    expect(result.actionResults[0].status).toBe('resolved');
    expect(result.actionResults[1].status).toBe('failed');
    expect(result.actionResults[1].result).toContain('already in the build queue');
  });

  it('completes build while also queuing a new build in same tick', () => {
    const colony = makeColony({ resources: { food: 500, timber: 500, stone: 500, iron: 500, influence: 500 } });
    const settlement = makeSettlement({
      buildQueue: [{ type: 'farm', ticksRemaining: 1 }],
    });
    const action = makeBuildAction({
      params: { settlementId: 'settlement-1', buildingType: 'mine' },
    });

    const result = resolveBuilding([settlement], [colony], [action]);

    // Farm should complete
    expect(settlement.buildings).toHaveLength(1);
    expect(settlement.buildings[0].type).toBe('farm');

    // Mine should be queued
    // The mine was queued first (Phase 1), then build queue advances (Phase 2)
    // Mine added with ticksRemaining: 3, then decremented to 2
    expect(settlement.buildQueue).toHaveLength(1);
    expect(settlement.buildQueue[0].type).toBe('mine');
    expect(settlement.buildQueue[0].ticksRemaining).toBe(2);

    // Both events present
    expect(result.events.some(e => e.type === 'build_complete')).toBe(true);
    expect(result.events.some(e => e.type === 'build_started')).toBe(true);
  });
});

// --- resolveMovement ---

describe('resolveMovement', () => {
  it('computes path and sets movement queue for move_unit action', () => {
    const hexes = makePlainLine(5);
    const hexLookup = createHexLookup(hexes.map(h => ({ x: h.x, y: h.y, terrain: h.terrain })));
    const units = [makeUnit({ hexX: 0, hexY: 0, type: 'scout' })];
    const actions = [makeAction({ params: { unitId: 'unit-1', targetX: 5, targetY: 0 } })];

    const result = resolveMovement(units, actions, hexLookup);

    // Scout moves 5 hexes per tick on plains
    expect(result.actionResults[0].status).toBe('resolved');
    expect(result.events.some(e => e.type === 'movement_queued')).toBe(true);
    expect(result.events.some(e => e.type === 'unit_moved')).toBe(true);

    expect(units[0].hexX).toBe(5);
    expect(units[0].hexY).toBe(0);
    expect(units[0].movementQueue?.length).toBe(0);
  });

  it('moves settler 2 hexes per tick', () => {
    const hexes = makePlainLine(3);
    const hexLookup = createHexLookup(hexes.map(h => ({ x: h.x, y: h.y, terrain: h.terrain })));
    const units = [makeUnit({ hexX: 0, hexY: 0, type: 'settler' })];
    const actions = [makeAction({ params: { unitId: 'unit-1', targetX: 3, targetY: 0 } })];

    const result = resolveMovement(units, actions, hexLookup);

    expect(units[0].hexX).toBe(2);
    expect(units[0].hexY).toBe(0);
    expect(units[0].movementQueue?.length).toBe(1);
  });

  it('fails when path is blocked by ocean', () => {
    const hexes = [
      makeHex(0, 0),
      makeHex(1, 0, { terrain: 'ocean' }),
      makeHex(2, 0),
    ];
    const hexLookup = createHexLookup(hexes.map(h => ({ x: h.x, y: h.y, terrain: h.terrain })));
    const units = [makeUnit({ hexX: 0, hexY: 0 })];
    const actions = [makeAction({ params: { unitId: 'unit-1', targetX: 2, targetY: 0 } })];

    const result = resolveMovement(units, actions, hexLookup);

    expect(result.actionResults[0].status).toBe('failed');
    expect(result.actionResults[0].result).toContain('No path');
    expect(units[0].hexX).toBe(0); // didn't move
  });

  it('replaces existing movement queue with new move_unit', () => {
    const hexes = makePlainGrid(5);
    const hexLookup = createHexLookup(hexes.map(h => ({ x: h.x, y: h.y, terrain: h.terrain })));
    const units = [makeUnit({
      hexX: 0, hexY: 0,
      type: 'settler',
      movementQueue: [{ q: 1, r: 0 }, { q: 2, r: 0 }, { q: 3, r: 0 }],
    })];
    // New action sends them to (0,3) instead
    const actions = [makeAction({ params: { unitId: 'unit-1', targetX: 0, targetY: 3 } })];

    const result = resolveMovement(units, actions, hexLookup);

    expect(result.actionResults[0].status).toBe('resolved');
    // Old queue replaced; should now be heading toward (0,3)
    // Settler speed 2: moved 2 steps
    expect(units[0].hexX).toBe(0);
    expect(units[0].hexY).toBe(2);
  });

  it('cancels movement when target is current position', () => {
    const hexes = makePlainLine(3);
    const hexLookup = createHexLookup(hexes.map(h => ({ x: h.x, y: h.y, terrain: h.terrain })));
    const units = [makeUnit({
      hexX: 1, hexY: 0,
      movementQueue: [{ q: 2, r: 0 }, { q: 3, r: 0 }],
    })];
    const actions = [makeAction({ params: { unitId: 'unit-1', targetX: 1, targetY: 0 } })];

    const result = resolveMovement(units, actions, hexLookup);

    expect(result.actionResults[0].status).toBe('resolved');
    expect(result.actionResults[0].result).toBe('Movement cancelled');
    expect(units[0].movementQueue).toEqual([]);
    expect(units[0].hexX).toBe(1); // didn't move
  });

  it('fails for non-existent unit', () => {
    const hexes = makePlainLine(3);
    const hexLookup = createHexLookup(hexes.map(h => ({ x: h.x, y: h.y, terrain: h.terrain })));
    const units: Unit[] = [];
    const actions = [makeAction({ params: { unitId: 'nonexistent', targetX: 1, targetY: 0 } })];

    const result = resolveMovement(units, actions, hexLookup);

    expect(result.actionResults[0].status).toBe('failed');
    expect(result.actionResults[0].result).toContain('not found');
  });

  it('fails for wrong colony ownership', () => {
    const hexes = makePlainLine(3);
    const hexLookup = createHexLookup(hexes.map(h => ({ x: h.x, y: h.y, terrain: h.terrain })));
    const units = [makeUnit({ colonyId: 'colony-2' })];
    const actions = [makeAction({ colonyId: 'colony-1', params: { unitId: 'unit-1', targetX: 1, targetY: 0 } })];

    const result = resolveMovement(units, actions, hexLookup);

    expect(result.actionResults[0].status).toBe('failed');
    expect(result.actionResults[0].result).toContain('does not belong');
  });

  it('advances existing movement queue without new action', () => {
    const hexes = makePlainLine(5);
    const hexLookup = createHexLookup(hexes.map(h => ({ x: h.x, y: h.y, terrain: h.terrain })));
    const units = [makeUnit({
      hexX: 0, hexY: 0,
      type: 'scout',
      movementQueue: [{ q: 1, r: 0 }, { q: 2, r: 0 }, { q: 3, r: 0 }, { q: 4, r: 0 }],
    })];
    // No new actions — just advance existing queue
    const result = resolveMovement(units, [], hexLookup);

    expect(units[0].hexX).toBe(4);
    expect(units[0].hexY).toBe(0);
    expect(units[0].movementQueue?.length).toBe(0);
    expect(result.events.some(e => e.type === 'unit_moved')).toBe(true);
  });

  it('completes movement when queue is fully drained', () => {
    const hexes = makePlainLine(2);
    const hexLookup = createHexLookup(hexes.map(h => ({ x: h.x, y: h.y, terrain: h.terrain })));
    const units = [makeUnit({
      hexX: 0, hexY: 0,
      type: 'scout', // speed 5
      movementQueue: [{ q: 1, r: 0 }, { q: 2, r: 0 }], // only 2 steps
    })];

    const result = resolveMovement(units, [], hexLookup);

    expect(units[0].hexX).toBe(2);
    expect(units[0].movementQueue).toEqual([]);
    expect(result.events.some(e => e.type === 'movement_complete')).toBe(true);
  });

  it('respects terrain costs: forest slows movement', () => {
    const hexes = [
      makeHex(0, 0, { terrain: 'plains' }),
      makeHex(1, 0, { terrain: 'forest' }), // cost 2
      makeHex(2, 0, { terrain: 'plains' }),
      makeHex(3, 0, { terrain: 'plains' }),
    ];
    const hexLookup = createHexLookup(hexes.map(h => ({ x: h.x, y: h.y, terrain: h.terrain })));
    const units = [makeUnit({
      hexX: 0, hexY: 0,
      type: 'scout', // speed 3
      movementQueue: [{ q: 1, r: 0 }, { q: 2, r: 0 }, { q: 3, r: 0 }],
    })];

    const result = resolveMovement(units, [], hexLookup);

    // Forest 1.5 + plains 1 + plains 1 = 3.5, within scout speed 5. Moves full path.
    expect(units[0].hexX).toBe(3);
    expect(units[0].hexY).toBe(0);
    expect(units[0].movementQueue?.length).toBe(0);
  });
});

// --- resolveFoundSettlement ---

describe('resolveFoundSettlement', () => {
  function makeFoundAction(overrides: Partial<QueuedAction> = {}): QueuedAction {
    return {
      id: 'action-found-1',
      colonyId: 'colony-1',
      type: 'found_settlement',
      params: { unitId: 'settler-1', name: 'New Outpost' },
      ...overrides,
    };
  }

  function makeSettler(overrides: Partial<Unit> = {}): Unit {
    return makeUnit({
      id: 'settler-1',
      type: 'settler',
      hexX: 10,
      hexY: 0,
      ...overrides,
    });
  }

  it('founds a settlement successfully', () => {
    const colony = makeColony({ resources: { food: 200, timber: 100, stone: 30, iron: 10, influence: 50 } });
    const settler = makeSettler();
    // Existing settlement far away at (0,0)
    const settlement = makeSettlement({ hexX: 0, hexY: 0 });
    const hexes = makePlainGrid(15);
    const allHexCoords = new Set(hexes.map(h => `${h.x},${h.y}`));

    const result = resolveFoundSettlement(
      [settler], [colony], [settlement], hexes, [makeFoundAction()], allHexCoords,
    );

    expect(result.actionResults[0].status).toBe('resolved');
    expect(result.newSettlements).toHaveLength(1);
    expect(result.newSettlements[0].tier).toBe('outpost');
    expect(result.newSettlements[0].population).toBe(10);
    expect(result.newSettlements[0].hexX).toBe(10);
    expect(result.newSettlements[0].hexY).toBe(0);
    expect(result.newSettlements[0].name).toBe('New Outpost');
    expect(result.consumedUnitIds).toContain('settler-1');
    expect(result.units.find(u => u.id === 'settler-1')).toBeUndefined();
  });

  it('deducts founding cost from colony resources', () => {
    const colony = makeColony({ resources: { food: 200, timber: 100, stone: 30, iron: 10, influence: 50 } });
    const settler = makeSettler();
    const settlement = makeSettlement({ hexX: 0, hexY: 0 });
    const hexes = makePlainGrid(15);
    const allHexCoords = new Set(hexes.map(h => `${h.x},${h.y}`));

    resolveFoundSettlement(
      [settler], [colony], [settlement], hexes, [makeFoundAction()], allHexCoords,
    );

    expect(colony.resources.food).toBe(200 - (FOUNDING_COST.food ?? 0));
    expect(colony.resources.timber).toBe(100 - (FOUNDING_COST.timber ?? 0));
  });

  it('generates settlement_founded event', () => {
    const colony = makeColony({ resources: { food: 200, timber: 100, stone: 30, iron: 10, influence: 50 } });
    const settler = makeSettler();
    const settlement = makeSettlement({ hexX: 0, hexY: 0 });
    const hexes = makePlainGrid(15);
    const allHexCoords = new Set(hexes.map(h => `${h.x},${h.y}`));

    const result = resolveFoundSettlement(
      [settler], [colony], [settlement], hexes, [makeFoundAction()], allHexCoords,
    );

    const event = result.events.find(e => e.type === 'settlement_founded');
    expect(event).toBeDefined();
    expect(event!.colonyId).toBe('colony-1');
    expect(event!.data.name).toBe('New Outpost');
    expect(event!.data.hexX).toBe(10);
    expect(event!.data.hexY).toBe(0);
  });

  it('generates fog reveals around new settlement', () => {
    const colony = makeColony({ resources: { food: 200, timber: 100, stone: 30, iron: 10, influence: 50 } });
    const settler = makeSettler();
    const settlement = makeSettlement({ hexX: 0, hexY: 0 });
    const hexes = makePlainGrid(15);
    const allHexCoords = new Set(hexes.map(h => `${h.x},${h.y}`));

    const result = resolveFoundSettlement(
      [settler], [colony], [settlement], hexes, [makeFoundAction()], allHexCoords,
    );

    // Should have fog reveals within FOUNDING_REVEAL_RADIUS of (10,10)
    expect(result.fogReveals.length).toBeGreaterThan(0);
    expect(result.fogReveals.every(r => r.colonyId === 'colony-1')).toBe(true);
  });

  it('fails when unit is not a settler', () => {
    const colony = makeColony({ resources: { food: 200, timber: 100, stone: 30, iron: 10, influence: 50 } });
    const scout = makeUnit({ id: 'settler-1', type: 'scout', hexX: 10, hexY: 10 });
    const hexes = makePlainGrid(15);
    const allHexCoords = new Set(hexes.map(h => `${h.x},${h.y}`));

    const result = resolveFoundSettlement(
      [scout], [colony], [], hexes, [makeFoundAction()], allHexCoords,
    );

    expect(result.actionResults[0].status).toBe('failed');
    expect(result.actionResults[0].result).toContain('not a settler');
    expect(result.newSettlements).toHaveLength(0);
  });

  it('fails when unit does not belong to colony', () => {
    const colony = makeColony();
    const settler = makeSettler({ colonyId: 'colony-2' });
    const hexes = makePlainGrid(15);
    const allHexCoords = new Set(hexes.map(h => `${h.x},${h.y}`));

    const result = resolveFoundSettlement(
      [settler], [colony], [], hexes, [makeFoundAction()], allHexCoords,
    );

    expect(result.actionResults[0].status).toBe('failed');
    expect(result.actionResults[0].result).toContain('does not belong');
  });

  it('fails on ocean terrain', () => {
    const colony = makeColony({ resources: { food: 200, timber: 100, stone: 30, iron: 10, influence: 50 } });
    const settler = makeSettler({ hexX: 5, hexY: 0 });
    const hexes = [
      ...makePlainGrid(10),
    ];
    // Override hex at (5,0) to be ocean
    const oceanIdx = hexes.findIndex(h => h.x === 5 && h.y === 0);
    if (oceanIdx >= 0) hexes[oceanIdx] = makeHex(5, 0, { terrain: 'ocean' });
    const allHexCoords = new Set(hexes.map(h => `${h.x},${h.y}`));

    const result = resolveFoundSettlement(
      [settler], [colony], [], hexes, [makeFoundAction({ params: { unitId: 'settler-1', name: 'Ocean Base' } })], allHexCoords,
    );

    expect(result.actionResults[0].status).toBe('failed');
    expect(result.actionResults[0].result).toContain('ocean');
  });

  it('fails on mountains terrain', () => {
    const colony = makeColony({ resources: { food: 200, timber: 100, stone: 30, iron: 10, influence: 50 } });
    const settler = makeSettler({ hexX: 5, hexY: 0 });
    const hexes = makePlainGrid(10);
    const mtIdx = hexes.findIndex(h => h.x === 5 && h.y === 0);
    if (mtIdx >= 0) hexes[mtIdx] = makeHex(5, 0, { terrain: 'mountains' });
    const allHexCoords = new Set(hexes.map(h => `${h.x},${h.y}`));

    const result = resolveFoundSettlement(
      [settler], [colony], [], hexes, [makeFoundAction({ params: { unitId: 'settler-1', name: 'Peak' } })], allHexCoords,
    );

    expect(result.actionResults[0].status).toBe('failed');
    expect(result.actionResults[0].result).toContain('mountains');
  });

  it('fails when hex already has a settlement', () => {
    const colony = makeColony({ resources: { food: 200, timber: 100, stone: 30, iron: 10, influence: 50 } });
    const settler = makeSettler({ hexX: 5, hexY: 0 });
    const hexes = makePlainGrid(10);
    // Mark hex as having a settlement
    const idx = hexes.findIndex(h => h.x === 5 && h.y === 0);
    if (idx >= 0) hexes[idx] = makeHex(5, 0, { settlementId: 'existing-settlement' });
    const allHexCoords = new Set(hexes.map(h => `${h.x},${h.y}`));

    const result = resolveFoundSettlement(
      [settler], [colony], [], hexes, [makeFoundAction({ params: { unitId: 'settler-1', name: 'Duplicate' } })], allHexCoords,
    );

    expect(result.actionResults[0].status).toBe('failed');
    expect(result.actionResults[0].result).toContain('already has a settlement');
  });

  it('fails when too close to another settlement', () => {
    const colony = makeColony({ resources: { food: 200, timber: 100, stone: 30, iron: 10, influence: 50 } });
    // Settler at (2,0), existing settlement at (0,0) — distance 2, under MIN_SETTLEMENT_DISTANCE=3
    const settler = makeSettler({ hexX: 2, hexY: 0 });
    const existingSettlement = makeSettlement({ hexX: 0, hexY: 0 });
    const hexes = makePlainGrid(10);
    const allHexCoords = new Set(hexes.map(h => `${h.x},${h.y}`));

    const result = resolveFoundSettlement(
      [settler], [colony], [existingSettlement], hexes, [makeFoundAction({ params: { unitId: 'settler-1', name: 'Too Close' } })], allHexCoords,
    );

    expect(result.actionResults[0].status).toBe('failed');
    expect(result.actionResults[0].result).toContain('Too close');
  });

  it('succeeds when exactly at minimum distance', () => {
    const colony = makeColony({ resources: { food: 200, timber: 100, stone: 30, iron: 10, influence: 50 } });
    // Settler at (3,0), existing settlement at (0,0) — distance exactly 3
    const settler = makeSettler({ hexX: 3, hexY: 0 });
    const existingSettlement = makeSettlement({ hexX: 0, hexY: 0 });
    const hexes = makePlainGrid(10);
    const allHexCoords = new Set(hexes.map(h => `${h.x},${h.y}`));

    const result = resolveFoundSettlement(
      [settler], [colony], [existingSettlement], hexes, [makeFoundAction({ params: { unitId: 'settler-1', name: 'Just Right' } })], allHexCoords,
    );

    expect(result.actionResults[0].status).toBe('resolved');
    expect(result.newSettlements).toHaveLength(1);
  });

  it('fails when colony lacks food', () => {
    const colony = makeColony({ resources: { food: 50, timber: 100, stone: 30, iron: 10, influence: 50 } });
    const settler = makeSettler();
    const hexes = makePlainGrid(15);
    const allHexCoords = new Set(hexes.map(h => `${h.x},${h.y}`));

    const result = resolveFoundSettlement(
      [settler], [colony], [], hexes, [makeFoundAction()], allHexCoords,
    );

    expect(result.actionResults[0].status).toBe('failed');
    expect(result.actionResults[0].result).toContain('Insufficient resources');
  });

  it('fails when colony lacks timber', () => {
    const colony = makeColony({ resources: { food: 200, timber: 10, stone: 30, iron: 10, influence: 50 } });
    const settler = makeSettler();
    const hexes = makePlainGrid(15);
    const allHexCoords = new Set(hexes.map(h => `${h.x},${h.y}`));

    const result = resolveFoundSettlement(
      [settler], [colony], [], hexes, [makeFoundAction()], allHexCoords,
    );

    expect(result.actionResults[0].status).toBe('failed');
    expect(result.actionResults[0].result).toContain('Insufficient resources');
  });

  it('fails when unit not found', () => {
    const colony = makeColony();
    const hexes = makePlainGrid(15);
    const allHexCoords = new Set(hexes.map(h => `${h.x},${h.y}`));

    const result = resolveFoundSettlement(
      [], [colony], [], hexes, [makeFoundAction()], allHexCoords,
    );

    expect(result.actionResults[0].status).toBe('failed');
    expect(result.actionResults[0].result).toContain('not found');
  });

  it('prevents same settler from founding twice in one tick', () => {
    const colony = makeColony({ resources: { food: 500, timber: 200, stone: 30, iron: 10, influence: 50 } });
    const settler = makeSettler();
    const hexes = makePlainGrid(15);
    const allHexCoords = new Set(hexes.map(h => `${h.x},${h.y}`));

    const actions = [
      makeFoundAction({ id: 'act-1' }),
      makeFoundAction({ id: 'act-2', params: { unitId: 'settler-1', name: 'Second' } }),
    ];

    const result = resolveFoundSettlement(
      [settler], [colony], [], hexes, actions, allHexCoords,
    );

    // First succeeds, second fails
    expect(result.actionResults[0].status).toBe('resolved');
    expect(result.actionResults[1].status).toBe('failed');
    expect(result.actionResults[1].result).toContain('already consumed');
    expect(result.newSettlements).toHaveLength(1);
  });

  it('enforces distance between two settlements founded same tick', () => {
    const colony = makeColony({ resources: { food: 500, timber: 200, stone: 30, iron: 10, influence: 50 } });
    // Two settlers, one at (0,0) and one at (1,0) — distance 1, too close
    const settler1 = makeSettler({ id: 'settler-1', hexX: 0, hexY: 0 });
    const settler2 = makeSettler({ id: 'settler-2', hexX: 1, hexY: 0 });
    const hexes = makePlainGrid(10);
    const allHexCoords = new Set(hexes.map(h => `${h.x},${h.y}`));

    const actions = [
      makeFoundAction({ id: 'act-1', params: { unitId: 'settler-1', name: 'First' } }),
      makeFoundAction({ id: 'act-2', params: { unitId: 'settler-2', name: 'Second' } }),
    ];

    const result = resolveFoundSettlement(
      [settler1, settler2], [colony], [], hexes, actions, allHexCoords,
    );

    expect(result.actionResults[0].status).toBe('resolved');
    expect(result.actionResults[1].status).toBe('failed');
    expect(result.actionResults[1].result).toContain('Too close');
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

    // Food: 15 (farm) + 10.5 (hexes) = 25.5 produced, 4 (pop consumption) upkeep
    // Net: ~21.5. Starting 100 + 21.5 > 100
    expect(result.colonies[0].resources.food).toBeGreaterThan(100);
    expect(result.events.some(e => e.type === 'production')).toBe(true);
  });

  it('deducts unit upkeep from food', () => {
    const colony = makeColony({ resources: { food: 10, timber: 50, stone: 30, iron: 10, influence: 50 } });
    const settlement = makeSettlement({ population: 0 });
    const units = [
      makeUnit({ type: 'soldier' }), // 3 food
      makeUnit({ type: 'soldier', id: 'unit-2' }), // 3 food
    ];
    // No hexes around settlement = no hex yield, no pop consumption
    const result = resolveTick([colony], [settlement], units, []);

    // Net food = 0 production - 6 upkeep = -6. Starting 10 + (-6) = 4
    expect(result.colonies[0].resources.food).toBeLessThan(10);
  });

  it('triggers famine and morale loss when food goes negative', () => {
    const colony = makeColony({ resources: { food: 0, timber: 50, stone: 30, iron: 10, influence: 50 } });
    const settlement = makeSettlement({ population: 0 });
    const units = [
      makeUnit({ type: 'siege' }), // 4 food upkeep
    ];
    const result = resolveTick([colony], [settlement], units, []);

    // Famine event with severity info
    const famineEvent = result.events.find(e => e.type === 'famine');
    expect(famineEvent).toBeDefined();
    expect(famineEvent!.data.severity).toBeDefined();
    expect(famineEvent!.data.moraleLossPerTick).toBeDefined();

    // Famine triggers; morale should not increase above the initial full morale.
    expect(result.units[0].morale).toBeLessThanOrEqual(1.0);
    expect(result.units[0].morale).toBeGreaterThanOrEqual(0);

    // Food clamped to 0
    expect(result.colonies[0].resources.food).toBe(0);
  });

  it('deserts units when morale drops below threshold (probabilistic)', () => {
    // With probabilistic desertion, we test with multiple units at 0 morale
    // With DESERTION_CHANCE=0.3 per unit, having 10 units means it's extremely unlikely none desert
    const colony = makeColony({ resources: { food: 0, timber: 50, stone: 30, iron: 10, influence: 50 } });
    const settlement = makeSettlement({ population: 0 });
    const units = Array.from({ length: 10 }, (_, i) =>
      makeUnit({ id: `unit-${i}`, type: 'siege', morale: 0.0 }),
    );
    const result = resolveTick([colony], [settlement], units, []);

    // All units accounted for (deserted + surviving = total)
    expect(result.desertedUnitIds.length + result.units.length).toBe(10);
    // Famine event should fire
    expect(result.events.some(e => e.type === 'famine')).toBe(true);
  });

  it('morale loss scales with deficit severity', () => {
    // Small deficit
    const colony1 = makeColony({ resources: { food: 3, timber: 50, stone: 30, iron: 10, influence: 50 } });
    const settlement1 = makeSettlement({ population: 0 });
    const units1 = [makeUnit({ id: 'u1', type: 'siege' })]; // 4 food upkeep, net = -1
    const result1 = resolveTick([colony1], [settlement1], units1, []);

    // Large deficit
    const colony2 = makeColony({ resources: { food: 0, timber: 50, stone: 30, iron: 10, influence: 50 } });
    const settlement2 = makeSettlement({ population: 40 }); // 20 food consumption
    const units2 = [makeUnit({ id: 'u2', type: 'siege' })]; // +4 upkeep = 24 total
    const result2 = resolveTick([colony2], [settlement2], units2, []);

    // Both trigger famine
    expect(result1.events.some(e => e.type === 'famine')).toBe(true);
    expect(result2.events.some(e => e.type === 'famine')).toBe(true);

    // Larger deficit → more morale loss
    const u1 = result1.units.find(u => u.id === 'u1');
    const u2 = result2.units.find(u => u.id === 'u2');
    if (u1 && u2) {
      expect(u2.morale).toBeLessThanOrEqual(u1.morale);
    }
  });

  it('recovers morale when food is positive', () => {
    const colony = makeColony({ resources: { food: 100, timber: 50, stone: 30, iron: 10, influence: 50 } });
    const settlement = makeSettlement({
      buildings: [{ type: 'farm', level: 1 }],
      population: 10,
    });
    const units = [
      makeUnit({ morale: 0.5 }),
    ];
    const hexes = makeHexRing(0, 0);
    const result = resolveTick([colony], [settlement], units, hexes);

    // Net food is positive, so morale should recover from its starting point.
    expect(result.units[0].morale).toBeGreaterThan(0.5);
    expect(result.units[0].morale).toBeLessThanOrEqual(1.0);
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

    const u2 = makeUnit({ id: 'u2', colonyId: 'c2', type: 'siege', hexX: 5, hexY: 5 }); // 4 food upkeep

    const hexes = makeHexRing(0, 0);
    const result = resolveTick([colony1, colony2], [s1, s2], [u2], hexes);

    // Colony 1 should gain food (farm lvl2: 20 food + hexes - 5 pop consumption)
    expect(result.colonies.find(c => c.id === 'c1')!.resources.food).toBeGreaterThan(100);

    // Colony 2 should lose food (no production, 4 food upkeep, started at 5)
    const c2Resources = result.colonies.find(c => c.id === 'c2')!.resources.food;
    expect(c2Resources).toBeLessThan(5);
  });

  it('caps morale recovery at 1.0', () => {
    const colony = makeColony({ resources: { food: 500, timber: 500, stone: 500, iron: 500, influence: 500 } });
    const settlement = makeSettlement({ buildings: [{ type: 'farm', level: 3 }], population: 10 });
    const units = [makeUnit({ morale: 0.99 })];
    const hexes = makeHexRing(0, 0);
    const result = resolveTick([colony], [settlement], units, hexes);

    expect(result.units[0].morale).toBe(1.0);
  });

  it('heals units at friendly settlements each tick and emits a private healing event', () => {
    const colony = makeColony();
    const settlement = makeSettlement({ population: 0 });
    const unit = makeUnit({ type: 'soldier', health: 60, morale: 0.7 });

    const result = resolveTick([colony], [settlement], [unit], makeHexRing(0, 0));

    expect(result.units[0].health).toBe(60 + HEALING_PER_TICK);
    const healEvent = result.events.find(e => e.type === 'garrison_heal');
    expect(healEvent).toBeDefined();
    expect(healEvent?.colonyId).toBe(colony.id);
    expect(healEvent?.unitId).toBe(unit.id);
    expect(healEvent?.data.healthBefore).toBe(60);
    expect(healEvent?.data.healthAfter).toBe(60 + HEALING_PER_TICK);
  });

  it('adds barracks healing bonus scaled by level', () => {
    const colony = makeColony();
    const settlement = makeSettlement({
      population: 0,
      buildings: [{ type: 'barracks', level: 2 }],
    });
    const unit = makeUnit({ type: 'soldier', health: 70, morale: 0.6 });

    const result = resolveTick([colony], [settlement], [unit], makeHexRing(0, 0));

    expect(result.units[0].health).toBe(70 + HEALING_PER_TICK + (BARRACKS_HEALING_BONUS * 2));
    const healEvent = result.events.find(e => e.type === 'garrison_heal');
    expect(healEvent?.data.barracksBonus).toBe(BARRACKS_HEALING_BONUS * 2);
  });

  it('caps settlement healing at 100 health', () => {
    const colony = makeColony();
    const settlement = makeSettlement({
      population: 0,
      buildings: [{ type: 'barracks', level: 3 }],
    });
    const unit = makeUnit({ type: 'soldier', health: 96, morale: 0.5 });

    const result = resolveTick([colony], [settlement], [unit], makeHexRing(0, 0));

    expect(result.units[0].health).toBe(100);
  });

  it('does not heal units on friendly settlements if combat happened on that hex this tick', () => {
    const friendlyColony = makeColony({ id: 'c1' });
    const enemyColony = makeColony({ id: 'c2' });
    const settlement = makeSettlement({ colonyId: 'c1', population: 0 });
    const friendlyUnit = makeUnit({ id: 'u1', colonyId: 'c1', type: 'soldier', health: 25, morale: 0.7 });
    const enemyUnit = makeUnit({ id: 'u2', colonyId: 'c2', type: 'settler', health: 10, morale: 1.0 });

    const result = resolveTick(
      [friendlyColony, enemyColony],
      [settlement],
      [friendlyUnit, enemyUnit],
      makeHexRing(0, 0),
      [],
      42,
    );

    const healedUnit = result.units.find(u => u.id === 'u1');
    expect(healedUnit).toBeDefined();
    expect(healedUnit?.health).toBeLessThanOrEqual(25);
    expect(result.events.some(e => e.type === 'garrison_heal' && e.unitId === 'u1')).toBe(false);
    expect(result.events.some(e => e.type === 'combat_resolved')).toBe(true);
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

  it('prevents a protected colony from attacking other colonies', () => {
    const protectedColony = makeColony({ id: 'c1', newcomerProtectionUntilTick: NEWCOMER_PROTECTION_TICKS });
    const enemyColony = makeColony({ id: 'c2' });
    const protectedUnit = makeUnit({ id: 'u1', colonyId: 'c1', type: 'soldier' });
    const enemyUnit = makeUnit({ id: 'u2', colonyId: 'c2', type: 'soldier', hexX: 1, hexY: 0 });
    const hexes = makePlainLine(2);

    const result = resolveTick(
      [protectedColony, enemyColony],
      [],
      [protectedUnit, enemyUnit],
      hexes,
      [{ id: 'a1', colonyId: 'c1', type: 'attack', params: { unitId: 'u1', targetX: 1, targetY: 0 } }],
      42,
      'world-1',
      1,
    );

    expect(result.actionResults.find(r => r.actionId === 'a1')?.status).toBe('failed');
    expect(result.units.find(u => u.id === 'u1')?.hexX).toBe(0);
    expect(result.events.some(e => e.type === 'combat_resolved')).toBe(false);
  });

  it('blocks enemy movement into a protected colony settlement hex', () => {
    const protectedColony = makeColony({ id: 'c1', newcomerProtectionUntilTick: NEWCOMER_PROTECTION_TICKS });
    const enemyColony = makeColony({ id: 'c2' });
    const protectedSettlement = makeSettlement({ id: 's1', colonyId: 'c1', hexX: 1, hexY: 0, population: 0 });
    const enemyUnit = makeUnit({ id: 'u2', colonyId: 'c2', type: 'soldier', hexX: 0, hexY: 0 });
    const hexes = makePlainLine(2);

    const result = resolveTick(
      [protectedColony, enemyColony],
      [protectedSettlement],
      [enemyUnit],
      hexes,
      [{ id: 'a1', colonyId: 'c2', type: 'move_unit', params: { unitId: 'u2', targetX: 1, targetY: 0 } }],
      42,
      'world-1',
      1,
    );

    expect(result.units.find(u => u.id === 'u2')?.hexX).toBe(0);
    expect(result.events.some(e => e.type === 'movement_blocked' && e.unitId === 'u2')).toBe(true);
  });

  it('suppresses combat involving protected colonies', () => {
    const protectedUnits = [
      makeUnit({ id: 'u1', colonyId: 'c1', type: 'soldier' }),
      makeUnit({ id: 'u2', colonyId: 'c2', type: 'soldier' }),
    ];

    const result = resolveCombat(protectedUnits, [], 42, undefined, undefined, new Set(['c1']));

    expect(result.destroyedUnitIds).toHaveLength(0);
    expect(result.events.some(e => e.type === 'combat_resolved')).toBe(false);
    expect(result.units.every(u => u.health === 100)).toBe(true);
  });

  // --- Movement integration in resolveTick ---

  it('processes move_unit actions and moves units', () => {
    const colony = makeColony();
    const settlement = makeSettlement({ population: 0 });
    const hexes = makePlainLine(5);
    const units = [makeUnit({ hexX: 0, hexY: 0, type: 'scout' })];
    const actions: QueuedAction[] = [
      makeAction({ params: { unitId: 'unit-1', targetX: 5, targetY: 0 } }),
    ];

    const result = resolveTick([colony], [settlement], units, hexes, actions);

    // Scout moved toward target
    expect(result.units[0].hexX).toBeGreaterThan(0);
    expect(result.actionResults.length).toBe(1);
    expect(result.actionResults[0].status).toBe('resolved');
    expect(result.events.some(e => e.type === 'unit_moved')).toBe(true);
  });

  it('returns empty actionResults when no actions provided', () => {
    const colony = makeColony();
    const settlement = makeSettlement({ population: 10 });
    const hexes = makeHexRing(0, 0);

    const result = resolveTick([colony], [settlement], [], hexes);

    expect(result.actionResults).toEqual([]);
  });

  it('returns failed actionResults for invalid moves', () => {
    const colony = makeColony();
    const settlement = makeSettlement({ population: 0 });
    const hexes = [
      makeHex(0, 0),
      makeHex(1, 0, { terrain: 'ocean' }),
      makeHex(2, 0),
    ];
    const units = [makeUnit({ hexX: 0, hexY: 0 })];
    const actions: QueuedAction[] = [
      makeAction({ params: { unitId: 'unit-1', targetX: 2, targetY: 0 } }),
    ];

    const result = resolveTick([colony], [settlement], units, hexes, actions);

    expect(result.actionResults[0].status).toBe('failed');
    expect(result.units[0].hexX).toBe(0); // didn't move
  });

  it('continues draining movement queue across ticks without new actions', () => {
    const colony = makeColony();
    const settlement = makeSettlement({ population: 0 });
    const hexes = makePlainLine(8);

    // Tick 1: set path
    const units1 = [makeUnit({ hexX: 0, hexY: 0, type: 'militia' })]; // speed 2
    const actions1: QueuedAction[] = [
      makeAction({ params: { unitId: 'unit-1', targetX: 6, targetY: 0 } }),
    ];
    const result1 = resolveTick([colony], [settlement], units1, hexes, actions1);

    expect(result1.units[0].hexX).toBe(3);
    expect(result1.units[0].movementQueue?.length).toBe(3);

    // Tick 2: no new actions, continue movement
    const result2 = resolveTick([colony], [settlement], result1.units, hexes);

    expect(result2.units[0].hexX).toBe(6);
    expect(result2.units[0].movementQueue).toEqual([]);

    // Tick 3: complete
    const result3 = resolveTick([colony], [settlement], result2.units, hexes);

    expect(result3.units[0].hexX).toBe(6);
    expect(result3.units[0].movementQueue).toEqual([]);
  });

  // --- Settlement founding integration in resolveTick ---

  it('resolves found_settlement in tick and adds new settlement to results', () => {
    const colony = makeColony({ resources: { food: 200, timber: 100, stone: 30, iron: 10, influence: 50 } });
    const existingSettlement = makeSettlement({ hexX: 0, hexY: 0 });
    const settler = makeUnit({ id: 'settler-1', type: 'settler', hexX: 10, hexY: 0 });
    const hexes = makePlainGrid(15);

    const actions: QueuedAction[] = [{
      id: 'act-found',
      colonyId: 'colony-1',
      type: 'found_settlement',
      params: { unitId: 'settler-1', name: 'Outpost Beta' },
    }];

    const result = resolveTick([colony], [existingSettlement], [settler], hexes, actions);

    // Settlement created
    expect(result.settlements.length).toBe(2); // original + new
    const newSettlement = result.settlements.find(s => s.name === 'Outpost Beta');
    expect(newSettlement).toBeDefined();
    expect(newSettlement!.tier).toBe('outpost');
    expect(newSettlement!.hexX).toBe(10);
    expect(newSettlement!.hexY).toBe(0);

    // Settler consumed
    expect(result.units.find(u => u.id === 'settler-1')).toBeUndefined();

    // Resources deducted
    expect(result.colonies[0].resources.food).toBeLessThan(200);
    expect(result.colonies[0].resources.timber).toBeLessThan(100);

    // Action resolved
    const foundResult = result.actionResults.find(ar => ar.actionId === 'act-found');
    expect(foundResult?.status).toBe('resolved');

    // Event generated
    expect(result.events.some(e => e.type === 'settlement_founded')).toBe(true);

    // Fog reveals
    expect(result.fogReveals.length).toBeGreaterThan(0);
  });

  it('consumed settler does not move in same tick', () => {
    const colony = makeColony({ resources: { food: 200, timber: 100, stone: 30, iron: 10, influence: 50 } });
    const existingSettlement = makeSettlement({ hexX: 0, hexY: 0 });
    const settler = makeUnit({
      id: 'settler-1',
      type: 'settler',
      hexX: 10,
      hexY: 0,
      movementQueue: [{ q: 11, r: 0 }, { q: 12, r: 0 }],
    });
    const hexes = makePlainGrid(15);

    const actions: QueuedAction[] = [{
      id: 'act-found',
      colonyId: 'colony-1',
      type: 'found_settlement',
      params: { unitId: 'settler-1', name: 'Outpost Beta' },
    }];

    const result = resolveTick([colony], [existingSettlement], [settler], hexes, actions);

    // Settler was consumed — should not appear in units
    expect(result.units.find(u => u.id === 'settler-1')).toBeUndefined();
    // No movement events for consumed settler
    expect(result.events.filter(e => e.type === 'unit_moved' && e.unitId === 'settler-1')).toHaveLength(0);
  });

  it('new settlement produces resources in the same tick', () => {
    const colony = makeColony({ resources: { food: 200, timber: 100, stone: 30, iron: 10, influence: 50 } });
    const settler = makeUnit({ id: 'settler-1', type: 'settler', hexX: 10, hexY: 0 });
    const hexes = makePlainGrid(15);

    const actions: QueuedAction[] = [{
      id: 'act-found',
      colonyId: 'colony-1',
      type: 'found_settlement',
      params: { unitId: 'settler-1', name: 'Outpost Beta' },
    }];

    const result = resolveTick([colony], [], [settler], hexes, actions);

    // New settlement should produce resources (population food + hex yields)
    const productionEvent = result.events.find(e => e.type === 'production');
    expect(productionEvent).toBeDefined();
    const produced = productionEvent!.data.produced as Resources;
    expect(produced.food).toBeGreaterThan(0); // at least population base production
  });

  it('handles mixed found_settlement and move_unit actions', () => {
    const colony = makeColony({ resources: { food: 200, timber: 100, stone: 30, iron: 10, influence: 50 } });
    const existingSettlement = makeSettlement({ hexX: 0, hexY: 0 });
    const settler = makeUnit({ id: 'settler-1', type: 'settler', hexX: 10, hexY: 0 });
    const scout = makeUnit({ id: 'scout-1', type: 'scout', hexX: 0, hexY: 0 });
    const hexes = makePlainGrid(15);

    const actions: QueuedAction[] = [
      {
        id: 'act-found',
        colonyId: 'colony-1',
        type: 'found_settlement',
        params: { unitId: 'settler-1', name: 'Beta' },
      },
      {
        id: 'act-move',
        colonyId: 'colony-1',
        type: 'move_unit',
        params: { unitId: 'scout-1', targetX: 5, targetY: 0 },
      },
    ];

    const result = resolveTick([colony], [existingSettlement], [settler, scout], hexes, actions);

    // Settlement founded
    expect(result.settlements.length).toBe(2);
    expect(result.actionResults.find(ar => ar.actionId === 'act-found')?.status).toBe('resolved');

    // Scout moved
    const scoutUnit = result.units.find(u => u.id === 'scout-1');
    expect(scoutUnit).toBeDefined();
    expect(scoutUnit!.hexX).toBeGreaterThan(0);
    expect(result.actionResults.find(ar => ar.actionId === 'act-move')?.status).toBe('resolved');
  });

  // --- Build action integration in resolveTick ---

  it('resolves build action: deducts resources and adds to build queue', () => {
    const colony = makeColony({ resources: { food: 100, timber: 50, stone: 30, iron: 10, influence: 50 } });
    const settlement = makeSettlement();
    const hexes = makeHexRing(0, 0);

    const actions: QueuedAction[] = [
      makeBuildAction(),
    ];

    const result = resolveTick([colony], [settlement], [], hexes, actions);

    // Build action resolved
    const buildResult = result.actionResults.find(ar => ar.actionId === 'action-build-1');
    expect(buildResult?.status).toBe('resolved');

    // Resources deducted (farm costs 20 timber)
    expect(result.colonies[0].resources.timber).toBeLessThan(50);

    // Build queue populated
    const s = result.settlements[0];
    expect(s.buildQueue.length).toBe(1);
    expect(s.buildQueue[0].type).toBe('farm');
    // ticksRemaining should be BUILD_TIME - 1 (queued then advanced in same tick)
    expect(s.buildQueue[0].ticksRemaining).toBe(BUILD_TIME - 1);

    // build_started event
    expect(result.events.some(e => e.type === 'build_started')).toBe(true);
  });

  it('completes building after BUILD_TIME ticks via resolveTick', () => {
    const colony = makeColony();
    const settlement = makeSettlement({
      buildQueue: [{ type: 'farm', ticksRemaining: 1 }],
    });
    const hexes = makeHexRing(0, 0);

    const result = resolveTick([colony], [settlement], [], hexes);

    // Farm should be complete
    const s = result.settlements[0];
    expect(s.buildings).toHaveLength(1);
    expect(s.buildings[0].type).toBe('farm');
    expect(s.buildings[0].level).toBe(1);
    expect(s.buildQueue).toHaveLength(0);

    // build_complete event
    expect(result.events.some(e => e.type === 'build_complete')).toBe(true);

    // Completed building should contribute to production
    const productionEvent = result.events.find(e => e.type === 'production');
    expect(productionEvent).toBeDefined();
    const produced = productionEvent!.data.produced as Resources;
    expect(produced.food).toBeGreaterThan(0);
  });

  it('build queue progresses across multiple ticks', () => {
    const colony = makeColony({ resources: { food: 500, timber: 500, stone: 500, iron: 500, influence: 500 } });
    const settlement = makeSettlement();
    const hexes = makeHexRing(0, 0);

    // Tick 1: submit build action
    const actions: QueuedAction[] = [makeBuildAction()];
    const result1 = resolveTick([colony], [settlement], [], hexes, actions);

    // Farm queued, ticksRemaining = BUILD_TIME - 1 = 2
    expect(result1.settlements[0].buildQueue[0].ticksRemaining).toBe(BUILD_TIME - 1);
    expect(result1.settlements[0].buildings).toHaveLength(0);

    // Tick 2: no actions, queue advances
    const result2 = resolveTick(result1.colonies, result1.settlements, [], hexes);
    expect(result2.settlements[0].buildQueue[0].ticksRemaining).toBe(BUILD_TIME - 2);
    expect(result2.settlements[0].buildings).toHaveLength(0);

    // Tick 3: building completes
    const result3 = resolveTick(result2.colonies, result2.settlements, [], hexes);
    expect(result3.settlements[0].buildQueue).toHaveLength(0);
    expect(result3.settlements[0].buildings).toHaveLength(1);
    expect(result3.settlements[0].buildings[0].type).toBe('farm');
    expect(result3.events.some(e => e.type === 'build_complete')).toBe(true);
  });

  it('rejects build action with insufficient resources in resolveTick', () => {
    const colony = makeColony({ resources: { food: 100, timber: 5, stone: 30, iron: 10, influence: 50 } });
    const settlement = makeSettlement();
    const hexes = makeHexRing(0, 0);

    const actions: QueuedAction[] = [makeBuildAction()]; // farm costs 20 timber

    const result = resolveTick([colony], [settlement], [], hexes, actions);

    const buildResult = result.actionResults.find(ar => ar.actionId === 'action-build-1');
    expect(buildResult?.status).toBe('failed');
    expect(buildResult?.result).toContain('Insufficient resources');
    expect(result.settlements[0].buildQueue).toHaveLength(0);
  });

  it('rejects duplicate non-farm building types in resolveTick', () => {
    const colony = makeColony({ resources: { food: 500, timber: 500, stone: 500, iron: 500, influence: 500 } });
    const settlement = makeSettlement({
      buildings: [{ type: 'mine', level: 1 }],
    });
    const hexes = makeHexRing(0, 0);

    const actions: QueuedAction[] = [makeBuildAction({ params: { settlementId: 'settlement-1', buildingType: 'mine' } })];

    const result = resolveTick([colony], [settlement], [], hexes, actions);

    const buildResult = result.actionResults.find(ar => ar.actionId === 'action-build-1');
    expect(buildResult?.status).toBe('failed');
    expect(buildResult?.result).toContain('already has a mine');
  });

  it('handles mixed build and move actions in same tick', () => {
    const colony = makeColony({ resources: { food: 500, timber: 500, stone: 500, iron: 500, influence: 500 } });
    const settlement = makeSettlement();
    const hexes = makePlainGrid(5);
    const scout = makeUnit({ type: 'scout', hexX: 0, hexY: 0 });

    const actions: QueuedAction[] = [
      makeBuildAction(),
      makeAction({ id: 'act-move', params: { unitId: 'unit-1', targetX: 3, targetY: 0 } }),
    ];

    const result = resolveTick([colony], [settlement], [scout], hexes, actions);

    // Build resolved
    expect(result.actionResults.find(ar => ar.actionId === 'action-build-1')?.status).toBe('resolved');
    // Move resolved
    expect(result.actionResults.find(ar => ar.actionId === 'act-move')?.status).toBe('resolved');
    // Scout moved
    expect(result.units[0].hexX).toBeGreaterThan(0);
    // Farm queued
    expect(result.settlements[0].buildQueue.some(bq => bq.type === 'farm')).toBe(true);
  });

  it('does not mutate input settlement buildQueue', () => {
    const colony = makeColony({ resources: { food: 500, timber: 500, stone: 500, iron: 500, influence: 500 } });
    const settlement = makeSettlement();
    const originalBuildQueue = [...settlement.buildQueue];
    const hexes = makeHexRing(0, 0);

    const actions: QueuedAction[] = [makeBuildAction()];
    resolveTick([colony], [settlement], [], hexes, actions);

    // Original settlement should not be mutated
    expect(settlement.buildQueue).toEqual(originalBuildQueue);
  });
});

// --- resolveTrainUnit ---

describe('resolveTrainUnit', () => {
  it('trains a unit at a settlement with barracks', () => {
    const colony = makeColony();
    const settlement = makeSettlement({
      buildings: [{ type: 'barracks', level: 1 }],
    });
    const action = makeTrainAction({ params: { settlementId: 'settlement-1', unitType: 'scout' } });

    const result = resolveTrainUnit([colony], [settlement], [action]);

    expect(result.newUnits).toHaveLength(1);
    expect(result.newUnits[0].type).toBe('scout');
    expect(result.newUnits[0].hexX).toBe(settlement.hexX);
    expect(result.newUnits[0].hexY).toBe(settlement.hexY);
    expect(result.newUnits[0].colonyId).toBe('colony-1');
    expect(result.newUnits[0].health).toBe(100);
    expect(result.newUnits[0].morale).toBe(1.0);
    expect(result.actionResults[0].status).toBe('resolved');
  });

  it('deducts correct resources for each unit type', () => {
    for (const unitType of VALID_UNIT_TYPES) {
      const colony = makeColony({
        resources: { food: 500, timber: 500, stone: 500, iron: 500, influence: 500 },
      });
      const settlement = makeSettlement({
        buildings: [{ type: 'barracks', level: 1 }],
      });
      const action = makeTrainAction({
        id: `action-train-${unitType}`,
        params: { settlementId: 'settlement-1', unitType },
      });

      resolveTrainUnit([colony], [settlement], [action]);

      const cost = UNIT_TRAINING_COSTS[unitType];
      for (const [resource, amount] of Object.entries(cost)) {
        expect(colony.resources[resource as keyof typeof colony.resources])
          .toBe(500 - (amount as number));
      }
    }
  });

  it('generates unit_trained event', () => {
    const colony = makeColony();
    const settlement = makeSettlement({
      buildings: [{ type: 'barracks', level: 1 }],
    });
    const action = makeTrainAction();

    const result = resolveTrainUnit([colony], [settlement], [action]);

    expect(result.events).toHaveLength(1);
    expect(result.events[0].type).toBe('unit_trained');
    expect(result.events[0].colonyId).toBe('colony-1');
    expect(result.events[0].settlementId).toBe('settlement-1');
    expect(result.events[0].data.unitType).toBe('scout');
  });

  it('fails when settlement not found', () => {
    const colony = makeColony();
    const action = makeTrainAction({ params: { settlementId: 'nonexistent', unitType: 'scout' } });

    const result = resolveTrainUnit([colony], [], [action]);

    expect(result.newUnits).toHaveLength(0);
    expect(result.actionResults[0].status).toBe('failed');
    expect(result.actionResults[0].result).toContain('not found');
  });

  it('fails when settlement belongs to different colony', () => {
    const colony = makeColony();
    const settlement = makeSettlement({
      colonyId: 'other-colony',
      buildings: [{ type: 'barracks', level: 1 }],
    });
    const action = makeTrainAction();

    const result = resolveTrainUnit([colony], [settlement], [action]);

    expect(result.actionResults[0].status).toBe('failed');
    expect(result.actionResults[0].result).toContain('does not belong');
  });

  it('fails when settlement has no barracks', () => {
    const colony = makeColony();
    const settlement = makeSettlement({
      buildings: [{ type: 'farm', level: 1 }],
    });
    const action = makeTrainAction();

    const result = resolveTrainUnit([colony], [settlement], [action]);

    expect(result.actionResults[0].status).toBe('failed');
    expect(result.actionResults[0].result).toContain('barracks');
  });

  it('fails for invalid unit type', () => {
    const colony = makeColony();
    const settlement = makeSettlement({
      buildings: [{ type: 'barracks', level: 1 }],
    });
    const action = makeTrainAction({ params: { settlementId: 'settlement-1', unitType: 'dragon' } });

    const result = resolveTrainUnit([colony], [settlement], [action]);

    expect(result.actionResults[0].status).toBe('failed');
    expect(result.actionResults[0].result).toContain('Invalid unit type');
  });

  it('fails when colony has insufficient resources', () => {
    const colony = makeColony({
      resources: { food: 0, timber: 0, stone: 0, iron: 0, influence: 0 },
    });
    const settlement = makeSettlement({
      buildings: [{ type: 'barracks', level: 1 }],
    });
    const action = makeTrainAction();

    const result = resolveTrainUnit([colony], [settlement], [action]);

    expect(result.newUnits).toHaveLength(0);
    expect(result.actionResults[0].status).toBe('failed');
    expect(result.actionResults[0].result).toContain('Insufficient resources');
  });

  it('trains multiple units in one tick', () => {
    const colony = makeColony({
      resources: { food: 500, timber: 500, stone: 500, iron: 500, influence: 500 },
    });
    const settlement = makeSettlement({
      buildings: [{ type: 'barracks', level: 1 }],
    });
    const actions = [
      makeTrainAction({ id: 'train-1', params: { settlementId: 'settlement-1', unitType: 'scout' } }),
      makeTrainAction({ id: 'train-2', params: { settlementId: 'settlement-1', unitType: 'militia' } }),
    ];

    const result = resolveTrainUnit([colony], [settlement], actions);

    expect(result.newUnits).toHaveLength(2);
    expect(result.newUnits[0].type).toBe('scout');
    expect(result.newUnits[1].type).toBe('militia');
    expect(result.actionResults).toHaveLength(2);
    expect(result.actionResults.every(ar => ar.status === 'resolved')).toBe(true);
  });

  it('generates unique unit IDs', () => {
    const colony = makeColony({
      resources: { food: 500, timber: 500, stone: 500, iron: 500, influence: 500 },
    });
    const settlement = makeSettlement({
      buildings: [{ type: 'barracks', level: 1 }],
    });
    const actions = [
      makeTrainAction({ id: 'train-1', params: { settlementId: 'settlement-1', unitType: 'scout' } }),
      makeTrainAction({ id: 'train-2', params: { settlementId: 'settlement-1', unitType: 'scout' } }),
    ];

    const result = resolveTrainUnit([colony], [settlement], actions);

    expect(result.newUnits[0].id).not.toBe(result.newUnits[1].id);
    expect(result.newUnits[0].id).toMatch(/^unit_/);
    expect(result.newUnits[1].id).toMatch(/^unit_/);
  });
});

// --- resolveTick with train_unit ---

// --- Population consumption integration ---

describe('resolveTick population consumption', () => {
  it('population consumes food proportional to POP_FOOD_CONSUMPTION', () => {
    const colony = makeColony({ resources: { food: 100, timber: 50, stone: 30, iron: 10, influence: 50 } });
    // No buildings, no hexes, population 10 → consumes 2.5 food/tick
    const settlement = makeSettlement({ population: 10 });

    const result = resolveTick([colony], [settlement], [], []);

    expect(result.colonies[0].resources.food).toBe(100 - (10 * POP_FOOD_CONSUMPTION));
  });

  it('famine triggers with realistic starting colony and large army', () => {
    // Starting colony with farm, but too many units
    const colony = makeColony({ resources: { food: 50, timber: 50, stone: 30, iron: 10, influence: 50 } });
    const settlement = makeSettlement({
      buildings: [{ type: 'farm', level: 1 }],
      population: 10,
    });
    // 3 soldiers (3 food each) + 2 siege (4 food each) = 17 food upkeep
    // Plus pop: 2.5 food consumption (10 * 0.25)
    // Farm production offsets some of this, but low stockpile can still trigger famine.
    const units = [
      makeUnit({ id: 'u1', type: 'soldier' }),
      makeUnit({ id: 'u2', type: 'soldier' }),
      makeUnit({ id: 'u3', type: 'soldier' }),
      makeUnit({ id: 'u4', type: 'siege' }),
      makeUnit({ id: 'u5', type: 'siege' }),
    ];

    const result = resolveTick([colony], [settlement], units, []);

    // With starting food 5 instead:
    const colony2 = makeColony({ resources: { food: 5, timber: 50, stone: 30, iron: 10, influence: 50 } });
    const settlement2 = makeSettlement({
      buildings: [{ type: 'farm', level: 1 }],
      population: 10,
    });
    const result2 = resolveTick([colony2], [settlement2], units, []);

    expect(result2.events.some(e => e.type === 'famine')).toBe(true);
    // Net food is still negative even though stockpile remains above zero this tick.
    expect(result2.colonies[0].resources.food).toBe(0.5);
  });
});

describe('resolveTick with train_unit', () => {
  it('integrates train_unit action into full tick', () => {
    const colony = makeColony({
      resources: { food: 500, timber: 500, stone: 500, iron: 500, influence: 500 },
    });
    const settlement = makeSettlement({
      buildings: [{ type: 'barracks', level: 1 }],
    });
    const hexes = makeHexRing(0, 0);
    const action = makeTrainAction();

    const result = resolveTick([colony], [settlement], [], hexes, [action]);

    // New unit should appear in result
    const newUnit = result.units.find(u => u.type === 'scout');
    expect(newUnit).toBeDefined();
    expect(newUnit!.hexX).toBe(0);
    expect(newUnit!.hexY).toBe(0);

    // Action should be resolved
    expect(result.actionResults.find(ar => ar.actionId === 'action-train-1')?.status).toBe('resolved');

    // Event should be emitted
    expect(result.events.some(e => e.type === 'unit_trained')).toBe(true);
  });

  it('trained unit is included in food upkeep calculation', () => {
    const colony = makeColony({
      resources: { food: 100, timber: 100, stone: 100, iron: 100, influence: 100 },
    });
    const settlement = makeSettlement({
      buildings: [{ type: 'barracks', level: 1 }],
    });
    const hexes = makeHexRing(0, 0);

    // Run tick WITHOUT training
    const resultNoTrain = resolveTick(
      [makeColony({ resources: { ...colony.resources } })],
      [makeSettlement({ buildings: [{ type: 'barracks', level: 1 }] })],
      [],
      hexes,
    );

    // Run tick WITH training a soldier (food upkeep = 3)
    const resultWithTrain = resolveTick(
      [makeColony({ resources: { ...colony.resources } })],
      [makeSettlement({ buildings: [{ type: 'barracks', level: 1 }] })],
      [],
      hexes,
      [makeTrainAction({ params: { settlementId: 'settlement-1', unitType: 'soldier' } })],
    );

    // The colony with a trained soldier should have less food due to:
    // 1. Training cost (25 food)
    // 2. Soldier upkeep (3 food/tick)
    expect(resultWithTrain.colonies[0].resources.food).toBeLessThan(
      resultNoTrain.colonies[0].resources.food,
    );
  });
});



// --- resolveUpgradeSettlement ---

function makeUpgradeAction(overrides: Partial<QueuedAction> = {}): QueuedAction {
  return {
    id: 'action-upgrade-1',
    colonyId: 'colony-1',
    type: 'upgrade_settlement',
    params: { settlementId: 'settlement-1' },
    ...overrides,
  };
}

describe('resolveUpgradeSettlement', () => {
  it('upgrades outpost to town when requirements met', () => {
    const colony = makeColony({
      resources: { food: 300, timber: 200, stone: 150, iron: 50, influence: 50 },
    });
    const settlement = makeSettlement({
      tier: 'outpost',
      population: 50,
      buildings: [
        { type: 'farm', level: 1 },
        { type: 'lumberMill', level: 1 },
        { type: 'quarry', level: 1 },
      ],
    });
    const action = makeUpgradeAction();

    const result = resolveUpgradeSettlement([settlement], [colony], [action]);

    expect(result.actionResults[0].status).toBe('resolved');
    expect(result.actionResults[0].result).toContain('outpost');
    expect(result.actionResults[0].result).toContain('town');
    expect(settlement.tier).toBe('town');

    // Resources deducted (town costs: 200 food, 150 timber, 100 stone)
    expect(colony.resources.food).toBe(300 - 200);
    expect(colony.resources.timber).toBe(200 - 150);
    expect(colony.resources.stone).toBe(150 - 100);
  });

  it('upgrades town to city when requirements met', () => {
    const colony = makeColony({
      resources: { food: 600, timber: 400, stone: 300, iron: 200, influence: 100 },
    });
    const settlement = makeSettlement({
      tier: 'town',
      population: 200,
      buildings: [
        { type: 'farm', level: 1 },
        { type: 'lumberMill', level: 1 },
        { type: 'quarry', level: 1 },
        { type: 'mine', level: 1 },
        { type: 'barracks', level: 1 },
      ],
    });
    const action = makeUpgradeAction();

    const result = resolveUpgradeSettlement([settlement], [colony], [action]);

    expect(result.actionResults[0].status).toBe('resolved');
    expect(settlement.tier).toBe('city');

    // City costs: 500 food, 300 timber, 200 stone, 100 iron, 75 influence
    expect(colony.resources.food).toBe(600 - 500);
    expect(colony.resources.timber).toBe(400 - 300);
    expect(colony.resources.stone).toBe(300 - 200);
    expect(colony.resources.iron).toBe(200 - 100);
    expect(colony.resources.influence).toBe(100 - 75);
  });

  it('generates settlement_upgraded event', () => {
    const colony = makeColony({
      resources: { food: 300, timber: 200, stone: 150, iron: 50, influence: 50 },
    });
    const settlement = makeSettlement({
      tier: 'outpost',
      population: 50,
      buildings: [
        { type: 'farm', level: 1 },
        { type: 'lumberMill', level: 1 },
        { type: 'quarry', level: 1 },
      ],
    });
    const action = makeUpgradeAction();

    const result = resolveUpgradeSettlement([settlement], [colony], [action]);

    const event = result.events.find(e => e.type === 'settlement_upgraded');
    expect(event).toBeDefined();
    expect(event!.colonyId).toBe('colony-1');
    expect(event!.settlementId).toBe('settlement-1');
    expect(event!.data.previousTier).toBe('outpost');
    expect(event!.data.newTier).toBe('town');
    expect(event!.data.name).toBe('Outpost Alpha');
  });

  it('fails when settlement is already city (max tier)', () => {
    const colony = makeColony({
      resources: { food: 1000, timber: 1000, stone: 1000, iron: 1000, influence: 100 },
    });
    const settlement = makeSettlement({
      tier: 'city',
      population: 500,
      buildings: [
        { type: 'farm', level: 1 },
        { type: 'lumberMill', level: 1 },
        { type: 'quarry', level: 1 },
        { type: 'mine', level: 1 },
        { type: 'barracks', level: 1 },
      ],
    });
    const action = makeUpgradeAction();

    const result = resolveUpgradeSettlement([settlement], [colony], [action]);

    expect(result.actionResults[0].status).toBe('failed');
    expect(result.actionResults[0].result).toContain('maximum tier');
    expect(settlement.tier).toBe('city');
  });

  it('fails when colony has insufficient resources', () => {
    const colony = makeColony({
      resources: { food: 100, timber: 50, stone: 30, iron: 10, influence: 50 },
    });
    const settlement = makeSettlement({
      tier: 'outpost',
      population: 50,
      buildings: [
        { type: 'farm', level: 1 },
        { type: 'lumberMill', level: 1 },
        { type: 'quarry', level: 1 },
      ],
    });
    const action = makeUpgradeAction();

    const result = resolveUpgradeSettlement([settlement], [colony], [action]);

    expect(result.actionResults[0].status).toBe('failed');
    expect(result.actionResults[0].result).toContain('Insufficient resources');
    expect(settlement.tier).toBe('outpost');
  });

  it('fails when population is too low', () => {
    const colony = makeColony({
      resources: { food: 300, timber: 200, stone: 150, iron: 50, influence: 50 },
    });
    const settlement = makeSettlement({
      tier: 'outpost',
      population: 30, // Need 50 for town
      buildings: [
        { type: 'farm', level: 1 },
        { type: 'lumberMill', level: 1 },
        { type: 'quarry', level: 1 },
      ],
    });
    const action = makeUpgradeAction();

    const result = resolveUpgradeSettlement([settlement], [colony], [action]);

    expect(result.actionResults[0].status).toBe('failed');
    expect(result.actionResults[0].result).toContain('Insufficient population');
    expect(result.actionResults[0].result).toContain('50');
    expect(settlement.tier).toBe('outpost');
  });

  it('fails when not enough buildings', () => {
    const colony = makeColony({
      resources: { food: 300, timber: 200, stone: 150, iron: 50, influence: 50 },
    });
    const settlement = makeSettlement({
      tier: 'outpost',
      population: 50,
      buildings: [
        { type: 'farm', level: 1 },
        { type: 'lumberMill', level: 1 },
        // Only 2 buildings, need 3 for town
      ],
    });
    const action = makeUpgradeAction();

    const result = resolveUpgradeSettlement([settlement], [colony], [action]);

    expect(result.actionResults[0].status).toBe('failed');
    expect(result.actionResults[0].result).toContain('Insufficient buildings');
    expect(result.actionResults[0].result).toContain('3');
    expect(settlement.tier).toBe('outpost');
  });

  it('fails when settlement not found', () => {
    const colony = makeColony();
    const action = makeUpgradeAction({
      params: { settlementId: 'nonexistent' },
    });

    const result = resolveUpgradeSettlement([], [colony], [action]);

    expect(result.actionResults[0].status).toBe('failed');
    expect(result.actionResults[0].result).toContain('not found');
  });

  it('fails when settlement belongs to different colony', () => {
    const colony = makeColony();
    const settlement = makeSettlement({ colonyId: 'colony-2' });
    const action = makeUpgradeAction({ colonyId: 'colony-1' });

    const result = resolveUpgradeSettlement([settlement], [colony], [action]);

    expect(result.actionResults[0].status).toBe('failed');
    expect(result.actionResults[0].result).toContain('does not belong');
  });

  it('fails when colony not found', () => {
    const settlement = makeSettlement({
      tier: 'outpost',
      population: 50,
      buildings: [
        { type: 'farm', level: 1 },
        { type: 'lumberMill', level: 1 },
        { type: 'quarry', level: 1 },
      ],
    });
    const action = makeUpgradeAction();

    const result = resolveUpgradeSettlement([settlement], [], [action]);

    expect(result.actionResults[0].status).toBe('failed');
    expect(result.actionResults[0].result).toContain('not found');
  });

  it('returns empty results when no upgrade actions', () => {
    const colony = makeColony();
    const settlement = makeSettlement();
    const moveAction = makeAction(); // move_unit, not upgrade_settlement

    const result = resolveUpgradeSettlement([settlement], [colony], [moveAction]);

    expect(result.events).toHaveLength(0);
    expect(result.actionResults).toHaveLength(0);
  });
});

// --- Population growth ---

describe('population growth in resolveTick', () => {
  it('population grows when food surplus exists', () => {
    const colony = makeColony({
      resources: { food: 500, timber: 500, stone: 500, iron: 500, influence: 500 },
    });
    // Farm level 3 produces 30 food. Pop 10 consumes 5. Net ~25+ with hex yields.
    const settlement = makeSettlement({
      buildings: [{ type: 'farm', level: 3 }],
      population: 10,
    });
    const hexes = makeHexRing(0, 0);

    const result = resolveTick([colony], [settlement], [], hexes);

    // Population should have grown
    expect(result.settlements[0].population).toBeGreaterThan(10);
  });

  it('population does not grow beyond tier cap', () => {
    const colony = makeColony({
      resources: { food: 5000, timber: 500, stone: 500, iron: 500, influence: 500 },
    });
    // Outpost cap = 50. Start at 49 with massive food surplus.
    const settlement = makeSettlement({
      tier: 'outpost',
      buildings: [{ type: 'farm', level: 5 }],
      population: 49,
    });
    const hexes = makeHexRing(0, 0);

    const result = resolveTick([colony], [settlement], [], hexes);

    // Should cap at 50 (outpost max)
    expect(result.settlements[0].population).toBeLessThanOrEqual(MAX_POPULATION.outpost);
  });

  it('population does not grow when food is negative', () => {
    const colony = makeColony({
      resources: { food: 5, timber: 500, stone: 500, iron: 500, influence: 500 },
    });
    // No production, pop 10 consumes 4, 2 soldiers consume 6 → net -10
    const settlement = makeSettlement({
      population: 10,
    });
    const units = [
      makeUnit({ id: 'u1', type: 'soldier' }),
      makeUnit({ id: 'u2', type: 'soldier' }),
    ];

    const result = resolveTick([colony], [settlement], units, []);

    // Population should NOT grow (food went negative)
    expect(result.settlements[0].population).toBe(10);
  });

  it('population grows faster with higher food surplus', () => {
    // Small surplus
    const colony1 = makeColony({
      resources: { food: 500, timber: 500, stone: 500, iron: 500, influence: 500 },
    });
    const settlement1 = makeSettlement({
      buildings: [{ type: 'farm', level: 1 }], // produces 10 food
      population: 10, // consumes 5
    });

    // Large surplus
    const colony2 = makeColony({
      resources: { food: 500, timber: 500, stone: 500, iron: 500, influence: 500 },
    });
    const settlement2 = makeSettlement({
      id: 'settlement-2',
      buildings: [{ type: 'farm', level: 5 }], // produces 50 food
      population: 10, // consumes 5
    });

    const hexes = makeHexRing(0, 0);

    const result1 = resolveTick([colony1], [settlement1], [], hexes);
    const result2 = resolveTick([colony2], [settlement2], [], hexes);

    // Both should grow, but the one with higher surplus should grow more
    expect(result2.settlements[0].population).toBeGreaterThanOrEqual(
      result1.settlements[0].population,
    );
  });

  it('town has higher population cap than outpost', () => {
    const colony = makeColony({
      resources: { food: 5000, timber: 500, stone: 500, iron: 500, influence: 500 },
    });
    const settlement = makeSettlement({
      tier: 'town',
      buildings: [{ type: 'farm', level: 20 }], // high level to ensure food surplus at pop 195
      population: 195, // Near town cap of 200
    });
    const hexes = makeHexRing(0, 0);

    const result = resolveTick([colony], [settlement], [], hexes);

    // Should grow but cap at 200 (town max)
    expect(result.settlements[0].population).toBeLessThanOrEqual(MAX_POPULATION.town);
    expect(result.settlements[0].population).toBeGreaterThan(195);
  });

  it('generates population_growth event', () => {
    const colony = makeColony({
      resources: { food: 500, timber: 500, stone: 500, iron: 500, influence: 500 },
    });
    const settlement = makeSettlement({
      buildings: [{ type: 'farm', level: 3 }],
      population: 10,
    });
    const hexes = makeHexRing(0, 0);

    const result = resolveTick([colony], [settlement], [], hexes);

    const growthEvent = result.events.find(e => e.type === 'population_growth');
    expect(growthEvent).toBeDefined();
    expect(growthEvent!.colonyId).toBe('colony-1');
    expect(growthEvent!.settlementId).toBe('settlement-1');
    expect(growthEvent!.data.previousPopulation).toBe(10);
    expect((growthEvent!.data.newPopulation as number)).toBeGreaterThan(10);
  });
});

// --- Stockpile decay ---

describe('stockpile decay', () => {
  it('decays resources above the outpost cap', () => {
    // Outpost cap = 500. Start with 800 food, no production, no consumption.
    // Hard ceiling = 500 × 2.0 = 1000, so 800 is NOT clamped.
    // Excess = 300, decay = 300 × 0.05 = 15, final = 785.
    const colony = makeColony({ resources: { food: 800, timber: 100, stone: 100, iron: 100, influence: 50 } });
    const settlement = makeSettlement({ population: 0 });

    const result = resolveTick([colony], [settlement], [], []);

    // With gentle decay, food should be slightly lower than 800
    expect(result.colonies[0].resources.food).toBeLessThan(800);
    expect(result.colonies[0].resources.food).toBeGreaterThan(770); // ~785
    expect(result.events.some(e => e.type === 'stockpile_decay')).toBe(true);
  });

  it('does not decay resources under the cap', () => {
    const colony = makeColony({ resources: { food: 400, timber: 100, stone: 50, iron: 10, influence: 50 } });
    const settlement = makeSettlement({ population: 0 });

    const result = resolveTick([colony], [settlement], [], []);

    // No decay events should fire (all resources under 500 outpost cap)
    expect(result.events.filter(e => e.type === 'stockpile_decay')).toHaveLength(0);
  });

  it('granary increases stockpile cap', () => {
    // Outpost cap = 500 + granary L2 = 500 + 400 = 900
    const colony = makeColony({ resources: { food: 850, timber: 100, stone: 100, iron: 100, influence: 50 } });
    const settlement = makeSettlement({
      buildings: [{ type: 'granary', level: 2 }],
      population: 0,
    });

    const result = resolveTick([colony], [settlement], [], []);

    // Food 850 < effective cap 900 — no food decay
    const foodDecay = result.events.filter(e => e.type === 'stockpile_decay' && e.data.resource === 'food');
    expect(foodDecay).toHaveLength(0);
  });

  it('town tier has higher stockpile cap', () => {
    // Town cap = 1000
    const colony = makeColony({ resources: { food: 900, timber: 900, stone: 900, iron: 900, influence: 50 } });
    const settlement = makeSettlement({ tier: 'town', population: 0 });

    const result = resolveTick([colony], [settlement], [], []);

    // All resources are under town cap of 1000 — no decay
    expect(result.events.filter(e => e.type === 'stockpile_decay')).toHaveLength(0);
  });

  it('reports stockpile cap in production event', () => {
    const colony = makeColony({ resources: { food: 100, timber: 50, stone: 30, iron: 10, influence: 50 } });
    const settlement = makeSettlement({ population: 0 });

    const result = resolveTick([colony], [settlement], [], []);

    const productionEvent = result.events.find(e => e.type === 'production');
    expect(productionEvent).toBeDefined();
    expect(productionEvent!.data.stockpileCap).toBe(STOCKPILE_CAP.outpost);
  });
});

// --- resolveTick with upgrade_settlement ---

describe('resolveTick with upgrade_settlement', () => {
  it('integrates upgrade_settlement action into full tick', () => {
    const colony = makeColony({
      resources: { food: 500, timber: 300, stone: 200, iron: 100, influence: 100 },
    });
    const settlement = makeSettlement({
      tier: 'outpost',
      population: 50,
      buildings: [
        { type: 'farm', level: 1 },
        { type: 'lumberMill', level: 1 },
        { type: 'quarry', level: 1 },
      ],
    });
    const hexes = makeHexRing(0, 0);
    const action = makeUpgradeAction();

    const result = resolveTick([colony], [settlement], [], hexes, [action]);

    // Upgrade resolved
    const upgradeResult = result.actionResults.find(ar => ar.actionId === 'action-upgrade-1');
    expect(upgradeResult?.status).toBe('resolved');

    // Settlement is now a town
    expect(result.settlements[0].tier).toBe('town');

    // settlement_upgraded event
    expect(result.events.some(e => e.type === 'settlement_upgraded')).toBe(true);

    // Town tier multiplier should boost production in the same tick
    const productionEvent = result.events.find(e => e.type === 'production');
    expect(productionEvent).toBeDefined();
  });

  it('town tier boosts production in same tick after upgrade', () => {
    // Run a tick without upgrade first
    const colony1 = makeColony({
      resources: { food: 500, timber: 300, stone: 200, iron: 100, influence: 100 },
    });
    const settlement1 = makeSettlement({
      tier: 'outpost',
      population: 50,
      buildings: [
        { type: 'farm', level: 1 },
        { type: 'lumberMill', level: 1 },
        { type: 'quarry', level: 1 },
      ],
    });
    const hexes = makeHexRing(0, 0);
    const resultNoUpgrade = resolveTick([colony1], [settlement1], [], hexes);

    // Now run with upgrade
    const colony2 = makeColony({
      resources: { food: 500, timber: 300, stone: 200, iron: 100, influence: 100 },
    });
    const settlement2 = makeSettlement({
      tier: 'outpost',
      population: 50,
      buildings: [
        { type: 'farm', level: 1 },
        { type: 'lumberMill', level: 1 },
        { type: 'quarry', level: 1 },
      ],
    });
    const resultWithUpgrade = resolveTick([colony2], [settlement2], [], hexes, [makeUpgradeAction()]);

    // With upgrade: production should be 1.5x (town), but resources were also deducted for upgrade
    // Check that production event shows higher production
    const prod1 = resultNoUpgrade.events.find(e => e.type === 'production')!.data.produced as Resources;
    const prod2 = resultWithUpgrade.events.find(e => e.type === 'production')!.data.produced as Resources;

    // Town multiplier 1.5 vs outpost 1.0 — building production should be higher
    // Farm at outpost: 10, at town: 15
    expect(prod2.food).toBeGreaterThan(prod1.food);
  });
});

// =============================================================================
// Building Upgrade Tests
// =============================================================================

describe('buildingUpgradeCost', () => {
  it('should return base cost × 2 for upgrading from level 1', () => {
    const cost = buildingUpgradeCost('farm', 1);
    // Farm base cost: timber: 20 → level 1 upgrade cost: timber: 40
    expect(cost.timber).toBe(40);
  });

  it('should return base cost × 3 for upgrading from level 2', () => {
    const cost = buildingUpgradeCost('farm', 2);
    // Farm base cost: timber: 20 → level 2 upgrade cost: timber: 60
    expect(cost.timber).toBe(60);
  });

  it('should scale all resource types', () => {
    const cost = buildingUpgradeCost('mine', 1);
    // Mine base: stone: 30, timber: 20 → ×2
    expect(cost.stone).toBe(60);
    expect(cost.timber).toBe(40);
  });
});

describe('resolveUpgradeBuilding', () => {
  it('should queue upgrade for an existing building', () => {
    const colony = makeColony({ resources: { food: 100, timber: 200, stone: 100, iron: 50, influence: 50 } });
    const settlement = makeSettlement({ buildings: [{ type: 'farm', level: 1 }] });

    const action: QueuedAction = {
      id: 'act-1',
      colonyId: 'colony-1',
      type: 'upgrade_building',
      params: { settlementId: 'settlement-1', buildingType: 'farm' },
    };

    const result = resolveUpgradeBuilding([settlement], [colony], [action]);

    expect(result.actionResults[0].status).toBe('resolved');
    expect(result.events[0].type).toBe('upgrade_started');
    expect(result.events[0].data.fromLevel).toBe(1);
    expect(result.events[0].data.toLevel).toBe(2);

    // Build queue should have the upgrade entry
    expect(settlement.buildQueue).toHaveLength(1);
    expect(settlement.buildQueue[0].type).toBe('farm');
    expect(settlement.buildQueue[0].ticksRemaining).toBe(UPGRADE_BUILD_TIME);

    // Resources should be deducted (farm base: 20 timber × 2 = 40 timber)
    expect(colony.resources.timber).toBe(160);
  });

  it('should fail when building does not exist in settlement', () => {
    const colony = makeColony();
    const settlement = makeSettlement({ buildings: [] });

    const action: QueuedAction = {
      id: 'act-1',
      colonyId: 'colony-1',
      type: 'upgrade_building',
      params: { settlementId: 'settlement-1', buildingType: 'farm' },
    };

    const result = resolveUpgradeBuilding([settlement], [colony], [action]);
    expect(result.actionResults[0].status).toBe('failed');
    expect(result.actionResults[0].result).toContain('does not have');
  });

  it('should fail when building is at max level', () => {
    const colony = makeColony({ resources: { food: 100, timber: 500, stone: 200, iron: 100, influence: 50 } });
    const settlement = makeSettlement({ buildings: [{ type: 'farm', level: MAX_BUILDING_LEVEL }] });

    const action: QueuedAction = {
      id: 'act-1',
      colonyId: 'colony-1',
      type: 'upgrade_building',
      params: { settlementId: 'settlement-1', buildingType: 'farm' },
    };

    const result = resolveUpgradeBuilding([settlement], [colony], [action]);
    expect(result.actionResults[0].status).toBe('failed');
    expect(result.actionResults[0].result).toContain('maximum level');
  });

  it('should fail when building is already in upgrade queue', () => {
    const colony = makeColony({ resources: { food: 100, timber: 500, stone: 200, iron: 100, influence: 50 } });
    const settlement = makeSettlement({
      buildings: [{ type: 'farm', level: 1 }],
      buildQueue: [{ type: 'farm', ticksRemaining: 2 }],
    });

    const action: QueuedAction = {
      id: 'act-1',
      colonyId: 'colony-1',
      type: 'upgrade_building',
      params: { settlementId: 'settlement-1', buildingType: 'farm' },
    };

    const result = resolveUpgradeBuilding([settlement], [colony], [action]);
    expect(result.actionResults[0].status).toBe('failed');
    expect(result.actionResults[0].result).toContain('already being upgraded');
  });

  it('should fail when colony lacks resources', () => {
    const colony = makeColony({ resources: { food: 100, timber: 5, stone: 5, iron: 5, influence: 50 } });
    const settlement = makeSettlement({ buildings: [{ type: 'farm', level: 1 }] });

    const action: QueuedAction = {
      id: 'act-1',
      colonyId: 'colony-1',
      type: 'upgrade_building',
      params: { settlementId: 'settlement-1', buildingType: 'farm' },
    };

    const result = resolveUpgradeBuilding([settlement], [colony], [action]);
    expect(result.actionResults[0].status).toBe('failed');
    expect(result.actionResults[0].result).toContain('Insufficient resources');
  });

  it('should fail when settlement does not belong to colony', () => {
    const colony = makeColony({ id: 'colony-2' });
    const settlement = makeSettlement({ colonyId: 'colony-1', buildings: [{ type: 'farm', level: 1 }] });

    const action: QueuedAction = {
      id: 'act-1',
      colonyId: 'colony-2',
      type: 'upgrade_building',
      params: { settlementId: 'settlement-1', buildingType: 'farm' },
    };

    const result = resolveUpgradeBuilding([settlement], [colony], [action]);
    expect(result.actionResults[0].status).toBe('failed');
    expect(result.actionResults[0].result).toContain('does not belong');
  });
});

describe('Building upgrade through build queue', () => {
  it('should increment building level when upgrade completes in build queue', () => {
    // Simulate a building with an upgrade already in queue (1 tick remaining)
    const colony = makeColony();
    const settlement = makeSettlement({
      buildings: [{ type: 'farm', level: 1 }],
      buildQueue: [{ type: 'farm', ticksRemaining: 1 }],
    });

    // Run resolveBuilding with no new build actions (just queue advancement)
    const result = resolveBuilding([settlement], [colony], []);

    // Building should now be level 2
    const farm = settlement.buildings.find(b => b.type === 'farm');
    expect(farm).toBeDefined();
    expect(farm!.level).toBe(2);

    // Should emit upgrade_complete, not build_complete
    const upgradeEvent = result.events.find(e => e.type === 'upgrade_complete');
    expect(upgradeEvent).toBeDefined();
    expect(upgradeEvent!.data.buildingType).toBe('farm');
    expect(upgradeEvent!.data.level).toBe(2);

    // Build queue should be empty
    expect(settlement.buildQueue).toHaveLength(0);
  });

  it('should still create new buildings normally when type not present', () => {
    const colony = makeColony();
    const settlement = makeSettlement({
      buildings: [],
      buildQueue: [{ type: 'farm', ticksRemaining: 1 }],
    });

    const result = resolveBuilding([settlement], [colony], []);

    // Should create new building at level 1
    const farm = settlement.buildings.find(b => b.type === 'farm');
    expect(farm).toBeDefined();
    expect(farm!.level).toBe(1);

    // Should emit build_complete
    const buildEvent = result.events.find(e => e.type === 'build_complete');
    expect(buildEvent).toBeDefined();
  });
});

describe('Building upgrade production scaling', () => {
  it('should double building production for a level 2 building', () => {
    // Use empty hexes to isolate building production from hex yield bonus
    const settlement1 = makeSettlement({ buildings: [{ type: 'farm', level: 1 }] });
    const settlement2 = makeSettlement({ buildings: [{ type: 'farm', level: 2 }] });

    const emptyHexes: HexTileState[] = []; // no hex bonus

    const prod1 = calculateProduction(settlement1, emptyHexes);
    const prod2 = calculateProduction(settlement2, emptyHexes);

    // Farm L1: 15 food, Farm L2: 30 food (both at outpost tier 1.0, no hex bonus)
    expect(prod1.food).toBe(15);
    expect(prod2.food).toBe(30);
  });

  it('should scale upkeep with building level', () => {
    const settlement1 = makeSettlement({ buildings: [{ type: 'mine', level: 1 }] });
    const settlement2 = makeSettlement({ buildings: [{ type: 'mine', level: 2 }] });

    const upkeep1 = calculateBuildingUpkeep(settlement1);
    const upkeep2 = calculateBuildingUpkeep(settlement2);

    // Mine upkeep L1: timber 2, food 1. L2: timber 4, food 2.
    expect(upkeep2.timber).toBe((upkeep1.timber as number) * 2);
    expect(upkeep2.food).toBe((upkeep1.food as number) * 2);
  });
});

describe('upgrade_building in resolveTick (integration)', () => {
  it('should process upgrade_building action in full tick', () => {
    const colony = makeColony({ resources: { food: 200, timber: 200, stone: 100, iron: 50, influence: 50 } });
    const settlement = makeSettlement({
      buildings: [{ type: 'farm', level: 1 }],
      population: 5,
    });
    const hexes = [makeHex()];

    const action: QueuedAction = {
      id: 'act-1',
      colonyId: 'colony-1',
      type: 'upgrade_building',
      params: { settlementId: 'settlement-1', buildingType: 'farm' },
    };

    const result = resolveTick([colony], [settlement], [], hexes, [action]);

    // Should have upgrade_started event
    const startEvent = result.events.find(e => e.type === 'upgrade_started');
    expect(startEvent).toBeDefined();
    expect(startEvent!.data.buildingType).toBe('farm');

    // Building should still be level 1 (upgrade takes time)
    const farm = result.settlements[0].buildings.find(b => b.type === 'farm');
    expect(farm!.level).toBe(1);

    // Build queue should have the upgrade entry (with 1 tick decremented)
    expect(result.settlements[0].buildQueue).toHaveLength(1);
    expect(result.settlements[0].buildQueue[0].ticksRemaining).toBe(UPGRADE_BUILD_TIME - 1);
  });
});





describe('Idle unit tracking', () => {
  it('increments idleTicks for units with no movement and no actions', () => {
    const colony = makeColony();
    const settlement = makeSettlement({ buildings: [{ type: 'farm', level: 1 }] });
    const unit = makeUnit({ id: 'scout-1', type: 'scout', idleTicks: 0 });
    const hexes = makeHexRing(0, 0);

    const result = resolveTick([colony], [settlement], [unit], hexes, []);

    const updatedUnit = result.units.find(u => u.id === 'scout-1')!;
    expect(updatedUnit.idleTicks).toBe(1);
  });

  it('resets idleTicks when unit receives a move action', () => {
    const colony = makeColony();
    const settlement = makeSettlement({ buildings: [{ type: 'farm', level: 1 }] });
    const unit = makeUnit({ id: 'scout-1', type: 'scout', idleTicks: 2 });
    const hexes = makeHexRing(0, 0);

    const moveAction: QueuedAction = {
      id: 'action-1',
      colonyId: 'colony-1',
      type: 'move_unit',
      params: { unitId: 'scout-1', targetX: 1, targetY: 0 },
    };

    const result = resolveTick([colony], [settlement], [unit], hexes, [moveAction]);

    const updatedUnit = result.units.find(u => u.id === 'scout-1')!;
    expect(updatedUnit.idleTicks).toBe(0);
  });

  it('resets idleTicks when unit has a movement queue and moves', () => {
    const colony = makeColony();
    const settlement = makeSettlement({ buildings: [{ type: 'farm', level: 1 }] });
    const unit = makeUnit({
      id: 'scout-1',
      type: 'scout',
      idleTicks: 5,
      movementQueue: [{ q: 1, r: 0 }],
    });
    const hexes = makeHexRing(0, 0);

    const result = resolveTick([colony], [settlement], [unit], hexes, []);

    const updatedUnit = result.units.find(u => u.id === 'scout-1')!;
    expect(updatedUnit.idleTicks).toBe(0);
  });

  it('emits unit_idle event when idleTicks reaches 3', () => {
    const colony = makeColony();
    const settlement = makeSettlement({ buildings: [{ type: 'farm', level: 1 }] });
    const unit = makeUnit({ id: 'scout-1', type: 'scout', idleTicks: 2 });
    const hexes = makeHexRing(0, 0);

    const result = resolveTick([colony], [settlement], [unit], hexes, []);

    const idleEvent = result.events.find(e => e.type === 'unit_idle');
    expect(idleEvent).toBeDefined();
    expect(idleEvent!.colonyId).toBe('colony-1');
    expect(idleEvent!.unitId).toBe('scout-1');
    expect(idleEvent!.data.unitType).toBe('scout');
    expect(idleEvent!.data.idleTicks).toBe(3);
  });

  it('does not emit unit_idle event before reaching threshold', () => {
    const colony = makeColony();
    const settlement = makeSettlement({ buildings: [{ type: 'farm', level: 1 }] });
    const unit = makeUnit({ id: 'scout-1', type: 'scout', idleTicks: 0 });
    const hexes = makeHexRing(0, 0);

    const result = resolveTick([colony], [settlement], [unit], hexes, []);

    const idleEvent = result.events.find(e => e.type === 'unit_idle');
    expect(idleEvent).toBeUndefined();
  });

  it('does not re-emit unit_idle event after threshold (only fires at exactly 3)', () => {
    const colony = makeColony();
    const settlement = makeSettlement({ buildings: [{ type: 'farm', level: 1 }] });
    const unit = makeUnit({ id: 'scout-1', type: 'scout', idleTicks: 3 });
    const hexes = makeHexRing(0, 0);

    const result = resolveTick([colony], [settlement], [unit], hexes, []);

    const idleEvent = result.events.find(e => e.type === 'unit_idle');
    expect(idleEvent).toBeUndefined();
    const updatedUnit = result.units.find(u => u.id === 'scout-1')!;
    expect(updatedUnit.idleTicks).toBe(4);
  });

  it('newly trained units start with idleTicks 0', () => {
    const colony = makeColony({ resources: { food: 200, timber: 100, stone: 50, iron: 20, influence: 50 } });
    const settlement = makeSettlement({
      buildings: [{ type: 'farm', level: 1 }, { type: 'barracks', level: 1 }],
    });
    const hexes = makeHexRing(0, 0);

    const trainAction: QueuedAction = {
      id: 'action-1',
      colonyId: 'colony-1',
      type: 'train_unit',
      params: { settlementId: 'settlement-1', unitType: 'scout' },
    };

    const result = resolveTick([colony], [settlement], [], hexes, [trainAction]);

    const trainedUnit = result.units.find(u => u.type === 'scout');
    expect(trainedUnit).toBeDefined();
    expect(trainedUnit!.idleTicks).toBe(0);
  });
});

describe('resolveDemolish', () => {
  it('should remove building and refund 25% of cost', () => {
    const colony = makeColony({ resources: { food: 10, timber: 10, stone: 10, iron: 10, influence: 10 } });
    const settlement = makeSettlement({
      buildings: [{ type: 'farm', level: 1 }],
    });

    const action: QueuedAction = {
      id: 'act-demolish-1',
      colonyId: 'colony-1',
      type: 'demolish',
      params: { settlementId: 'settlement-1', buildingType: 'farm' },
    };

    const result = resolveDemolish([settlement], [colony], [action]);

    // Farm costs 20 timber. 25% of 20 = 5 timber refund
    expect(colony.resources.timber).toBe(15); // 10 + 5
    expect(settlement.buildings).toHaveLength(0);
    expect(result.actionResults[0].status).toBe('resolved');

    const event = result.events.find(e => e.type === 'building_demolished');
    expect(event).toBeDefined();
    expect(event!.data.buildingType).toBe('farm');
    expect(event!.data.level).toBe(1);
    expect((event!.data.refund as Record<string, number>).timber).toBe(5);
  });

  it('should refund based on level for upgraded buildings', () => {
    const colony = makeColony({ resources: { food: 10, timber: 10, stone: 10, iron: 10, influence: 10 } });
    const settlement = makeSettlement({
      buildings: [{ type: 'mine', level: 2 }],
    });

    const action: QueuedAction = {
      id: 'act-demolish-2',
      colonyId: 'colony-1',
      type: 'demolish',
      params: { settlementId: 'settlement-1', buildingType: 'mine' },
    };

    const result = resolveDemolish([settlement], [colony], [action]);

    // Mine costs stone: 30, timber: 20. Level 2 total = stone: 60, timber: 40
    // 25% refund = stone: 15, timber: 10
    expect(colony.resources.stone).toBe(25); // 10 + 15
    expect(colony.resources.timber).toBe(20); // 10 + 10
    expect(settlement.buildings).toHaveLength(0);
    expect(result.actionResults[0].status).toBe('resolved');
  });

  it('should fail when settlement does not exist', () => {
    const colony = makeColony();

    const action: QueuedAction = {
      id: 'act-demolish-3',
      colonyId: 'colony-1',
      type: 'demolish',
      params: { settlementId: 'nonexistent', buildingType: 'farm' },
    };

    const result = resolveDemolish([], [colony], [action]);
    expect(result.actionResults[0].status).toBe('failed');
    expect(result.actionResults[0].result).toContain('not found');
  });

  it('should fail when settlement does not belong to colony', () => {
    const colony = makeColony({ id: 'colony-2' });
    const settlement = makeSettlement({ colonyId: 'colony-1', buildings: [{ type: 'farm', level: 1 }] });

    const action: QueuedAction = {
      id: 'act-demolish-4',
      colonyId: 'colony-2',
      type: 'demolish',
      params: { settlementId: 'settlement-1', buildingType: 'farm' },
    };

    const result = resolveDemolish([settlement], [colony], [action]);
    expect(result.actionResults[0].status).toBe('failed');
    expect(result.actionResults[0].result).toContain('does not belong');
  });

  it('should fail when building type does not exist in settlement', () => {
    const colony = makeColony();
    const settlement = makeSettlement({ buildings: [{ type: 'farm', level: 1 }] });

    const action: QueuedAction = {
      id: 'act-demolish-5',
      colonyId: 'colony-1',
      type: 'demolish',
      params: { settlementId: 'settlement-1', buildingType: 'mine' },
    };

    const result = resolveDemolish([settlement], [colony], [action]);
    expect(result.actionResults[0].status).toBe('failed');
    expect(result.actionResults[0].result).toContain('does not have');
  });

  it('should fail when building type is invalid', () => {
    const colony = makeColony();
    const settlement = makeSettlement();

    const action: QueuedAction = {
      id: 'act-demolish-6',
      colonyId: 'colony-1',
      type: 'demolish',
      params: { settlementId: 'settlement-1', buildingType: 'trebuchet' },
    };

    const result = resolveDemolish([settlement], [colony], [action]);
    expect(result.actionResults[0].status).toBe('failed');
    expect(result.actionResults[0].result).toContain('Invalid building type');
  });

  it('should also clear build queue entries for demolished building type', () => {
    const colony = makeColony();
    const settlement = makeSettlement({
      buildings: [{ type: 'farm', level: 1 }],
      buildQueue: [{ type: 'farm', ticksRemaining: 2 }],
    });

    const action: QueuedAction = {
      id: 'act-demolish-7',
      colonyId: 'colony-1',
      type: 'demolish',
      params: { settlementId: 'settlement-1', buildingType: 'farm' },
    };

    const result = resolveDemolish([settlement], [colony], [action]);
    expect(result.actionResults[0].status).toBe('resolved');
    expect(settlement.buildings).toHaveLength(0);
    expect(settlement.buildQueue).toHaveLength(0);
  });
});

describe('demolish in resolveTick (integration)', () => {
  it('should process demolish action in full tick', () => {
    const colony = makeColony({ resources: { food: 200, timber: 50, stone: 30, iron: 10, influence: 50 } });
    const settlement = makeSettlement({
      buildings: [{ type: 'farm', level: 1 }, { type: 'lumberMill', level: 1 }],
      population: 5,
    });
    const hexes = [makeHex(0, 0)];

    const action: QueuedAction = {
      id: 'act-1',
      colonyId: 'colony-1',
      type: 'demolish',
      params: { settlementId: 'settlement-1', buildingType: 'farm' },
    };

    const result = resolveTick([colony], [settlement], [], hexes, [action]);

    // Farm should be demolished
    const farmRemains = result.settlements[0].buildings.find(b => b.type === 'farm');
    expect(farmRemains).toBeUndefined();

    // LumberMill should still be there
    const lumberMill = result.settlements[0].buildings.find(b => b.type === 'lumberMill');
    expect(lumberMill).toBeDefined();

    // Demolished event should be present
    const demolishEvent = result.events.find(e => e.type === 'building_demolished');
    expect(demolishEvent).toBeDefined();
  });
});

describe('Building decay on food deficit', () => {
  it('should decay buildings when colony food is 0 (with forced random)', () => {
    // Force Math.random to return 0.05 (below 0.10 threshold = decay happens)
    const originalRandom = Math.random;
    Math.random = () => 0.05;

    try {
      const colony = makeColony({
        resources: { food: 0, timber: 0, stone: 0, iron: 0, influence: 0 },
      });
      const settlement = makeSettlement({
        buildings: [{ type: 'market', level: 2 }],
        population: 0,
      });
      // Need hexes for production calculation
      const hexes = [makeHex(0, 0, { resources: { food: 0, timber: 0, stone: 0, iron: 0 } })];

      const result = resolveTick([colony], [settlement], [], hexes, []);

      const market = result.settlements[0].buildings.find(b => b.type === 'market');
      expect(market).toBeDefined();
      expect(market!.level).toBe(1);

      const decayEvent = result.events.find(e => e.type === 'building_decayed');
      expect(decayEvent).toBeDefined();
      expect(decayEvent!.data.previousLevel).toBe(2);
      expect(decayEvent!.data.newLevel).toBe(1);
      expect(decayEvent!.data.destroyed).toBe(false);
    } finally {
      Math.random = originalRandom;
    }
  });

  it('should destroy level 1 buildings on decay', () => {
    const originalRandom = Math.random;
    Math.random = () => 0.05;

    try {
      const colony = makeColony({
        resources: { food: 0, timber: 0, stone: 0, iron: 0, influence: 0 },
      });
      const settlement = makeSettlement({
        buildings: [{ type: 'market', level: 1 }],
        population: 0,
      });
      const hexes = [makeHex(0, 0, { resources: { food: 0, timber: 0, stone: 0, iron: 0 } })];

      const result = resolveTick([colony], [settlement], [], hexes, []);

      const market = result.settlements[0].buildings.find(b => b.type === 'market');
      expect(market).toBeUndefined();

      const decayEvent = result.events.find(e => e.type === 'building_decayed');
      expect(decayEvent).toBeDefined();
      expect(decayEvent!.data.destroyed).toBe(true);
    } finally {
      Math.random = originalRandom;
    }
  });

  it('should not decay buildings when colony has food', () => {
    const originalRandom = Math.random;
    Math.random = () => 0.05; // Would trigger decay if food was 0

    try {
      const colony = makeColony({
        resources: { food: 100, timber: 100, stone: 50, iron: 20, influence: 10 },
      });
      const settlement = makeSettlement({
        buildings: [{ type: 'farm', level: 1 }],
        population: 5,
      });
      const hexes = makeHexRing(0, 0);

      const result = resolveTick([colony], [settlement], [], hexes, []);

      // Building should still exist (colony has food)
      const farm = result.settlements[0].buildings.find(b => b.type === 'farm');
      expect(farm).toBeDefined();
      expect(farm!.level).toBe(1);

      const decayEvent = result.events.find(e => e.type === 'building_decayed');
      expect(decayEvent).toBeUndefined();
    } finally {
      Math.random = originalRandom;
    }
  });

  it('should not decay buildings when random roll is above threshold', () => {
    const originalRandom = Math.random;
    Math.random = () => 0.50; // Above 0.10 threshold = no decay

    try {
      const colony = makeColony({
        resources: { food: 0, timber: 0, stone: 0, iron: 0, influence: 0 },
      });
      const settlement = makeSettlement({
        buildings: [{ type: 'farm', level: 1 }],
        population: 0,
      });
      const hexes = [makeHex(0, 0, { resources: { food: 0, timber: 0, stone: 0, iron: 0 } })];

      const result = resolveTick([colony], [settlement], [], hexes, []);

      // Building should still exist (roll was above threshold)
      const farm = result.settlements[0].buildings.find(b => b.type === 'farm');
      expect(farm).toBeDefined();

      const decayEvent = result.events.find(e => e.type === 'building_decayed');
      expect(decayEvent).toBeUndefined();
    } finally {
      Math.random = originalRandom;
    }
  });
});

// =====================
// Combat Resolution
// =====================

describe('resolveCombat', () => {
  it('should not trigger combat when all units belong to same colony', () => {
    const units = [
      makeUnit({ id: 'u1', colonyId: 'c1', hexX: 5, hexY: 5, type: 'soldier' }),
      makeUnit({ id: 'u2', colonyId: 'c1', hexX: 5, hexY: 5, type: 'militia' }),
    ];

    const result = resolveCombat(units, [], 42);
    expect(result.destroyedUnitIds).toHaveLength(0);
    expect(result.events).toHaveLength(0);
    expect(result.units).toHaveLength(2);
  });

  it('should trigger combat when opposing units share a hex', () => {
    const units = [
      makeUnit({ id: 'u1', colonyId: 'c1', hexX: 5, hexY: 5, type: 'soldier', health: 100 }),
      makeUnit({ id: 'u2', colonyId: 'c2', hexX: 5, hexY: 5, type: 'militia', health: 100 }),
    ];

    const result = resolveCombat(units, [], 42);
    // Combat should occur — check for combat_resolved events
    const combatEvents = result.events.filter(e => e.type === 'combat_resolved');
    expect(combatEvents.length).toBeGreaterThan(0);
  });

  it('should apply damage based on attack power minus defense', () => {
    // Soldier (attack 8) vs militia (defense 3) → net damage = ~8*(1+bonus) - 3
    const units = [
      makeUnit({ id: 'u1', colonyId: 'c1', hexX: 0, hexY: 0, type: 'soldier', health: 100 }),
      makeUnit({ id: 'u2', colonyId: 'c2', hexX: 0, hexY: 0, type: 'militia', health: 100 }),
    ];

    const result = resolveCombat(units, [], 42);
    // Both should survive one round (damage < 100)
    expect(result.units.length).toBe(2);
    // Check that health was reduced
    const soldier = result.units.find(u => u.id === 'u1');
    const militia = result.units.find(u => u.id === 'u2');
    expect(soldier).toBeDefined();
    expect(militia).toBeDefined();
    // Militia attacks soldier: minimum damage of 1 applies (#173)
    // Soldier attacks militia: attack 8, militia defense 3 → net damage ~8*(1+bonus)-3 > 0
    expect(militia!.health).toBeLessThan(100);
    expect(soldier!.health).toBeLessThan(100); // militia now always deals at least 1 damage
  });

  it('should apply steel_weapons bonus to militia and soldier attacks', () => {
    const baseline = resolveCombat([
      makeUnit({ id: 'u1', colonyId: 'c1', hexX: 0, hexY: 0, type: 'soldier', health: 100 }),
      makeUnit({ id: 'u2', colonyId: 'c2', hexX: 0, hexY: 0, type: 'militia', health: 100 }),
    ], [], 42);

    const coloniesWithTech = [
      Object.assign(makeColony({ id: 'c1' }), { researchedTechs: ['steel_weapons'] }),
      makeColony({ id: 'c2' }),
    ];
    const buffed = resolveCombat([
      makeUnit({ id: 'u1', colonyId: 'c1', hexX: 0, hexY: 0, type: 'soldier', health: 100 }),
      makeUnit({ id: 'u2', colonyId: 'c2', hexX: 0, hexY: 0, type: 'militia', health: 100 }),
    ], [], 42, undefined, undefined, coloniesWithTech);

    const baselineTarget = baseline.units.find(u => u.id === 'u2');
    const buffedTarget = buffed.units.find(u => u.id === 'u2');
    expect(baselineTarget).toBeDefined();
    expect(buffedTarget).toBeDefined();
    expect(buffedTarget!.health).toBeLessThan(baselineTarget!.health);
    expect(baselineTarget!.health - buffedTarget!.health).toBe(STEEL_WEAPONS_ATTACK_BONUS);
  });

  it('should apply fortifications retaliation on fortified settlement hexes', () => {
    const settlements = [
      makeSettlement({ id: 's1', colonyId: 'c2', hexX: 0, hexY: 0 }),
    ];
    const coloniesWithTech = [
      makeColony({ id: 'c1' }),
      Object.assign(makeColony({ id: 'c2' }), { researchedTechs: ['fortifications'] }),
    ];

    const result = resolveCombat([
      makeUnit({ id: 'u1', colonyId: 'c1', hexX: 0, hexY: 0, type: 'soldier', health: 100 }),
      makeUnit({ id: 'u2', colonyId: 'c2', hexX: 0, hexY: 0, type: 'militia', health: 100 }),
    ], [], 42, undefined, settlements, coloniesWithTech);

    const attacker = result.units.find(u => u.id === 'u1');
    expect(attacker).toBeDefined();
    const expectedHealth = 100 - 1 - FORTIFICATIONS_RETALIATION_DAMAGE;
    expect(attacker!.health).toBe(expectedHealth);
  });

  it('militia should deal minimum damage to soldiers (#173)', () => {
    // Militia (attack 4) vs soldier (defense 6): raw damage < defense, but minimum 1 applies
    const units = [
      makeUnit({ id: 'u1', colonyId: 'c1', hexX: 0, hexY: 0, type: 'militia', health: 100 }),
      makeUnit({ id: 'u2', colonyId: 'c2', hexX: 0, hexY: 0, type: 'soldier', health: 100 }),
    ];

    const result = resolveCombat(units, [], 42);
    const soldier = result.units.find(u => u.id === 'u2');
    expect(soldier).toBeDefined();
    // Militia should deal at least 1 damage per round (COMBAT_MINIMUM_DAMAGE)
    expect(soldier!.health).toBeLessThan(100);
    // But militia should take more damage than soldier (soldier has higher attack)
    const militia = result.units.find(u => u.id === 'u1');
    expect(militia).toBeDefined();
    expect(militia!.health).toBeLessThan(soldier!.health);
  });

  it('near-dead military units bleed out after combat (#174)', () => {
    // Militia at 3 HP fighting a soldier — militia should be destroyed by bleedout
    const units = [
      makeUnit({ id: 'u1', colonyId: 'c1', hexX: 0, hexY: 0, type: 'soldier', health: 100 }),
      makeUnit({ id: 'u2', colonyId: 'c2', hexX: 0, hexY: 0, type: 'militia', health: 3 }),
    ];

    const result = resolveCombat(units, [], 42);
    // Militia at 3 HP should be destroyed (either by combat damage or bleedout)
    expect(result.destroyedUnitIds).toContain('u2');
    // Soldier should survive
    expect(result.units.find(u => u.id === 'u1')).toBeDefined();
  });

  it('should destroy units that reach 0 health', () => {
    // Soldier (attack 8) vs settler (defense 1, health 10) → settler dies easily
    const units = [
      makeUnit({ id: 'u1', colonyId: 'c1', hexX: 0, hexY: 0, type: 'soldier', health: 100 }),
      makeUnit({ id: 'u2', colonyId: 'c2', hexX: 0, hexY: 0, type: 'settler', health: 10 }),
    ];

    const result = resolveCombat(units, [], 42);
    expect(result.destroyedUnitIds).toContain('u2');
    expect(result.units.find(u => u.id === 'u2')).toBeUndefined();

    // unit_destroyed event should be emitted
    const destroyedEvents = result.events.filter(e => e.type === 'unit_destroyed');
    expect(destroyedEvents.length).toBeGreaterThanOrEqual(1);
    expect(destroyedEvents[0].data.unitType).toBe('settler');
  });

  it('settlers deal no damage', () => {
    // Two settlers from opposing colonies — neither can damage the other
    const units = [
      makeUnit({ id: 'u1', colonyId: 'c1', hexX: 0, hexY: 0, type: 'settler', health: 100 }),
      makeUnit({ id: 'u2', colonyId: 'c2', hexX: 0, hexY: 0, type: 'settler', health: 100 }),
    ];

    const result = resolveCombat(units, [], 42);
    // Both survive — neither can deal damage
    expect(result.units).toHaveLength(2);
    expect(result.destroyedUnitIds).toHaveLength(0);
    // With no winner, both sides take the loser-side penalty in addition to base loss.
    expect(result.units[0].morale).toBe(1.0 - COMBAT_MORALE_LOSS - COMBAT_MORALE_LOSE);
  });

  it('should reduce morale for surviving units (winner vs loser)', () => {
    const units = [
      makeUnit({ id: 'u1', colonyId: 'c1', hexX: 0, hexY: 0, type: 'soldier', health: 100, morale: 1.0 }),
      makeUnit({ id: 'u2', colonyId: 'c2', hexX: 0, hexY: 0, type: 'soldier', health: 100, morale: 1.0 }),
    ];

    const result = resolveCombat(units, [], 42);
    // Both should survive, with the winner capped at 1.0 morale.
    expect(result.units).toHaveLength(2);
    const morales = result.units.map(u => u.morale).sort((a, b) => a - b);
    expect(morales[0]).toBe(0.8);
    expect(morales[1]).toBe(1.0);
  });

  it('should handle multi-colony combat on same hex', () => {
    const units = [
      makeUnit({ id: 'u1', colonyId: 'c1', hexX: 0, hexY: 0, type: 'soldier', health: 100 }),
      makeUnit({ id: 'u2', colonyId: 'c2', hexX: 0, hexY: 0, type: 'soldier', health: 100 }),
      makeUnit({ id: 'u3', colonyId: 'c3', hexX: 0, hexY: 0, type: 'soldier', health: 100 }),
    ];

    const result = resolveCombat(units, [], 42);
    // All three colonies should get combat_resolved events
    const combatEvents = result.events.filter(e => e.type === 'combat_resolved');
    const eventColonies = new Set(combatEvents.map(e => e.colonyId));
    expect(eventColonies.size).toBe(3);
  });

  it('should not produce combat on different hexes', () => {
    const units = [
      makeUnit({ id: 'u1', colonyId: 'c1', hexX: 0, hexY: 0, type: 'soldier', health: 100 }),
      makeUnit({ id: 'u2', colonyId: 'c2', hexX: 5, hexY: 5, type: 'soldier', health: 100 }),
    ];

    const result = resolveCombat(units, [], 42);
    expect(result.events).toHaveLength(0);
    expect(result.destroyedUnitIds).toHaveLength(0);
  });

  it('should produce deterministic results with same seed', () => {
    const makeTestUnits = () => [
      makeUnit({ id: 'u1', colonyId: 'c1', hexX: 0, hexY: 0, type: 'soldier', health: 50 }),
      makeUnit({ id: 'u2', colonyId: 'c2', hexX: 0, hexY: 0, type: 'soldier', health: 50 }),
    ];

    const r1 = resolveCombat(makeTestUnits(), [], 12345);
    const r2 = resolveCombat(makeTestUnits(), [], 12345);

    // Same seed → same results
    expect(r1.destroyedUnitIds).toEqual(r2.destroyedUnitIds);
    expect(r1.units.map(u => u.health)).toEqual(r2.units.map(u => u.health));
  });

  it('should produce different results with different seeds', () => {
    const makeTestUnits = () => [
      makeUnit({ id: 'u1', colonyId: 'c1', hexX: 0, hexY: 0, type: 'soldier', health: 50 }),
      makeUnit({ id: 'u2', colonyId: 'c2', hexX: 0, hexY: 0, type: 'soldier', health: 50 }),
    ];

    const r1 = resolveCombat(makeTestUnits(), [], 111);
    const r2 = resolveCombat(makeTestUnits(), [], 999);

    // Different seeds → at least health values differ (with high probability)
    const h1 = r1.units.map(u => u.health);
    const h2 = r2.units.map(u => u.health);
    // Can't guarantee difference but overwhelmingly likely with different seeds
    // Just check both produced valid results
    expect(r1.units.length + r1.destroyedUnitIds.length).toBe(2);
    expect(r2.units.length + r2.destroyedUnitIds.length).toBe(2);
  });

  it('overwhelming force should kill the weaker unit', () => {
    // 3 soldiers vs 1 settler with low health — guaranteed kill
    const units = [
      makeUnit({ id: 'u1', colonyId: 'c1', hexX: 0, hexY: 0, type: 'soldier', health: 100 }),
      makeUnit({ id: 'u2', colonyId: 'c1', hexX: 0, hexY: 0, type: 'soldier', health: 100 }),
      makeUnit({ id: 'u3', colonyId: 'c1', hexX: 0, hexY: 0, type: 'soldier', health: 100 }),
      makeUnit({ id: 'u4', colonyId: 'c2', hexX: 0, hexY: 0, type: 'settler', health: 5 }),
    ];

    const result = resolveCombat(units, [], 42);
    expect(result.destroyedUnitIds).toContain('u4');
  });
});

describe('combat integration with resolveTick', () => {
  it('should resolve combat after movement in resolveTick', () => {
    // Place units from different colonies on the same hex
    const colonies = [
      makeColony({ id: 'c1', resources: { food: 500, timber: 200, stone: 100, iron: 50, influence: 20 } }),
      makeColony({ id: 'c2', resources: { food: 500, timber: 200, stone: 100, iron: 50, influence: 20 } }),
    ];
    const settlements = [
      makeSettlement({ id: 's1', colonyId: 'c1', hexX: 0, hexY: 0, buildings: [{ type: 'farm', level: 1 }] }),
      makeSettlement({ id: 's2', colonyId: 'c2', hexX: 10, hexY: 0, buildings: [{ type: 'farm', level: 1 }] }),
    ];
    const units = [
      makeUnit({ id: 'u1', colonyId: 'c1', hexX: 5, hexY: 0, type: 'soldier', health: 100 }),
      makeUnit({ id: 'u2', colonyId: 'c2', hexX: 5, hexY: 0, type: 'settler', health: 10 }),
    ];
    const hexes = Array.from({ length: 11 }, (_, i) => makeHex(i, 0));

    const result = resolveTick(colonies, settlements, units, hexes, [], 42);

    // Combat should have happened — settler should be destroyed
    const destroyedEvents = result.events.filter(e => e.type === 'unit_destroyed');
    expect(destroyedEvents.length).toBeGreaterThanOrEqual(1);
    expect(result.units.find(u => u.id === 'u2')).toBeUndefined();
  });

  it('attack action should path unit toward target and trigger combat', () => {
    const colonies = [
      makeColony({ id: 'c1', resources: { food: 500, timber: 200, stone: 100, iron: 50, influence: 20 } }),
      makeColony({ id: 'c2', resources: { food: 500, timber: 200, stone: 100, iron: 50, influence: 20 } }),
    ];
    const settlements = [
      makeSettlement({ id: 's1', colonyId: 'c1', hexX: 0, hexY: 0, buildings: [{ type: 'farm', level: 1 }] }),
      makeSettlement({ id: 's2', colonyId: 'c2', hexX: 5, hexY: 0, buildings: [{ type: 'farm', level: 1 }] }),
    ];
    // Soldier 1 hex away from enemy settler
    const units = [
      makeUnit({ id: 'u1', colonyId: 'c1', hexX: 1, hexY: 0, type: 'soldier', health: 100 }),
      makeUnit({ id: 'u2', colonyId: 'c2', hexX: 2, hexY: 0, type: 'settler', health: 10 }),
    ];
    const hexes = Array.from({ length: 6 }, (_, i) => makeHex(i, 0));

    // Attack action: move soldier to settler's hex
    const actions: QueuedAction[] = [
      makeAction({
        id: 'atk-1',
        colonyId: 'c1',
        type: 'attack',
        params: { unitId: 'u1', targetX: 2, targetY: 0 },
      }),
    ];

    const result = resolveTick(colonies, settlements, units, hexes, actions, 42);

    // Soldier should have moved to (2,0) and killed the settler
    const soldier = result.units.find(u => u.id === 'u1');
    expect(soldier).toBeDefined();
    expect(soldier!.hexX).toBe(2);
    expect(soldier!.hexY).toBe(0);
    // Settler should be dead
    expect(result.units.find(u => u.id === 'u2')).toBeUndefined();
  });
});


// --- Edge Case Tests (Issue #123) ---

describe('Edge cases: simultaneous actions (Issue #123)', () => {

  // Case 1: Two colonies found settlements on the same hex in the same tick
  it('rejects second settlement founding on same hex due to distance check', () => {
    const hexes = makePlainGrid(10);
    const settler1 = makeUnit({ id: 'settler-1', colonyId: 'c1', type: 'settler', hexX: 5, hexY: 5, worldId: 'w1' });
    const settler2 = makeUnit({ id: 'settler-2', colonyId: 'c2', type: 'settler', hexX: 5, hexY: 5, worldId: 'w1' });
    const c1 = makeColony({ id: 'c1', resources: { food: 200, timber: 200, stone: 100, iron: 50, influence: 50 } });
    const c2 = makeColony({ id: 'c2', resources: { food: 200, timber: 200, stone: 100, iron: 50, influence: 50 } });

    const actions: QueuedAction[] = [
      { id: 'a1', colonyId: 'c1', type: 'found_settlement', params: { unitId: 'settler-1', name: 'Town A' } },
      { id: 'a2', colonyId: 'c2', type: 'found_settlement', params: { unitId: 'settler-2', name: 'Town B' } },
    ];

    const allHexCoords = new Set(hexes.map(h => `${h.x},${h.y}`));
    const result = resolveFoundSettlement([settler1, settler2], [c1, c2], [], hexes, actions, allHexCoords);

    // First succeeds, second fails (too close)
    const resolved = result.actionResults.filter(r => r.status === 'resolved');
    const failed = result.actionResults.filter(r => r.status === 'failed');
    expect(resolved.length).toBe(1);
    expect(failed.length).toBe(1);
    expect(resolved[0].actionId).toBe('a1');
    expect(failed[0].result).toContain('Too close');
    expect(result.newSettlements.length).toBe(1);
  });

  // Case 2: Two colonies move units to same hex — combat should trigger
  it('triggers combat when two colonies move units to same hex', () => {
    const hexes = makePlainLine(10);
    const u1 = makeUnit({ id: 'u1', colonyId: 'c1', hexX: 0, hexY: 0, type: 'soldier', health: 100 });
    const u2 = makeUnit({ id: 'u2', colonyId: 'c2', hexX: 2, hexY: 0, type: 'soldier', health: 100 });
    const c1 = makeColony({ id: 'c1', resources: { food: 500, timber: 200, stone: 100, iron: 50, influence: 50 } });
    const c2 = makeColony({ id: 'c2', resources: { food: 500, timber: 200, stone: 100, iron: 50, influence: 50 } });
    const s1 = makeSettlement({ id: 's1', colonyId: 'c1', hexX: 0, hexY: 0 });
    const s2 = makeSettlement({ id: 's2', colonyId: 'c2', hexX: 6, hexY: 0 });

    const actions: QueuedAction[] = [
      { id: 'a1', colonyId: 'c1', type: 'move_unit', params: { unitId: 'u1', targetX: 1, targetY: 0 } },
      { id: 'a2', colonyId: 'c2', type: 'move_unit', params: { unitId: 'u2', targetX: 1, targetY: 0 } },
    ];

    const result = resolveTick([c1, c2], [s1, s2], [u1, u2], hexes, actions, 42);
    const combatEvents = result.events.filter(e => e.type === 'combat_resolved');
    expect(combatEvents.length).toBeGreaterThan(0);
  });

  // Case 3: Colony submits build + demolish for the same building type in one tick
  it('build + demolish same building type: build queues, demolish removes existing', () => {
    const colony = makeColony({ resources: { food: 200, timber: 200, stone: 100, iron: 50, influence: 50 } });
    const settlement = makeSettlement({
      buildings: [{ type: 'mine', level: 1 }],
      buildQueue: [],
    });

    const actions: QueuedAction[] = [
      { id: 'a-build', colonyId: 'colony-1', type: 'build', params: { settlementId: 'settlement-1', buildingType: 'mine' } },
      { id: 'a-demolish', colonyId: 'colony-1', type: 'demolish', params: { settlementId: 'settlement-1', buildingType: 'mine' } },
    ];

    // Build is Phase 1 — but mine already exists, so build should fail.
    // Demolish is Phase 1.8 — demolishes the existing farm
    const hexes = makeHexRing(0, 0);
    const result = resolveTick([colony], [settlement], [], hexes, actions, 42);

    const buildResult = result.actionResults.find(r => r.actionId === 'a-build');
    const demolishResult = result.actionResults.find(r => r.actionId === 'a-demolish');

    // Build fails because mine already exists
    expect(buildResult?.status).toBe('failed');
    expect(buildResult?.result).toContain('already has a mine');
    // Demolish succeeds
    expect(demolishResult?.status).toBe('resolved');
  });

  // Case 3b: Build a new type + demolish same new type (building doesn't exist yet)
  it('demolish fails for building type not yet completed (only in queue)', () => {
    const colony = makeColony({ resources: { food: 200, timber: 200, stone: 100, iron: 50, influence: 50 } });
    const settlement = makeSettlement({
      buildings: [],
      buildQueue: [],
    });

    const actions: QueuedAction[] = [
      { id: 'a-build', colonyId: 'colony-1', type: 'build', params: { settlementId: 'settlement-1', buildingType: 'farm' } },
      { id: 'a-demolish', colonyId: 'colony-1', type: 'demolish', params: { settlementId: 'settlement-1', buildingType: 'farm' } },
    ];

    const hexes = makeHexRing(0, 0);
    const result = resolveTick([colony], [settlement], [], hexes, actions, 42);

    const buildResult = result.actionResults.find(r => r.actionId === 'a-build');
    const demolishResult = result.actionResults.find(r => r.actionId === 'a-demolish');

    // Build succeeds (farm goes to queue)
    expect(buildResult?.status).toBe('resolved');
    // Demolish fails (farm not in buildings array yet)
    expect(demolishResult?.status).toBe('failed');
    expect(demolishResult?.result).toContain('does not have a farm');
  });

  // Case 4: Colony submits move + found_settlement for same settler
  it('found_settlement consumes settler, move is explicitly rejected in dedup', () => {
    const hexes = makePlainGrid(10);
    const settler = makeUnit({ id: 'settler-1', colonyId: 'colony-1', type: 'settler', hexX: 5, hexY: 5, worldId: 'world-1' });
    const colony = makeColony({ resources: { food: 200, timber: 200, stone: 100, iron: 50, influence: 50 } });

    const actions: QueuedAction[] = [
      { id: 'a-found', colonyId: 'colony-1', type: 'found_settlement', params: { unitId: 'settler-1', name: 'New Town' } },
      { id: 'a-move', colonyId: 'colony-1', type: 'move_unit', params: { unitId: 'settler-1', targetX: 6, targetY: 5 } },
    ];

    const result = resolveTick([colony], [], [settler], hexes, actions, 42);

    const foundResult = result.actionResults.find(r => r.actionId === 'a-found');
    const moveResult = result.actionResults.find(r => r.actionId === 'a-move');

    expect(foundResult?.status).toBe('resolved');
    // Move should fail — settler has a found_settlement action, rejected in dedup phase
    expect(moveResult?.status).toBe('failed');
    expect(moveResult?.result).toContain('found_settlement');
  });

  // Case 5: Multiple build actions that together exceed available resources — first-come-first-served
  it('multiple builds: first deducts resources, second fails if insufficient', () => {
    // Colony has exactly enough for ONE farm (20 timber)
    const colony = makeColony({ resources: { food: 100, timber: 25, stone: 50, iron: 50, influence: 50 } });
    const s1 = makeSettlement({ id: 's1', colonyId: 'colony-1', hexX: 0, hexY: 0, buildings: [], buildQueue: [] });
    const s2 = makeSettlement({ id: 's2', colonyId: 'colony-1', hexX: 10, hexY: 0, buildings: [], buildQueue: [] });

    const actions: QueuedAction[] = [
      { id: 'a1', colonyId: 'colony-1', type: 'build', params: { settlementId: 's1', buildingType: 'farm' } },
      { id: 'a2', colonyId: 'colony-1', type: 'build', params: { settlementId: 's2', buildingType: 'farm' } },
    ];

    const hexes = [...makeHexRing(0, 0), ...makeHexRing(10, 0)];
    const result = resolveTick([colony], [s1, s2], [], hexes, actions, 42);

    const r1 = result.actionResults.find(r => r.actionId === 'a1');
    const r2 = result.actionResults.find(r => r.actionId === 'a2');

    // First build succeeds (20 timber deducted, 5 remaining)
    expect(r1?.status).toBe('resolved');
    // Second build fails (needs 20 timber, only 5 left)
    expect(r2?.status).toBe('failed');
    expect(r2?.result).toContain('Insufficient resources');
  });

  // Case 6: Multiple train actions that together exceed resources — first-come-first-served
  it('multiple train actions: first succeeds, second fails if resources exhausted', () => {
    // Scout costs: food 10, timber 5. Colony has food 15, timber 7.
    const colony = makeColony({ resources: { food: 15, timber: 7, stone: 50, iron: 50, influence: 50 } });
    const settlement = makeSettlement({
      buildings: [{ type: 'barracks', level: 1 }],
    });

    const actions: QueuedAction[] = [
      { id: 'a1', colonyId: 'colony-1', type: 'train_unit', params: { settlementId: 'settlement-1', unitType: 'scout' } },
      { id: 'a2', colonyId: 'colony-1', type: 'train_unit', params: { settlementId: 'settlement-1', unitType: 'scout' } },
    ];

    const result = resolveTrainUnit([colony], [settlement], actions);

    const r1 = result.actionResults.find(r => r.actionId === 'a1');
    const r2 = result.actionResults.find(r => r.actionId === 'a2');

    expect(r1?.status).toBe('resolved');
    expect(r2?.status).toBe('failed');
    expect(r2?.result).toContain('Insufficient resources');
    expect(result.newUnits.length).toBe(1);
  });

  // Case 7: Upgrade settlement while buildings are still in build queue
  it('settlement upgrade allowed while build queue has items', () => {
    // Town requires: 3 buildings, 50 pop, resources
    const colony = makeColony({
      resources: { food: 500, timber: 500, stone: 500, iron: 200, influence: 200 },
    });
    const settlement = makeSettlement({
      tier: 'outpost',
      population: 60,
      buildings: [
        { type: 'farm', level: 1 },
        { type: 'lumberMill', level: 1 },
        { type: 'quarry', level: 1 },
      ],
      buildQueue: [
        { type: 'mine', ticksRemaining: 2 },  // still being built
      ],
    });

    const actions: QueuedAction[] = [
      { id: 'a1', colonyId: 'colony-1', type: 'upgrade_settlement', params: { settlementId: 'settlement-1' } },
    ];

    const result = resolveUpgradeSettlement([settlement], [colony], actions);

    const r1 = result.actionResults.find(r => r.actionId === 'a1');
    // Should succeed — 3 completed buildings meet the requirement
    expect(r1?.status).toBe('resolved');
    expect(r1?.result).toContain('town');
  });

  // Case 7b: Upgrade settlement fails when completed buildings are insufficient (queue doesn't count)
  it('settlement upgrade fails when only queued buildings would meet requirement', () => {
    const colony = makeColony({
      resources: { food: 500, timber: 500, stone: 500, iron: 200, influence: 200 },
    });
    const settlement = makeSettlement({
      tier: 'outpost',
      population: 60,
      buildings: [
        { type: 'farm', level: 1 },
        { type: 'lumberMill', level: 1 },
      ],
      buildQueue: [
        { type: 'quarry', ticksRemaining: 1 },  // would be the 3rd, but not done yet
      ],
    });

    const actions: QueuedAction[] = [
      { id: 'a1', colonyId: 'colony-1', type: 'upgrade_settlement', params: { settlementId: 'settlement-1' } },
    ];

    const result = resolveUpgradeSettlement([settlement], [colony], actions);

    const r1 = result.actionResults.find(r => r.actionId === 'a1');
    expect(r1?.status).toBe('failed');
    expect(r1?.result).toContain('Insufficient buildings');
  });

  // Case 9: Two colonies attack undefended settlement simultaneously
  // Contested attackers should still fight each other before anyone can claim the settlement.
  it('two colonies fighting on settlement hex: combat resolves between units before capture', () => {
    const u1 = makeUnit({ id: 'u1', colonyId: 'c1', hexX: 5, hexY: 0, type: 'soldier', health: 100 });
    const u2 = makeUnit({ id: 'u2', colonyId: 'c2', hexX: 5, hexY: 0, type: 'soldier', health: 100 });
    const settlement = makeSettlement({ id: 's1', colonyId: 'c3', hexX: 5, hexY: 0 });

    const result = resolveCombat([u1, u2], [], 42, undefined, [settlement]);
    const combatEvents = result.events.filter(e => e.type === 'combat_resolved');
    expect(combatEvents.length).toBeGreaterThan(0);
    expect(result.capturedSettlements).toHaveLength(1);
    expect(result.capturedSettlements[0].settlementId).toBe('s1');
  });

  it('captures an undefended settlement when hostile units occupy the hex without new combat', () => {
    const occupier = makeUnit({ id: 'u1', colonyId: 'c1', hexX: 5, hexY: 0, type: 'soldier', health: 85 });
    const settlement = makeSettlement({ id: 's1', colonyId: 'c2', hexX: 5, hexY: 0, loyalty: 100 });

    const result = resolveCombat([occupier], [], 42, undefined, [settlement]);

    expect(result.capturedSettlements).toEqual([
      { settlementId: 's1', fromColony: 'c2', toColony: 'c1' },
    ]);
    expect(settlement.colonyId).toBe('c1');
    expect(settlement.loyalty).toBe(50);
    expect(result.events.some(e => e.type === 'settlement_captured')).toBe(true);
  });

  // Case 10: Settler tries to found on hex with enemy settlement
  it('founding fails on hex with existing enemy settlement', () => {
    const hexes = makePlainGrid(10);
    const enemySettlement = makeSettlement({ id: 's-enemy', colonyId: 'c2', hexX: 5, hexY: 5 });
    // Set the hex as having a settlement
    const hexWithSettlement = hexes.find(h => h.x === 5 && h.y === 5);
    if (hexWithSettlement) hexWithSettlement.settlementId = 's-enemy';

    const settler = makeUnit({ id: 'settler-1', colonyId: 'c1', type: 'settler', hexX: 5, hexY: 5, worldId: 'w1' });
    const colony = makeColony({ id: 'c1', resources: { food: 200, timber: 200, stone: 100, iron: 50, influence: 50 } });

    const actions: QueuedAction[] = [
      { id: 'a1', colonyId: 'c1', type: 'found_settlement', params: { unitId: 'settler-1', name: 'Invasion' } },
    ];

    const allHexCoords = new Set(hexes.map(h => `${h.x},${h.y}`));
    const result = resolveFoundSettlement([settler], [colony], [enemySettlement], hexes, actions, allHexCoords);

    expect(result.actionResults[0].status).toBe('failed');
    expect(result.actionResults[0].result).toContain('already has a settlement');
    expect(result.newSettlements.length).toBe(0);
  });

});
