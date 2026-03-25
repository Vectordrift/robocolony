/**
 * Diplomatic agreement endpoints.
 *
 * GET /api/worlds/:id/agreements — list agreements for authenticated colony
 */

import type { FastifyInstance } from 'fastify';
import { eq, and, or, desc } from 'drizzle-orm';
import { db } from '../db/index.js';
import { worlds, agreements, colonies } from '../db/schema/index.js';
import { requireAuth } from '../middleware/index.js';

// --- Types ---

interface AgreementsQueryParams {
  Params: { id: string };
  Querystring: {
    status?: string;
    type?: string;
  };
}

// --- Routes ---

export async function agreementRoutes(app: FastifyInstance) {
  // Get colony's agreements (proposed, active, broken, rejected)
  app.get<AgreementsQueryParams>('/api/worlds/:id/agreements', {
    preHandler: requireAuth,
  }, async (request, reply) => {
    const colony = request.colony!;
    const worldId = colony.worldId;

    // Verify the world ID in the URL matches the colony's world
    if (request.params.id !== worldId) {
      return reply.code(403).send({
        error: 'forbidden',
        message: 'Colony does not belong to this world',
      });
    }

    // Get world for current tick
    const world = await db
      .select({ currentTick: worlds.currentTick })
      .from(worlds)
      .where(eq(worlds.id, worldId))
      .limit(1);

    if (world.length === 0) {
      return reply.code(404).send({ error: 'not_found', message: 'World not found' });
    }

    // Build colony name lookup
    const colonyRows = await db
      .select({ id: colonies.id, name: colonies.name })
      .from(colonies)
      .where(eq(colonies.worldId, worldId));

    const colonyNameMap = new Map<string, string>();
    for (const c of colonyRows) {
      colonyNameMap.set(c.id, c.name);
    }

    // Query agreements involving this colony
    const conditions = [
      eq(agreements.worldId, worldId),
      or(
        eq(agreements.proposedBy, colony.id),
        eq(agreements.proposedTo, colony.id),
      ),
    ];

    const rows = await db
      .select({
        id: agreements.id,
        type: agreements.type,
        proposedBy: agreements.proposedBy,
        proposedTo: agreements.proposedTo,
        status: agreements.status,
        terms: agreements.terms,
        proposedAtTick: agreements.proposedAtTick,
        acceptedAtTick: agreements.acceptedAtTick,
      })
      .from(agreements)
      .where(and(...conditions))
      .orderBy(desc(agreements.proposedAtTick));

    // Filter by status/type if query params provided
    let filtered = rows;
    if (request.query.status) {
      filtered = filtered.filter(r => r.status === request.query.status);
    }
    if (request.query.type) {
      filtered = filtered.filter(r => r.type === request.query.type);
    }

    const mappedAgreements = filtered.map(row => ({
      id: row.id,
      type: row.type,
      proposedBy: row.proposedBy,
      proposedByName: colonyNameMap.get(row.proposedBy) ?? 'Unknown',
      proposedTo: row.proposedTo,
      proposedToName: colonyNameMap.get(row.proposedTo) ?? 'Unknown',
      status: row.status,
      terms: row.terms,
      proposedAtTick: row.proposedAtTick,
      acceptedAtTick: row.acceptedAtTick,
    }));

    return {
      tick: world[0].currentTick,
      colonyId: colony.id,
      count: mappedAgreements.length,
      agreements: mappedAgreements,
    };
  });
}
