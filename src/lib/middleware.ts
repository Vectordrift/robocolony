/**
 * Authentication middleware for colony API endpoints.
 * 
 * Expects: Authorization: Bearer rc_live_...
 * Decorates request with `colony` (id, worldId, name) on success.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import { colonies } from '../db/schema/index.js';
import { isValidKeyFormat, verifyApiKey } from './auth.js';

export interface AuthenticatedColony {
  id: string;
  worldId: string;
  name: string;
}

declare module 'fastify' {
  interface FastifyRequest {
    colony?: AuthenticatedColony;
  }
}

/**
 * Authenticate a request by API key and world ID.
 * Returns the colony if valid, or sends 401/403 and returns null.
 */
export async function authenticateColony(
  request: FastifyRequest<{ Params: { id: string } }>,
  reply: FastifyReply,
): Promise<AuthenticatedColony | null> {
  const authHeader = request.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    reply.code(401).send({ error: 'unauthorized', message: 'Missing or invalid Authorization header' });
    return null;
  }

  const apiKey = authHeader.slice(7);
  if (!isValidKeyFormat(apiKey)) {
    reply.code(401).send({ error: 'unauthorized', message: 'Invalid API key format' });
    return null;
  }

  const worldId = request.params.id;

  // Find all colonies in this world and verify against each
  // (In production you'd use a key prefix index — good enough for MVP)
  const worldColonies = await db
    .select({
      id: colonies.id,
      worldId: colonies.worldId,
      name: colonies.name,
      apiKeyHash: colonies.apiKeyHash,
      status: colonies.status,
    })
    .from(colonies)
    .where(eq(colonies.worldId, worldId));

  for (const colony of worldColonies) {
    const valid = await verifyApiKey(apiKey, colony.apiKeyHash);
    if (valid) {
      if (colony.status === 'eliminated') {
        reply.code(403).send({ error: 'eliminated', message: 'Your colony has been eliminated' });
        return null;
      }
      const authenticated = { id: colony.id, worldId: colony.worldId, name: colony.name };
      request.colony = authenticated;
      return authenticated;
    }
  }

  reply.code(401).send({ error: 'unauthorized', message: 'Invalid API key' });
  return null;
}
