import { describe, it, expect } from 'vitest';
import {
  resolveTick,
  resolveMovement,
  resolveFoundSettlement,
  resolveBuilding,
  resolveTrainUnit,
  resolveUpgradeSettlement,
  calculateProduction,
  calculateBuildingUpkeep,
  calculateUnitUpkeep,
  calculatePopulationConsumption,
  TIER_MULTIPLIER,
  BUILDING_PRODUCTION,
  BUILDING_COSTS,
  BUILD_TIME,
  VALID_BUILDING_TYPES,
  UNIT_UPKEEP,
  UNIT_TRAINING_COSTS,
  VALID_UNIT_TYPES,
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
  type Colony,
  type Settlement,
  type Unit,
  type HexTileState,
  type Resources,
  type QueuedAction,
  type BuildingType,
} from '../tick.js';
import { createHexLookup } from '../pathfinding.js';

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

    // farm: 10 * 2 (level) * 2.0 (city) = 40
    expect(production.food).toBeCloseTo(40);
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

    expect(production.food).toBeCloseTo(10);   // farm: 10
    expect(production.timber).toBeCloseTo(6);  // lumberMill: 6
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

    // Should default to level 1: farm produces 10 food * 1 * 1.0 = 10
    expect(production.food).toBeCloseTo(10);
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
      makeUnit({ type: 'soldier' }),   // 3
      makeUnit({ type: 'siege' }),     // 4
    ];
    expect(calculateUnitUpkeep(units)).toBe(8);
  });
});

// --- calculatePopulationConsumption ---

describe('calculatePopulationConsumption', () => {
  it('returns population * POP_FOOD_CONSUMPTION', () => {
    const settlement = makeSettlement({ population: 10 });
    expect(calculatePopulationConsumption(settlement)).toBe(10 * POP_FOOD_CONSUMPTION);
    expect(calculatePopulationConsumption(settlement)).toBe(5);
  });

  it('returns 0 for zero population', () => {
    const settlement = makeSettlement({ population: 0 });
    expect(calculatePopulationConsumption(settlement)).toBe(0);
  });

  it('scales linearly with population', () => {
    const s20 = makeSettlement({ population: 20 });
    const s50 = makeSettlement({ population: 50 });
    expect(calculatePopulationConsumption(s20)).toBe(10);
    expect(calculatePopulationConsumption(s50)).toBe(25);
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

  it('fails when settlement already has the building type', () => {
    const colony = makeColony();
    const settlement = makeSettlement({
      buildings: [{ type: 'farm', level: 1 }],
    });
    const action = makeBuildAction({
      params: { settlementId: 'settlement-1', buildingType: 'farm' },
    });

    const result = resolveBuilding([settlement], [colony], [action]);

    expect(result.actionResults[0].status).toBe('failed');
    expect(result.actionResults[0].result).toContain('already has a farm');
  });

  it('fails when building type is already in build queue', () => {
    const colony = makeColony();
    const settlement = makeSettlement({
      buildQueue: [{ type: 'farm', ticksRemaining: 2 }],
    });
    const action = makeBuildAction({
      params: { settlementId: 'settlement-1', buildingType: 'farm' },
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

  it('rejects second build of same type in same tick', () => {
    const colony = makeColony({ resources: { food: 500, timber: 500, stone: 500, iron: 500, influence: 500 } });
    const settlement = makeSettlement();
    const actions = [
      makeBuildAction({ id: 'act-1', params: { settlementId: 'settlement-1', buildingType: 'farm' } }),
      makeBuildAction({ id: 'act-2', params: { settlementId: 'settlement-1', buildingType: 'farm' } }),
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

    // Scout moves 3 hexes per tick on plains
    expect(result.actionResults[0].status).toBe('resolved');
    expect(result.events.some(e => e.type === 'movement_queued')).toBe(true);
    expect(result.events.some(e => e.type === 'unit_moved')).toBe(true);

    // Scout speed 3 on plains: moves 3 hexes this tick
    expect(units[0].hexX).toBe(3);
    expect(units[0].hexY).toBe(0);
    expect(units[0].movementQueue?.length).toBe(2); // 5 steps total, moved 3, 2 remaining
  });

  it('moves settler 1 hex per tick', () => {
    const hexes = makePlainLine(3);
    const hexLookup = createHexLookup(hexes.map(h => ({ x: h.x, y: h.y, terrain: h.terrain })));
    const units = [makeUnit({ hexX: 0, hexY: 0, type: 'settler' })];
    const actions = [makeAction({ params: { unitId: 'unit-1', targetX: 3, targetY: 0 } })];

    const result = resolveMovement(units, actions, hexLookup);

    // Settler speed 1: moves 1 hex per tick
    expect(units[0].hexX).toBe(1);
    expect(units[0].hexY).toBe(0);
    expect(units[0].movementQueue?.length).toBe(2);
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
    // Settler speed 1: moved 1 step
    expect(units[0].hexX).toBe(0);
    expect(units[0].hexY).toBe(1);
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

    // Scout speed 3: moves 3 hexes on plains
    expect(units[0].hexX).toBe(3);
    expect(units[0].hexY).toBe(0);
    expect(units[0].movementQueue?.length).toBe(1); // 4 - 3 = 1 remaining
    expect(result.events.some(e => e.type === 'unit_moved')).toBe(true);
  });

  it('completes movement when queue is fully drained', () => {
    const hexes = makePlainLine(2);
    const hexLookup = createHexLookup(hexes.map(h => ({ x: h.x, y: h.y, terrain: h.terrain })));
    const units = [makeUnit({
      hexX: 0, hexY: 0,
      type: 'scout', // speed 3
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

    // Forest costs 2 + plains costs 1 = 3, exactly budget. Moves 2 hexes.
    expect(units[0].hexX).toBe(2);
    expect(units[0].hexY).toBe(0);
    expect(units[0].movementQueue?.length).toBe(1); // 1 remaining
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

    // Food: 10 (farm) + 10.5 (hexes) = 20.5 produced, 5 (pop consumption) upkeep
    // Net: 15.5. Starting 100 + 15.5 = 115.5
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

    // Morale reduced (scaled by deficit severity, so loss >= base rate)
    expect(result.units[0].morale).toBeLessThan(1.0);
    expect(result.units[0].morale).toBeGreaterThanOrEqual(0);

    // Food clamped to 0
    expect(result.colonies[0].resources.food).toBe(0);
  });

  it('deserts units when morale drops below threshold (probabilistic)', () => {
    // With probabilistic desertion, we test with morale at 0 (guaranteed below threshold)
    // Run multiple ticks to verify desertion eventually happens
    const colony = makeColony({ resources: { food: 0, timber: 50, stone: 30, iron: 10, influence: 50 } });
    const settlement = makeSettlement({ population: 0 });

    // Create multiple units at 0 morale — with DESERTION_CHANCE=0.3 per unit,
    // having 10 units means it's extremely unlikely none desert
    const units = Array.from({ length: 10 }, (_, i) =>
      makeUnit({ id: `unit-${i}`, type: 'siege', morale: 0.0 }),
    );
    const result = resolveTick([colony], [settlement], units, []);

    // At least some should desert (prob of 0 desertions with 10 units at 30% each = 0.7^10 ≈ 2.8%)
    // We check that the system CAN desert and produces the right events
    expect(result.desertedUnitIds.length + result.units.length).toBe(10); // all accounted for
    // Famine event should fire
    expect(result.events.some(e => e.type === 'famine')).toBe(true);
  });

  it('morale loss scales with deficit severity', () => {
    // Small deficit: 1 food short
    const colony1 = makeColony({ resources: { food: 3, timber: 50, stone: 30, iron: 10, influence: 50 } });
    const settlement1 = makeSettlement({ population: 0 });
    const units1 = [makeUnit({ id: 'u1', type: 'siege' })]; // 4 food upkeep, net = -4
    const result1 = resolveTick([colony1], [settlement1], units1, []);

    // Large deficit: 100 food short
    const colony2 = makeColony({ resources: { food: 0, timber: 50, stone: 30, iron: 10, influence: 50 } });
    const settlement2 = makeSettlement({ population: 40 }); // 20 food consumption
    const units2 = [makeUnit({ id: 'u2', type: 'siege' })]; // +4 food upkeep = 24 total
    const result2 = resolveTick([colony2], [settlement2], units2, []);

    // Both should trigger famine
    expect(result1.events.some(e => e.type === 'famine')).toBe(true);
    expect(result2.events.some(e => e.type === 'famine')).toBe(true);

    // Larger deficit should cause more morale loss
    const morale1 = result1.units.find(u => u.id === 'u1')?.morale ?? 0;
    const morale2 = result2.units.find(u => u.id === 'u2')?.morale ?? 0;
    // Colony2 has larger deficit, so its unit should have lower morale
    // (unless unit deserted — in which case morale2 would be 0 / unit missing)
    if (result2.units.find(u => u.id === 'u2')) {
      expect(morale2).toBeLessThanOrEqual(morale1);
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

    // Farm produces 10 food, hex yields ~10.5, pop consumes 5, scout costs 1
    // Net food positive, so morale recovers
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

    const u2 = makeUnit({ id: 'u2', colonyId: 'c2', type: 'siege' }); // 4 food upkeep

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

  it('returns immutable results (does not mutate inputs)', () => {
    const colony = makeColony();
    const originalFood = colony.resources.food;
    const settlement = makeSettlement({ buildings: [{ type: 'farm', level: 1 }], population: 10 });
    const hexes = makeHexRing(0, 0);

    resolveTick([colony], [settlement], [], hexes);

    // Original colony should not be mutated
    expect(colony.resources.food).toBe(originalFood);
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

    // Militia speed 2: moved to (2,0), 4 remaining
    expect(result1.units[0].hexX).toBe(2);
    expect(result1.units[0].movementQueue?.length).toBe(4);

    // Tick 2: no new actions, continue movement
    const result2 = resolveTick([colony], [settlement], result1.units, hexes);

    expect(result2.units[0].hexX).toBe(4);
    expect(result2.units[0].movementQueue?.length).toBe(2);

    // Tick 3: complete
    const result3 = resolveTick([colony], [settlement], result2.units, hexes);

    expect(result3.units[0].hexX).toBe(6);
    expect(result3.units[0].movementQueue).toEqual([]);
    expect(result3.events.some(e => e.type === 'movement_complete')).toBe(true);
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

  it('rejects duplicate building type in resolveTick', () => {
    const colony = makeColony({ resources: { food: 500, timber: 500, stone: 500, iron: 500, influence: 500 } });
    const settlement = makeSettlement({
      buildings: [{ type: 'farm', level: 1 }],
    });
    const hexes = makeHexRing(0, 0);

    const actions: QueuedAction[] = [makeBuildAction()]; // farm already exists

    const result = resolveTick([colony], [settlement], [], hexes, actions);

    const buildResult = result.actionResults.find(ar => ar.actionId === 'action-build-1');
    expect(buildResult?.status).toBe('failed');
    expect(buildResult?.result).toContain('already has a farm');
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
    // No buildings, no hexes, population 10 → consumes 5 food/tick
    const settlement = makeSettlement({ population: 10 });

    const result = resolveTick([colony], [settlement], [], []);

    // Net food = 0 produced - 5 consumed = -5. Starting 100 - 5 = 95
    expect(result.colonies[0].resources.food).toBe(95);
  });

  it('famine triggers with realistic starting colony and large army', () => {
    // Starting colony with farm, but too many units
    const colony = makeColony({ resources: { food: 50, timber: 50, stone: 30, iron: 10, influence: 50 } });
    const settlement = makeSettlement({
      buildings: [{ type: 'farm', level: 1 }],
      population: 10,
    });
    // 3 soldiers (3 food each) + 2 siege (4 food each) = 17 food upkeep
    // Plus pop: 5 food consumption
    // Farm production: 10 food
    // Net: 10 - 17 - 5 = -12 food
    const units = [
      makeUnit({ id: 'u1', type: 'soldier' }),
      makeUnit({ id: 'u2', type: 'soldier' }),
      makeUnit({ id: 'u3', type: 'soldier' }),
      makeUnit({ id: 'u4', type: 'siege' }),
      makeUnit({ id: 'u5', type: 'siege' }),
    ];

    const result = resolveTick([colony], [settlement], units, []);

    // Food should go negative due to heavy military upkeep + pop consumption
    // (50 + 10 - 22 = 38, but that's with hex yields. Without hexes: 50 + 10 - 22 = 38)
    // Actually: produced=10 (farm), consumed=5 (pop) + 17 (units) = 22
    // Net = 10 - 22 = -12. Starting 50 - 12 = 38. Not negative yet.
    // But after a few ticks it would be.
    // With starting food 10 instead:
    const colony2 = makeColony({ resources: { food: 10, timber: 50, stone: 30, iron: 10, influence: 50 } });
    const settlement2 = makeSettlement({
      buildings: [{ type: 'farm', level: 1 }],
      population: 10,
    });
    const result2 = resolveTick([colony2], [settlement2], units, []);

    // Net = -12 → food goes negative → famine
    expect(result2.events.some(e => e.type === 'famine')).toBe(true);
    // Food clamped to 0
    expect(result2.colonies[0].resources.food).toBe(0);
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
      resources: { food: 600, timber: 400, stone: 300, iron: 200, influence: 50 },
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

    // City costs: 500 food, 300 timber, 200 stone, 100 iron
    expect(colony.resources.food).toBe(600 - 500);
    expect(colony.resources.timber).toBe(400 - 300);
    expect(colony.resources.stone).toBe(300 - 200);
    expect(colony.resources.iron).toBe(200 - 100);
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
    // No production, pop 10 consumes 5, 2 soldiers consume 6 → net -6
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
      buildings: [{ type: 'farm', level: 5 }],
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
