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

describe('Settlement site analysis route', () => {
  let app: ReturnType<typeof Fastify>;

  beforeEach(async () => {
    vi.clearAllMocks();
    app = Fastify({ logger: false });
    await app.register(stateRoutes);
  });

  afterEach(async () => {
    await app?.close();
  });

  it('returns ranked settlement candidates from the visible map', async () => {
    mockDbSelectQueue([
      [{ currentTick: 556 }],
      [],
      [
        { x: 0, y: 0, terrain: 'plains', resources: { food: 3, timber: 1, stone: 0, iron: 0 }, settlementId: 'set-home', poi: null },
        { x: 1, y: 0, terrain: 'plains', resources: { food: 5, timber: 0, stone: 0, iron: 0 }, settlementId: null, poi: null },
        { x: 1, y: -1, terrain: 'forest', resources: { food: 2, timber: 4, stone: 0, iron: 0 }, settlementId: null, poi: null },
        { x: 2, y: -1, terrain: 'mountains', resources: { food: 0, timber: 0, stone: 4, iron: 2 }, settlementId: null, poi: null },
        { x: 2, y: 0, terrain: 'plains', resources: { food: 4, timber: 1, stone: 0, iron: 0 }, settlementId: null, poi: { type: 'watchtower' } },
        { x: 2, y: 1, terrain: 'coast', resources: { food: 3, timber: 0, stone: 0, iron: 0 }, settlementId: null, poi: null },
        { x: 3, y: 0, terrain: 'plains', resources: { food: 4, timber: 1, stone: 0, iron: 0 }, settlementId: null, poi: null },
        { x: 3, y: -1, terrain: 'forest', resources: { food: 1, timber: 3, stone: 0, iron: 0 }, settlementId: null, poi: null },
        { x: 4, y: -1, terrain: 'mountains', resources: { food: 0, timber: 0, stone: 3, iron: 3 }, settlementId: null, poi: null },
        { x: 4, y: 0, terrain: 'plains', resources: { food: 5, timber: 0, stone: 0, iron: 0 }, settlementId: null, poi: { type: 'sacred_grove' } },
        { x: 3, y: 1, terrain: 'plains', resources: { food: 4, timber: 0, stone: 0, iron: 0 }, settlementId: null, poi: null },
      ],
    ]);

    const response = await app.inject({
      method: 'GET',
      url: '/api/worlds/world-1/analysis/settlement-sites?limit=2',
      headers: {
        authorization: 'Bearer rc_live_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.tick).toBe(556);
    expect(body.count).toBe(2);
    expect(body.candidates[0]).toMatchObject({
      x: 3,
      y: 0,
    });
    expect(body.candidates[0].reasons).toEqual(expect.arrayContaining([expect.stringContaining('Food reach')]));
  });
});
