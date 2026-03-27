import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';

const insertValuesMock = vi.fn();

vi.mock('../../db/index.js', () => ({
  db: {
    select: vi.fn(),
    insert: vi.fn(() => ({
      values: insertValuesMock,
    })),
  },
}));

import { db } from '../../db/index.js';
import { feedbackRoutes } from '../feedback.js';

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

describe('Feedback routes', () => {
  let app: ReturnType<typeof Fastify>;

  beforeEach(async () => {
    vi.clearAllMocks();
    insertValuesMock.mockResolvedValue(undefined);
    app = Fastify({ logger: false });
    await app.register(feedbackRoutes);
  });

  afterEach(async () => {
    await app?.close();
  });

  it('stores a feedback report for a world', async () => {
    mockDbSelectQueue([
      [{ id: 'world-1', currentTick: 42, name: 'Alpha' }],
    ]);

    const response = await app.inject({
      method: 'POST',
      url: '/api/worlds/world-1/feedback',
      payload: {
        type: 'bug',
        title: 'Combat duplicates in feed',
        description: 'I saw the same combat reported twice.',
        reporterName: 'Playtester',
      },
    });

    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(body.feedback.type).toBe('bug');
    expect(body.feedback.tick).toBe(42);
    expect(insertValuesMock).toHaveBeenCalledTimes(1);
    expect(insertValuesMock.mock.calls[0][0]).toMatchObject({
      worldId: 'world-1',
      reporterName: 'Playtester',
      type: 'bug',
      title: 'Combat duplicates in feed',
      description: 'I saw the same combat reported twice.',
      tick: 42,
    });
  });

  it('rejects invalid feedback type', async () => {
    mockDbSelectQueue([
      [{ id: 'world-1', currentTick: 42, name: 'Alpha' }],
    ]);

    const response = await app.inject({
      method: 'POST',
      url: '/api/worlds/world-1/feedback',
      payload: {
        type: 'praise',
        title: 'Nice game',
        description: 'This is fun',
      },
    });

    expect(response.statusCode).toBe(400);
    expect(insertValuesMock).not.toHaveBeenCalled();
  });

  it('lists public feedback reports', async () => {
    mockDbSelectQueue([
      [
        {
          id: 'fb_1',
          worldId: 'world-1',
          colonyId: 'colony-1',
          reporterName: 'Playtester',
          type: 'suggestion',
          title: 'Add more diplomacy',
          description: 'More treaty types would help.',
          tick: 55,
          metadata: { source: 'api' },
          createdAt: new Date('2026-03-27T10:00:00Z'),
        },
      ],
      [
        { id: 'world-1', name: 'Alpha' },
      ],
    ]);

    const response = await app.inject({
      method: 'GET',
      url: '/api/feedback?limit=20',
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.count).toBe(1);
    expect(body.reports[0]).toMatchObject({
      id: 'fb_1',
      worldId: 'world-1',
      worldName: 'Alpha',
      reporterName: 'Playtester',
      type: 'suggestion',
      title: 'Add more diplomacy',
      tick: 55,
    });
  });
});
