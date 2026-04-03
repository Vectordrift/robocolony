import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';

vi.mock('../../middleware/index.js', () => ({
  requireAuth: async (request: any) => {
    request.colony = {
      id: 'colony-1',
      worldId: 'world-1',
      name: 'Test Colony',
    };
  },
}));

vi.mock('../../db/index.js', () => ({
  db: {
    select: vi.fn(),
  },
}));

import { db } from '../../db/index.js';
import { stateRoutes } from '../state.js';

class MockSelectChain<T> implements PromiseLike<T[]> {
  constructor(private readonly rows: T[]) {}

  from() { return this; }
  where() { return this; }
  limit(count: number) { return Promise.resolve(this.rows.slice(0, count)); }
  then<TResult1 = T[], TResult2 = never>(
    onfulfilled?: ((value: T[]) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    return Promise.resolve(this.rows).then(onfulfilled, onrejected);
  }
}

function mockDbSelectQueue(rowsQueue: unknown[][]) {
  const mock = db.select as ReturnType<typeof vi.fn>;
  mock.mockImplementation(() => {
    const rows = rowsQueue.shift();
    if (!rows) throw new Error('No mocked db.select response left in queue');
    return new MockSelectChain(rows);
  });
}

describe('State route intel', () => {
  let app: ReturnType<typeof Fastify>;

  beforeEach(async () => {
    vi.clearAllMocks();
    app = Fastify({ logger: false });
    await app.register(stateRoutes);
  });

  afterEach(async () => {
    await app?.close();
  });

  it('filters destroyed enemy units out of intel.enemyUnits', async () => {
    mockDbSelectQueue([
      [{ currentTick: 99, status: 'running' }],
      [{ id: 'colony-1', status: 'active', resources: { food: 100 }, legacyScore: 0, researchedTechs: [], researchQueue: [] }],
      [],
      [],
      [],
      [{ x: 5, y: 5, terrain: 'plains', resources: { food: 3 }, settlementId: null, poi: null }],
      [{ mapRadius: 20 }],
      [
        { id: 'enemy-dead', colonyId: 'colony-2', type: 'soldier', hexX: 5, hexY: 5, health: 0 },
        { id: 'enemy-live', colonyId: 'colony-2', type: 'soldier', hexX: 5, hexY: 5, health: 80 },
      ],
      [{ id: 'colony-2', name: 'Enemy Colony' }],
      [],
    ]);

    const response = await app.inject({
      method: 'GET',
      url: '/api/worlds/world-1/state',
      headers: {
        authorization: 'Bearer rc_live_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.intel.enemyUnits).toEqual([
      {
        id: 'enemy-live',
        colonyId: 'colony-2',
        type: 'soldier',
        hex: { x: 5, y: 5 },
        health: 80,
        maxHp: 100,
      },
    ]);
  });

  it('shows Tier 2 techs as locked until all Tier 1 techs are researched', async () => {
    mockDbSelectQueue([
      [{
        id: 'colony-1',
        researchedTechs: ['improved_agriculture', 'fortifications', 'advanced_scouting'],
        researchQueue: [],
      }],
    ]);

    const response = await app.inject({
      method: 'GET',
      url: '/api/worlds/world-1/tech',
      headers: {
        authorization: 'Bearer rc_live_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    const cropRotation = body.techs.find((tech: { id: string }) => tech.id === 'crop_rotation');
    const steelWeapons = body.techs.find((tech: { id: string }) => tech.id === 'steel_weapons');

    expect(cropRotation).toMatchObject({
      id: 'crop_rotation',
      tier: 2,
      status: 'locked',
      requires: ['improved_agriculture'],
      tierGate: {
        allTier1Required: true,
        missingTechs: ['steel_weapons', 'trade_routes', 'siege_engineering'],
      },
      missingRequirements: {
        direct: [],
        tierGate: ['steel_weapons', 'trade_routes', 'siege_engineering'],
      },
      lockReason: 'Tier 2 research is locked until all Tier 1 techs are complete. Missing: Steel Weapons, Trade Routes, Siege Engineering',
    });
    expect(steelWeapons).toMatchObject({
      id: 'steel_weapons',
      tier: 1,
      status: 'available',
    });
  });

  it('exposes public roads on the map even without prior exploration', async () => {
    mockDbSelectQueue([
      [{ currentTick: 50 }],
      [],
      [
        {
          x: 4,
          y: 2,
          terrain: 'plains',
          resources: { food: 3 },
          settlementId: null,
          roads: { '5,2': { status: 'built' } },
          poi: null,
        },
        {
          x: 5,
          y: 2,
          terrain: 'plains',
          resources: { food: 2 },
          settlementId: null,
          roads: { '4,2': { status: 'built' } },
          poi: null,
        },
      ],
      [],
    ]);

    const response = await app.inject({
      method: 'GET',
      url: '/api/worlds/world-1/map',
      headers: {
        authorization: 'Bearer rc_live_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      tick: 50,
      hexCount: 2,
      hexes: expect.arrayContaining([
        expect.objectContaining({
          x: 4,
          y: 2,
          roads: [{ toX: 5, toY: 2, status: 'built' }],
        }),
      ]),
    });
  });

  it('includes visible enemy units and settlements in the map response', async () => {
    mockDbSelectQueue([
      [{ currentTick: 778 }],
      [],
      [
        { x: 36, y: -21, terrain: 'plains', resources: { food: 3 }, settlementId: 'set-enemy', roads: {}, poi: null },
        { x: 40, y: -17, terrain: 'plains', resources: { food: 2 }, settlementId: null, roads: {}, poi: null },
      ],
      [
        { id: 'enemy-1', colonyId: 'colony-2', type: 'soldier', hexX: 36, hexY: -21, health: 72 },
        { id: 'enemy-2', colonyId: 'colony-2', type: 'soldier', hexX: 40, hexY: -17, health: 91 },
      ],
      [
        { id: 'set-enemy', colonyId: 'colony-2', name: 'Iron Horde Prime', hexX: 36, hexY: -21, tier: 'town' },
      ],
      [
        { id: 'colony-2', name: 'Iron Horde' },
      ],
    ]);

    const response = await app.inject({
      method: 'GET',
      url: '/api/worlds/world-1/map',
      headers: {
        authorization: 'Bearer rc_live_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      tick: 778,
      enemyUnits: [
        {
          id: 'enemy-1',
          colonyId: 'colony-2',
          type: 'soldier',
          hex: { x: 36, y: -21 },
          health: 72,
          maxHp: 100,
        },
        {
          id: 'enemy-2',
          colonyId: 'colony-2',
          type: 'soldier',
          hex: { x: 40, y: -17 },
          health: 91,
          maxHp: 100,
        },
      ],
      settlements: [
        {
          id: 'set-enemy',
          colonyId: 'colony-2',
          name: 'Iron Horde Prime',
          hex: { x: 36, y: -21 },
          tier: 'town',
        },
      ],
      knownColonies: {
        'colony-2': 'Iron Horde',
      },
    });
  });
});
