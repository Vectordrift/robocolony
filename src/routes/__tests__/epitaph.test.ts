import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import { generateApiKey, hashApiKey } from '../../lib/auth.js';

vi.mock('../../db/index.js', () => ({
  db: {
    select: vi.fn(),
  },
}));

import { db } from '../../db/index.js';
import { epitaphRoutes } from '../epitaph.js';

class MockSelectChain<T> implements PromiseLike<T[]> {
  constructor(private readonly rows: T[]) {}

  from() { return this; }
  where() { return this; }
  orderBy() { return this; }
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

describe('Epitaph endpoint', () => {
  let app: ReturnType<typeof Fastify>;

  beforeEach(async () => {
    vi.clearAllMocks();
    app = Fastify({ logger: false });
    await app.register(epitaphRoutes);
  });

  afterEach(async () => {
    await app?.close();
  });

  it('returns an epitaph for an eliminated colony using its old API key', async () => {
    const apiKey = generateApiKey();
    const hash = await hashApiKey(apiKey);

    mockDbSelectQueue([
      [
        { id: 'colony-1', worldId: 'world-1', name: 'Dead Colony', apiKeyHash: hash, status: 'eliminated' },
      ],
      [
        { currentTick: 120, status: 'running' },
      ],
      [
        {
          id: 'colony-1',
          worldId: 'world-1',
          name: 'Dead Colony',
          status: 'eliminated',
          diedAtTick: 118,
          deathReason: 'All settlements captured',
          resources: { food: 0, timber: 3, stone: 1, iron: 0, influence: 12 },
          legacyScore: 42,
        },
      ],
      [],
      [],
      [
        {
          id: 'evt-1',
          tick: 118,
          type: 'colony_eliminated',
          public: false,
          visibility: ['colony-1'],
          data: { eliminatedBy: 'colony-2', reason: 'All settlements captured' },
          publicData: null,
        },
        {
          id: 'evt-2',
          tick: 117,
          type: 'combat_resolved',
          public: true,
          visibility: ['colony-1', 'colony-2'],
          data: { result: 'loss' },
          publicData: { result: 'loss' },
        },
      ],
      [
        { id: 'colony-2', name: 'Invaders' },
      ],
    ]);

    const response = await app.inject({
      method: 'GET',
      url: '/api/worlds/world-1/epitaph',
      headers: { authorization: `Bearer ${apiKey}` },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.colony).toEqual({
      id: 'colony-1',
      name: 'Dead Colony',
      status: 'eliminated',
    });
    expect(body.epitaph.cause).toBe('conquest');
    expect(body.epitaph.deathTick).toBe(118);
    expect(body.epitaph.attackerColony).toEqual({ id: 'colony-2', name: 'Invaders' });
    expect(body.epitaph.finalState.resources).toEqual({ food: 0, timber: 3, stone: 1, iron: 0, influence: 12 });
    expect(body.epitaph.recentEvents).toHaveLength(2);
  });

  it('returns 409 when the colony is still alive', async () => {
    const apiKey = generateApiKey();
    const hash = await hashApiKey(apiKey);

    mockDbSelectQueue([
      [
        { id: 'colony-1', worldId: 'world-1', name: 'Alive Colony', apiKeyHash: hash, status: 'active' },
      ],
      [
        { currentTick: 50, status: 'running' },
      ],
      [
        {
          id: 'colony-1',
          worldId: 'world-1',
          name: 'Alive Colony',
          status: 'active',
          diedAtTick: null,
          deathReason: null,
          resources: { food: 100, timber: 50, stone: 30, iron: 10, influence: 50 },
          legacyScore: 0,
        },
      ],
    ]);

    const response = await app.inject({
      method: 'GET',
      url: '/api/worlds/world-1/epitaph',
      headers: { authorization: `Bearer ${apiKey}` },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json().error).toBe('colony_alive');
  });
});
