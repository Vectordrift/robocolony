/**
 * Public feed endpoint — world activity visible to spectators.
 *
 * GET /api/worlds/:id/feed — public events + colony summary (no auth required)
 *   Query params:
 *     since_tick — only events after this tick (exclusive)
 *     limit      — max events to return (default 50, max 200)
 */
import { eq, and, gt, desc } from 'drizzle-orm';
import { db } from '../db/index.js';
import { worlds, events, colonies, settlements, units } from '../db/schema/index.js';
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;
// --- Routes ---
export async function feedRoutes(app) {
    // Public event feed (no auth)
    app.get('/api/worlds/:id/feed', async (request, reply) => {
        const worldId = request.params.id;
        // Get world
        const worldRows = await db
            .select()
            .from(worlds)
            .where(eq(worlds.id, worldId))
            .limit(1);
        if (worldRows.length === 0) {
            return reply.code(404).send({ error: 'not_found', message: 'World not found' });
        }
        const world = worldRows[0];
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
        // Query public events only
        const conditions = [
            eq(events.worldId, worldId),
            eq(events.public, true),
        ];
        if (sinceTick !== undefined && !isNaN(sinceTick)) {
            conditions.push(gt(events.tick, sinceTick));
        }
        const eventRows = await db
            .select({
            id: events.id,
            tick: events.tick,
            type: events.type,
            data: events.data,
            publicData: events.publicData,
            visibility: events.visibility,
        })
            .from(events)
            .where(and(...conditions))
            .orderBy(desc(events.tick))
            .limit(limit);
        // Map events: prefer publicData over full data for spectator view
        const feedEvents = eventRows.map((row) => ({
            id: row.id,
            tick: row.tick,
            type: row.type,
            colonyId: row.visibility?.[0] ?? null,
            data: row.publicData ?? row.data,
        }));
        // Get colony summaries (public info only)
        const colonyRows = await db
            .select({
            id: colonies.id,
            name: colonies.name,
            status: colonies.status,
            legacyScore: colonies.legacyScore,
        })
            .from(colonies)
            .where(eq(colonies.worldId, worldId));
        // Get settlement counts per colony
        const settlementRows = await db
            .select({
            colonyId: settlements.colonyId,
            tier: settlements.tier,
        })
            .from(settlements)
            .where(eq(settlements.worldId, worldId));
        // Get unit counts per colony
        const unitRows = await db
            .select({
            colonyId: units.colonyId,
            type: units.type,
        })
            .from(units)
            .where(eq(units.worldId, worldId));
        // Build colony summaries
        const colonySummaries = colonyRows.map((c) => {
            const mySettlements = settlementRows.filter(s => s.colonyId === c.id);
            const myUnits = unitRows.filter(u => u.colonyId === c.id);
            return {
                id: c.id,
                name: c.name,
                status: c.status,
                legacyScore: c.legacyScore,
                settlements: mySettlements.length,
                settlementTiers: {
                    outpost: mySettlements.filter(s => s.tier === 'outpost').length,
                    town: mySettlements.filter(s => s.tier === 'town').length,
                    city: mySettlements.filter(s => s.tier === 'city').length,
                },
                units: myUnits.length,
                unitTypes: {
                    scout: myUnits.filter(u => u.type === 'scout').length,
                    militia: myUnits.filter(u => u.type === 'militia').length,
                    soldier: myUnits.filter(u => u.type === 'soldier').length,
                    siege: myUnits.filter(u => u.type === 'siege').length,
                    settler: myUnits.filter(u => u.type === 'settler').length,
                },
            };
        });
        return {
            world: {
                id: world.id,
                name: world.name,
                status: world.status,
                currentTick: world.currentTick,
                tickRate: world.tickRate,
                maxColonies: world.maxColonies,
                colonyCount: colonyRows.length,
            },
            colonies: colonySummaries,
            events: feedEvents,
        };
    });
}
//# sourceMappingURL=feed.js.map