/**
 * Event feed endpoint — private event history for colonies.
 *
 * GET /api/worlds/:id/events — returns events visible to the authenticated colony
 *   Query params:
 *     since_tick — only events after this tick (exclusive)
 *     limit      — max events to return (default 50, max 200)
 */
import { eq, and, gt, desc, sql, or } from 'drizzle-orm';
import { db } from '../db/index.js';
import { worlds, events } from '../db/schema/index.js';
import { requireAuth } from '../middleware/index.js';
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;
// --- Routes ---
export async function eventRoutes(app) {
    // Get colony events
    app.get('/api/worlds/:id/events', {
        preHandler: requireAuth,
    }, async (request, reply) => {
        const colony = request.colony;
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
        if (isNaN(limit) || limit < 1)
            limit = DEFAULT_LIMIT;
        if (limit > MAX_LIMIT)
            limit = MAX_LIMIT;
        // Build query conditions
        const conditions = [
            eq(events.worldId, worldId),
            // Colony can see: public events OR events where their colony is in visibility array
            or(eq(events.public, true), sql `${colony.id} = ANY(${events.visibility})`),
        ];
        if (sinceTick !== undefined && !isNaN(sinceTick)) {
            conditions.push(gt(events.tick, sinceTick));
        }
        // Query events
        const rows = await db
            .select({
            id: events.id,
            tick: events.tick,
            type: events.type,
            public: events.public,
            visibility: events.visibility,
            data: events.data,
            publicData: events.publicData,
        })
            .from(events)
            .where(and(...conditions))
            .orderBy(desc(events.tick))
            .limit(limit);
        // For public events from other colonies, return publicData instead of full data.
        // A colony "owns" an event if its ID is in the visibility array.
        // Public events without the colony in visibility are from other colonies —
        // those get the redacted publicData to prevent information leakage.
        const mappedEvents = rows.map((row) => {
            const isOwnEvent = Array.isArray(row.visibility) && row.visibility.includes(colony.id);
            // Use full data for own events, publicData for other colonies' public events
            const eventData = isOwnEvent
                ? row.data
                : (row.publicData ?? row.data); // fall back to data if publicData not set
            return {
                id: row.id,
                tick: row.tick,
                type: row.type,
                data: eventData,
                public: row.public,
                own: isOwnEvent, // let clients distinguish own vs observed events
            };
        });
        return {
            tick: world[0].currentTick,
            colonyId: colony.id,
            count: mappedEvents.length,
            events: mappedEvents,
        };
    });
}
//# sourceMappingURL=events.js.map
