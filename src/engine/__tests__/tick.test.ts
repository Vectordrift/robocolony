import { describe, it, expect } from 'vitest';
import {
  resolveTick,
  resolveMovement,
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
  type QueuedAction,
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

    // Colony 2 should lose food (no production, 3 food upkeep, started at 5)
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
});
