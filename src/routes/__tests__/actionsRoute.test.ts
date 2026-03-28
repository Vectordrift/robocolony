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

vi.mock('../../db/index.js', () => ({
  db: {
    select: vi.fn(),
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
    app = Fastify({ logger: false });
    await app.register(actionRoutes);
  });

  afterEach(async () => {
    await app?.close();
  });

  it('rejects research submissions when the colony has no workshop', async () => {
    mockDbSelectQueue([
      [{ currentTick: 42, status: 'active', mapRadius: 12 }],
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
          error: 'You need a workshop building to research. Build a workshop first.',
        },
      ],
    });
  });
});
