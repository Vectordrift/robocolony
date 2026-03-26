import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import Fastify from 'fastify';
import { generateApiKey, hashApiKey } from '../../lib/auth.js';

// Mock the db module before importing auth middleware
vi.mock('../../db/index.js', () => ({
  db: {
    select: vi.fn(),
  },
}));

import { db } from '../../db/index.js';
import { requireAuth } from '../auth.js';

// Helper to build a test app with a protected route
function buildTestApp() {
  const app = Fastify({ logger: false });

  app.get('/protected', {
    preHandler: requireAuth,
    handler: async (request) => {
      return { colony: request.colony };
    },
  });

  // World-scoped route for world ID validation tests
  app.get<{ Params: { id: string } }>('/api/worlds/:id/state', {
    preHandler: requireAuth,
    handler: async (request) => {
      return { colony: request.colony };
    },
  });

  return app;
}

// Helper to create a mock query builder chain
function mockDbSelect(rows: unknown[]) {
  const chain = {
    from: vi.fn().mockResolvedValue(rows),
  };
  (db.select as ReturnType<typeof vi.fn>).mockReturnValue(chain);
  return chain;
}

describe('Auth middleware', () => {
  let app: ReturnType<typeof buildTestApp>;

  beforeEach(() => {
    vi.clearAllMocks();
    app = buildTestApp();
  });

  afterAll(async () => {
    await app?.close();
  });

  it('returns 401 when no Authorization header', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/protected',
    });

    expect(response.statusCode).toBe(401);
    expect(response.json().error).toBe('Unauthorized');
    expect(response.json().message).toContain('Missing');
  });

  it('returns 401 for non-Bearer auth', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/protected',
      headers: { authorization: 'Basic abc123' },
    });

    expect(response.statusCode).toBe(401);
  });

  it('returns 401 for invalid key format', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/protected',
      headers: { authorization: 'Bearer invalid_key_format' },
    });

    expect(response.statusCode).toBe(401);
    expect(response.json().message).toContain('Invalid API key format');
  });

  it('returns 401 when key does not match any colony', async () => {
    const apiKey = generateApiKey();
    const otherKey = generateApiKey();
    const hash = await hashApiKey(otherKey);

    mockDbSelect([
      { id: 'colony-1', worldId: 'world-1', name: 'TestColony', apiKeyHash: hash, status: 'active' },
    ]);

    const response = await app.inject({
      method: 'GET',
      url: '/protected',
      headers: { authorization: `Bearer ${apiKey}` },
    });

    expect(response.statusCode).toBe(401);
    expect(response.json().message).toBe('Invalid API key');
  });

  it('returns 403 for eliminated colony', async () => {
    const apiKey = generateApiKey();
    const hash = await hashApiKey(apiKey);

    mockDbSelect([
      { id: 'colony-1', worldId: 'world-1', name: 'DeadColony', apiKeyHash: hash, status: 'eliminated' },
    ]);

    const response = await app.inject({
      method: 'GET',
      url: '/protected',
      headers: { authorization: `Bearer ${apiKey}` },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json().message).toContain('eliminated');
  });

  it('authenticates valid key and attaches colony to request', async () => {
    const apiKey = generateApiKey();
    const hash = await hashApiKey(apiKey);

    mockDbSelect([
      { id: 'colony-1', worldId: 'world-1', name: 'GoodColony', apiKeyHash: hash, status: 'active' },
    ]);

    const response = await app.inject({
      method: 'GET',
      url: '/protected',
      headers: { authorization: `Bearer ${apiKey}` },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.colony).toEqual({
      id: 'colony-1',
      worldId: 'world-1',
      name: 'GoodColony',
      status: 'active',
    });
  });

  it('works with at_war status (not blocked)', async () => {
    const apiKey = generateApiKey();
    const hash = await hashApiKey(apiKey);

    mockDbSelect([
      { id: 'colony-2', worldId: 'world-1', name: 'WarColony', apiKeyHash: hash, status: 'at_war' },
    ]);

    const response = await app.inject({
      method: 'GET',
      url: '/protected',
      headers: { authorization: `Bearer ${apiKey}` },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().colony.status).toBe('at_war');
  });

  it('matches correct colony among multiple', async () => {
    const apiKey1 = generateApiKey();
    const apiKey2 = generateApiKey();
    const hash1 = await hashApiKey(apiKey1);
    const hash2 = await hashApiKey(apiKey2);

    mockDbSelect([
      { id: 'colony-1', worldId: 'world-1', name: 'First', apiKeyHash: hash1, status: 'active' },
      { id: 'colony-2', worldId: 'world-1', name: 'Second', apiKeyHash: hash2, status: 'active' },
    ]);

    const response = await app.inject({
      method: 'GET',
      url: '/protected',
      headers: { authorization: `Bearer ${apiKey2}` },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().colony.name).toBe('Second');
  });

  // World ID validation tests
  it('returns 403 when world ID in URL does not match colony world', async () => {
    const apiKey = generateApiKey();
    const hash = await hashApiKey(apiKey);

    mockDbSelect([
      { id: 'colony-1', worldId: 'world-1', name: 'MyColony', apiKeyHash: hash, status: 'active' },
    ]);

    const response = await app.inject({
      method: 'GET',
      url: '/api/worlds/WRONG_WORLD/state',
      headers: { authorization: `Bearer ${apiKey}` },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json().error).toBe('Forbidden');
    expect(response.json().message).toContain('does not belong to this world');
  });

  it('allows request when world ID in URL matches colony world', async () => {
    const apiKey = generateApiKey();
    const hash = await hashApiKey(apiKey);

    mockDbSelect([
      { id: 'colony-1', worldId: 'world-1', name: 'MyColony', apiKeyHash: hash, status: 'active' },
    ]);

    const response = await app.inject({
      method: 'GET',
      url: '/api/worlds/world-1/state',
      headers: { authorization: `Bearer ${apiKey}` },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().colony.worldId).toBe('world-1');
  });

  it('blocks null-byte injection in world ID', async () => {
    const apiKey = generateApiKey();
    const hash = await hashApiKey(apiKey);

    mockDbSelect([
      { id: 'colony-1', worldId: 'world-1', name: 'MyColony', apiKeyHash: hash, status: 'active' },
    ]);

    const response = await app.inject({
      method: 'GET',
      url: '/api/worlds/world-1%00INJECTED/state',
      headers: { authorization: `Bearer ${apiKey}` },
    });

    // URL-decoded param will be "world-1\0INJECTED" which !== "world-1"
    expect(response.statusCode).toBe(403);
  });
});
