import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import { colonies } from '../db/schema/index.js';
import { isValidKeyFormat, verifyApiKey } from '../lib/auth.js';

export interface AuthenticatedColony {
  id: string;
  worldId: string;
  name: string;
  status: string;
}

declare module 'fastify' {
  interface FastifyRequest {
    colony?: AuthenticatedColony;
  }
}

/**
 * Extract Bearer token from Authorization header.
 */
function extractBearerToken(request: FastifyRequest): string | null {
  const authHeader = request.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null;
  }
  return authHeader.slice(7);
}

/**
 * Authenticate a request by verifying the API key against stored hashes.
 * Attaches the colony to the request object on success.
 * Also validates that the world ID in the URL (if present) matches
 * the colony's actual world — prevents cross-world confusion.
 */
async function authenticateRequest(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const apiKey = extractBearerToken(request);

  if (!apiKey) {
    reply.code(401).send({
      error: 'Unauthorized',
      message: 'Missing or invalid Authorization header. Use: Bearer <api_key>',
    });
    return;
  }

  if (!isValidKeyFormat(apiKey)) {
    reply.code(401).send({
      error: 'Unauthorized',
      message: 'Invalid API key format',
    });
    return;
  }

  // Fetch all active colonies and verify against their hashes
  // Note: with max 8 colonies per world, this is efficient enough.
  // For scale, we'd add a key_prefix column for indexed lookup.
  const allColonies = await db
    .select({
      id: colonies.id,
      worldId: colonies.worldId,
      name: colonies.name,
      apiKeyHash: colonies.apiKeyHash,
      status: colonies.status,
    })
    .from(colonies);

  for (const colony of allColonies) {
    const isValid = await verifyApiKey(apiKey, colony.apiKeyHash);
    if (isValid) {
      if (colony.status === 'eliminated') {
        reply.code(403).send({
          error: 'Forbidden',
          message: 'This colony has been eliminated',
        });
        return;
      }

      // Validate world ID from URL matches the colony's world
      const params = request.params as Record<string, string> | undefined;
      const urlWorldId = params?.id;
      if (urlWorldId && urlWorldId !== colony.worldId) {
        reply.code(403).send({
          error: 'Forbidden',
          message: 'API key does not belong to this world',
        });
        return;
      }

      request.colony = {
        id: colony.id,
        worldId: colony.worldId,
        name: colony.name,
        status: colony.status,
      };
      return;
    }
  }

  reply.code(401).send({
    error: 'Unauthorized',
    message: 'Invalid API key',
  });
}

/**
 * Register the auth middleware as a Fastify plugin.
 * Adds an `authenticate` decorator that can be used as a preHandler.
 */
export async function authPlugin(app: FastifyInstance): Promise<void> {
  app.decorate('authenticate', authenticateRequest);
}

/**
 * Standalone auth preHandler for use in route definitions.
 */
export const requireAuth = authenticateRequest;
