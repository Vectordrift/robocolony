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

const updateWhereMock = vi.fn().mockResolvedValue({ rowCount: 0 });
const insertValuesMock = vi.fn().mockResolvedValue(undefined);

vi.mock('../../db/index.js', () => ({
  db: {
    select: vi.fn(),
    insert: vi.fn(() => ({
      values: insertValuesMock,
    })),
    update: vi.fn(() => ({
      set: vi.fn(() => ({
        where: updateWhereMock,
      })),
    })),
  },
}));

import { db } from '../../db/index.js';
import { actionRoutes } from '../actions.js';

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

describe('Action submission route', () => {
  let app: ReturnType<typeof Fastify>;

  beforeEach(async () => {
    vi.clearAllMocks();
    updateWhereMock.mockResolvedValue({ rowCount: 0 });
    insertValuesMock.mockResolvedValue(undefined);
    app = Fastify({ logger: false });
    await app.register(actionRoutes);
  });

  afterEach(async () => {
    await app?.close();
  });

  it('exposes a comprehensive action schema endpoint', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/worlds/world-1/actions/schema',
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      maxActionsPerTick: 10,
      actionCapacity: {
        basePerTick: 10,
        perSettlement: 2,
        perUnitBlock: 1,
        unitsPerBlock: 20,
      },
      notes: {
        unknownParamsStripped: true,
        validationErrorsIncludeHints: true,
      },
      actionTypes: {
        move_unit: {
          description: expect.any(String),
          required: ['unitId', 'targetX', 'targetY'],
          optional: [],
          params: {
            unitId: { type: 'string', description: expect.any(String) },
            targetX: { type: 'integer', description: expect.any(String) },
            targetY: { type: 'integer', description: expect.any(String) },
          },
        },
        build: {
          params: {
            buildingType: {
              validValues: expect.arrayContaining(['farm', 'workshop']),
            },
          },
        },
        train_unit: {
          params: {
            unitType: {
              validValues: expect.arrayContaining(['engineer']),
            },
          },
        },
        research: {
          params: {
            techId: {
              validValues: expect.arrayContaining(['improved_agriculture', 'civil_engineering']),
            },
          },
        },
        build_road: {
          required: ['unitId', 'fromX', 'fromY', 'toX', 'toY'],
        },
        propose_agreement: {
          optional: ['terms'],
        },
      },
    });
  });

  it('returns actionable validation hints for malformed actions', async () => {
    mockDbSelectQueue([
      [{ currentTick: 42, status: 'active', mapRadius: 12 }],
      [{ count: 1 }],
      [{ count: 0 }],
    ]);

    const response = await app.inject({
      method: 'POST',
      url: '/api/worlds/world-1/actions',
      headers: {
        authorization: 'Bearer rc_live_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      },
      payload: {
        actions: [
          { type: 'build', params: { settlementId: 'set-1' } },
        ],
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      error: 'validation_error',
      details: [
        {
          index: 0,
          actionType: 'build',
          error: "Missing required param 'buildingType' for action type 'build'",
          help: {
            requiredParams: ['settlementId', 'buildingType'],
            optionalParams: [],
          },
        },
      ],
    });
  });

  it('rejects research submissions when the colony has no workshop', async () => {
    mockDbSelectQueue([
      [{ currentTick: 42, status: 'active', mapRadius: 12 }],
      [{ count: 1 }],
      [{ count: 0 }],
      [{ buildings: [{ type: 'farm', level: 1 }] }],
    ]);

    const response = await app.inject({
      method: 'POST',
      url: '/api/worlds/world-1/actions',
      headers: {
        authorization: 'Bearer rc_live_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      },
      payload: {
        actions: [
          { type: 'research', params: { techId: 'advanced_scouting' } },
        ],
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      error: 'validation_error',
      details: [
        {
          index: 0,
          actionType: 'research',
          error: 'You need a workshop building to research. Build a workshop first.',
        },
      ],
    });
  });

  it('rejects research submissions with an unknown techId immediately', async () => {
    mockDbSelectQueue([
      [{ currentTick: 42, status: 'active', mapRadius: 12 }],
      [{ count: 1 }],
      [{ count: 0 }],
    ]);

    const response = await app.inject({
      method: 'POST',
      url: '/api/worlds/world-1/actions',
      headers: {
        authorization: 'Bearer rc_live_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      },
      payload: {
        actions: [
          { type: 'research', params: { techId: 'test_invalid' } },
        ],
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      error: 'validation_error',
      details: [
        {
          index: 0,
          actionType: 'research',
          error: expect.stringContaining("Unknown techId 'test_invalid'. Valid:"),
          help: {
            validValues: expect.arrayContaining(['improved_agriculture', 'civil_engineering']),
          },
        },
      ],
    });
  });

  it('rejects build_road submissions before Civil Engineering is researched', async () => {
    mockDbSelectQueue([
      [{ currentTick: 42, status: 'active', mapRadius: 12 }],
      [{ count: 1 }],
      [{ count: 0 }],
      [{ colonyId: 'colony-1', type: 'engineer' }],
      [{ researchedTechs: [] }],
    ]);

    const response = await app.inject({
      method: 'POST',
      url: '/api/worlds/world-1/actions',
      headers: {
        authorization: 'Bearer rc_live_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      },
      payload: {
        actions: [
          { type: 'build_road', params: { unitId: 'eng-1', fromX: 0, fromY: 0, toX: 1, toY: 0 } },
        ],
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      error: 'validation_error',
      details: [
        {
          index: 0,
          actionType: 'build_road',
          error: 'You need Civil Engineering before engineers can build roads.',
        },
      ],
    });
  });

  it('rejects Tier 2 research submissions until all Tier 1 techs are complete', async () => {
    mockDbSelectQueue([
      [{ currentTick: 42, status: 'active', mapRadius: 12 }],
      [{ count: 1 }],
      [{ count: 0 }],
      [{ buildings: [{ type: 'workshop', level: 1 }] }],
      [{ researchedTechs: ['improved_agriculture', 'fortifications', 'advanced_scouting'] }],
    ]);

    const response = await app.inject({
      method: 'POST',
      url: '/api/worlds/world-1/actions',
      headers: {
        authorization: 'Bearer rc_live_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      },
      payload: {
        actions: [
          { type: 'research', params: { techId: 'crop_rotation' } },
        ],
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      error: 'validation_error',
      details: [
        {
          index: 0,
          actionType: 'research',
          error: expect.stringContaining('Tier 2 research is locked'),
        },
      ],
    });
  });

  it('rejects foundry builds until metallurgy is researched', async () => {
    mockDbSelectQueue([
      [{ currentTick: 42, status: 'active', mapRadius: 12 }],
      [{ count: 1 }],
      [{ count: 0 }],
      [{ colonyId: 'colony-1' }],
      [{ researchedTechs: [] }],
    ]);

    const response = await app.inject({
      method: 'POST',
      url: '/api/worlds/world-1/actions',
      headers: {
        authorization: 'Bearer rc_live_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      },
      payload: {
        actions: [
          { type: 'build', params: { settlementId: 'settlement-1', buildingType: 'foundry' } },
        ],
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      error: 'validation_error',
      details: [
        {
          index: 0,
          actionType: 'build',
          error: 'foundry requires Metallurgy',
        },
      ],
    });
  });

  it('scales action capacity with settlements and unit count', async () => {
    mockDbSelectQueue([
      [{ currentTick: 42, status: 'active', mapRadius: 12 }],
      [{ count: 9 }],
      [{ count: 126 }],
      [{ count: 0 }],
    ]);

    const response = await app.inject({
      method: 'POST',
      url: '/api/worlds/world-1/actions',
      headers: {
        authorization: 'Bearer rc_live_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      },
      payload: {
        actions: Array.from({ length: 34 }, (_, i) => ({
          type: 'send_message',
          params: {
            toColonyId: `colony-${i + 2}`,
            message: `Reinforce front ${i + 1}`,
          },
        })),
      },
    });

    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(body.submitted).toBe(34);
    expect(body.truncated).toBeUndefined();
    expect(insertValuesMock).toHaveBeenCalledTimes(34);
  });
});
