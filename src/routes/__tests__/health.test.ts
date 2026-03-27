import { describe, it, expect, afterAll } from 'vitest';
import { buildApp } from '../../server.js';

describe('Health endpoint', () => {
  const app = buildApp();

  afterAll(async () => {
    await app.close();
  });

  it('GET /health returns status and version', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/health',
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ok', version: expect.any(String) });
  });

  it('GET /health returns correct content-type', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/health',
    });

    expect(response.headers['content-type']).toContain('application/json');
  });
});
