/**
 * Historical elimination feedback endpoint.
 *
 * GET /api/worlds/:id/epitaph — returns post-death summary for an authenticated colony,
 * including eliminated/dead colonies whose API keys would normally be blocked elsewhere.
 */
import { and, desc, eq, gte, lte, or, sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { colonies, events, settlements, units, worlds } from '../db/schema/index.js';
import { requireAuthAllowInactive } from '../middleware/index.js';
function classifyDeathCause(deathReason, recentEvents) {
    const lowerReason = (deathReason ?? '').toLowerCase();
    if (lowerReason.includes('captured'))
        return 'conquest';
    if (recentEvents.some(event => event.type === 'famine'))
        return 'famine';
    if (recentEvents.some(event => event.type === 'desertion'))
        return 'desertion';
    if (lowerReason.includes('abandoned') || lowerReason.includes('all units lost') || lowerReason.includes('destroyed')) {
        return 'neglect';
    }
    return 'unknown';
}
export async function epitaphRoutes(app) {
    app.get('/api/worlds/:id/epitaph', {
        preHandler: requireAuthAllowInactive,
    }, async (request, reply) => {
        const colony = request.colony;
        const worldId = colony.worldId;
        if (request.params.id !== worldId) {
            return reply.code(403).send({
                error: 'forbidden',
                message: 'Colony does not belong to this world',
            });
        }
        const worldRows = await db
            .select({ currentTick: worlds.currentTick, status: worlds.status })
            .from(worlds)
            .where(eq(worlds.id, worldId))
            .limit(1);
        if (worldRows.length === 0) {
            return reply.code(404).send({ error: 'not_found', message: 'World not found' });
        }
        const colonyRows = await db
            .select()
            .from(colonies)
            .where(eq(colonies.id, colony.id))
            .limit(1);
        if (colonyRows.length === 0) {
            return reply.code(404).send({ error: 'not_found', message: 'Colony not found' });
        }
        const colonyData = colonyRows[0];
        if (colonyData.status !== 'eliminated' && colonyData.status !== 'dead') {
            return reply.code(409).send({
                error: 'colony_alive',
                message: 'This colony is still active. No epitaph is available yet.',
            });
        }
        const deathTick = colonyData.diedAtTick ?? worldRows[0].currentTick;
        const recentTickStart = Math.max(0, deathTick - 4);
        const colonySettlements = await db
            .select()
            .from(settlements)
            .where(eq(settlements.colonyId, colony.id));
        const colonyUnits = await db
            .select({
            id: units.id,
            type: units.type,
            hexX: units.hexX,
            hexY: units.hexY,
            health: units.health,
            morale: units.morale,
        })
            .from(units)
            .where(eq(units.colonyId, colony.id));
        const recentEventsRaw = await db
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
            .where(and(eq(events.worldId, worldId), gte(events.tick, recentTickStart), lte(events.tick, deathTick), or(eq(events.public, true), sql `${colony.id} = ANY(${events.visibility})`)))
            .orderBy(desc(events.tick));
        const recentEvents = recentEventsRaw.map((event) => ({
            id: event.id,
            tick: event.tick,
            type: event.type,
            public: event.public,
            visibility: event.visibility,
            data: (event.data ?? {}),
            publicData: (event.publicData ?? null),
        }));
        const eliminationEvent = recentEvents.find(event => event.type === 'colony_eliminated' || event.type === 'colony_dead');
        const attackerColonyId = typeof eliminationEvent?.data.eliminatedBy === 'string'
            ? eliminationEvent.data.eliminatedBy
            : undefined;
        let attackerColony = null;
        if (attackerColonyId) {
            const attackerRows = await db
                .select({ id: colonies.id, name: colonies.name })
                .from(colonies)
                .where(and(eq(colonies.worldId, worldId), eq(colonies.id, attackerColonyId)))
                .limit(1);
            attackerColony = attackerRows[0] ?? null;
        }
        const mappedEvents = recentEvents.map((event) => {
            const isOwnEvent = Array.isArray(event.visibility) && event.visibility.includes(colony.id);
            return {
                id: event.id,
                tick: event.tick,
                type: event.type,
                public: event.public,
                own: isOwnEvent,
                data: isOwnEvent ? event.data : (event.publicData ?? event.data),
            };
        });
        return {
            world: {
                id: worldId,
                status: worldRows[0].status,
                currentTick: worldRows[0].currentTick,
            },
            colony: {
                id: colony.id,
                name: colony.name,
                status: colonyData.status,
            },
            epitaph: {
                cause: classifyDeathCause(colonyData.deathReason, recentEvents),
                deathTick,
                deathReason: colonyData.deathReason ?? 'Unknown',
                attackerColony,
                finalState: {
                    resources: colonyData.resources ?? {},
                    legacyScore: colonyData.legacyScore ?? 0,
                    survivingSettlements: colonySettlements.map((settlement) => ({
                        id: settlement.id,
                        name: settlement.name,
                        tier: settlement.tier,
                        hex: { x: settlement.hexX, y: settlement.hexY },
                        buildings: settlement.buildings,
                        population: settlement.population,
                        loyalty: settlement.loyalty,
                    })),
                    survivingUnits: colonyUnits.map((unit) => ({
                        id: unit.id,
                        type: unit.type,
                        hex: { x: unit.hexX, y: unit.hexY },
                        health: unit.health,
                        morale: unit.morale,
                    })),
                    survivingPopulation: colonySettlements.reduce((sum, settlement) => sum + settlement.population, 0),
                },
                recentEvents: mappedEvents,
            },
        };
    });
}
//# sourceMappingURL=epitaph.js.map