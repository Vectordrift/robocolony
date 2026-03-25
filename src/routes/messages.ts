/**
 * Colony-to-colony messaging endpoints.
 *
 * GET  /api/worlds/:id/messages       — inbox for authenticated colony (with pagination)
 * POST /api/worlds/:id/messages/:msgId/read — mark a message as read
 */

import type { FastifyInstance } from 'fastify';
import { eq, and, or, desc, sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { worlds, messages, colonies } from '../db/schema/index.js';
import { requireAuth } from '../middleware/index.js';

// --- Types ---

interface MessagesQueryParams {
  Params: { id: string };
  Querystring: {
    since_tick?: string;
    limit?: string;
    unread_only?: string;
  };
}

interface MarkReadParams {
  Params: { id: string; msgId: string };
}

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

// --- Routes ---

export async function messageRoutes(app: FastifyInstance) {
  // Get colony inbox (messages sent to or from this colony)
  app.get<MessagesQueryParams>('/api/worlds/:id/messages', {
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

    // Parse query params
    const sinceTick = request.query.since_tick
      ? parseInt(request.query.since_tick, 10)
      : undefined;

    let limit = request.query.limit
      ? parseInt(request.query.limit, 10)
      : DEFAULT_LIMIT;

    if (isNaN(limit) || limit < 1) limit = DEFAULT_LIMIT;
    if (limit > MAX_LIMIT) limit = MAX_LIMIT;

    const unreadOnly = request.query.unread_only === 'true';

    // Build query conditions — colony can see messages sent TO or FROM them
    const conditions = [
      eq(messages.worldId, worldId),
      or(
        eq(messages.toColony, colony.id),
        eq(messages.fromColony, colony.id),
      ),
    ];

    if (sinceTick !== undefined && !isNaN(sinceTick)) {
      conditions.push(sql`${messages.sentAtTick} > ${sinceTick}`);
    }

    if (unreadOnly) {
      conditions.push(eq(messages.read, false));
      // Only unread for messages sent TO this colony
      conditions.push(eq(messages.toColony, colony.id));
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

    // Query messages
    const rows = await db
      .select({
        id: messages.id,
        fromColony: messages.fromColony,
        toColony: messages.toColony,
        sentAtTick: messages.sentAtTick,
        deliveredAtTick: messages.deliveredAtTick,
        content: messages.content,
        read: messages.read,
      })
      .from(messages)
      .where(and(...conditions))
      .orderBy(desc(messages.sentAtTick))
      .limit(limit);

    const mappedMessages = rows.map(row => ({
      id: row.id,
      fromColony: row.fromColony,
      fromColonyName: colonyNameMap.get(row.fromColony) ?? 'Unknown',
      toColony: row.toColony,
      toColonyName: colonyNameMap.get(row.toColony) ?? 'Unknown',
      sentAtTick: row.sentAtTick,
      deliveredAtTick: row.deliveredAtTick,
      content: row.content,
      read: row.read,
    }));

    return {
      tick: world[0].currentTick,
      colonyId: colony.id,
      count: mappedMessages.length,
      messages: mappedMessages,
    };
  });

  // Mark a message as read
  app.post<MarkReadParams>('/api/worlds/:id/messages/:msgId/read', {
    preHandler: requireAuth,
  }, async (request, reply) => {
    const colony = request.colony!;
    const worldId = colony.worldId;
    const { msgId } = request.params;

    // Verify the world ID in the URL matches the colony's world
    if (request.params.id !== worldId) {
      return reply.code(403).send({
        error: 'forbidden',
        message: 'Colony does not belong to this world',
      });
    }

    // Find the message — must be addressed TO this colony
    const rows = await db
      .select({
        id: messages.id,
        toColony: messages.toColony,
        read: messages.read,
      })
      .from(messages)
      .where(
        and(
          eq(messages.id, msgId),
          eq(messages.worldId, worldId),
        ),
      )
      .limit(1);

    if (rows.length === 0) {
      return reply.code(404).send({ error: 'not_found', message: 'Message not found' });
    }

    // Only the recipient can mark a message as read
    if (rows[0].toColony !== colony.id) {
      return reply.code(403).send({
        error: 'forbidden',
        message: 'Only the recipient can mark a message as read',
      });
    }

    if (rows[0].read) {
      return { id: msgId, read: true, message: 'Already marked as read' };
    }

    // Mark as read
    await db
      .update(messages)
      .set({ read: true })
      .where(eq(messages.id, msgId));

    return { id: msgId, read: true };
  });
}
