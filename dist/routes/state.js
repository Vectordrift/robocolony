/**
 * State query endpoints — authenticated colony state access.
 *
 * GET /api/worlds/:id/state — full colony state (resources, settlements, units, visible map)
 * GET /api/worlds/:id/map   — visible hexes only (fog of war applied)
 */
import { eq, and, or, sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { worlds, hexes, colonies, settlements, units, agreements } from '../db/schema/index.js';
import { requireAuth } from '../middleware/index.js';
import { TECH_TREE } from '../engine/tick.js';
/**
 * Get all hexes visible to a colony (fog of war applied).
 * A hex is visible if the colony ID is in its explored_by array.
 */
export async function getVisibleHexes(worldId, colonyId) {
    const rows = await db
        .select({
        x: hexes.x,
        y: hexes.y,
        terrain: hexes.terrain,
        resources: hexes.resources,
        settlementId: hexes.settlementId,
    })
        .from(hexes)
        .where(and(eq(hexes.worldId, worldId), sql `${colonyId} = ANY(explored_by)`));
    return rows.map((h) => ({
        x: h.x,
        y: h.y,
        terrain: h.terrain,
        resources: h.resources,
        settlementId: h.settlementId,
    }));
}
export async function stateRoutes(app) {
    // Full colony state
    app.get('/api/worlds/:id/state', {
        preHandler: requireAuth,
    }, async (request, reply) => {
        const colony = request.colony;
        const worldId = colony.worldId;
        // Get world info (for current tick)
        const world = await db
            .select({ currentTick: worlds.currentTick, status: worlds.status })
            .from(worlds)
            .where(eq(worlds.id, worldId))
            .limit(1);
        if (world.length === 0) {
            return reply.code(404).send({ error: 'not_found', message: 'World not found' });
        }
        // Get colony resources
        const colonyData = await db
            .select()
            .from(colonies)
            .where(eq(colonies.id, colony.id))
            .limit(1);
        // Get settlements
        const colonySettlements = await db
            .select()
            .from(settlements)
            .where(eq(settlements.colonyId, colony.id));
        // Get units — select only API-visible columns (excludes internal fields like idleTicks)
        const colonyUnits = await db
            .select({
            id: units.id,
            colonyId: units.colonyId,
            type: units.type,
            hexX: units.hexX,
            hexY: units.hexY,
            health: units.health,
            morale: units.morale,
            movementQueue: units.movementQueue,
        })
            .from(units)
            .where(eq(units.colonyId, colony.id));
        // Get visible map (fog of war)
        const visibleMap = await getVisibleHexes(worldId, colony.id);
        // Get world radius for map size hint
        const worldMeta = await db
            .select({ mapRadius: worlds.mapRadius })
            .from(worlds)
            .where(eq(worlds.id, worldId))
            .limit(1);
        // Find enemy units and settlements on visible hexes
        const visibleCoords = visibleMap.map(h => ({ x: h.x, y: h.y }));
        let enemyUnitsOnMap = [];
        let enemySettlementsOnMap = [];
        if (visibleCoords.length > 0) {
            // Get all enemy units on hexes visible to this colony
            const allVisibleUnits = await db
                .select({
                id: units.id,
                colonyId: units.colonyId,
                type: units.type,
                hexX: units.hexX,
                hexY: units.hexY,
                health: units.health,
            })
                .from(units)
                .where(and(eq(units.worldId, worldId), sql `${units.colonyId} != ${colony.id}`));
            // Filter to only units on visible hexes
            const visibleSet = new Set(visibleCoords.map(c => `${c.x},${c.y}`));
            enemyUnitsOnMap = allVisibleUnits
                .filter(u => visibleSet.has(`${u.hexX},${u.hexY}`))
                .map(u => ({
                id: u.id,
                colonyId: u.colonyId,
                type: u.type,
                hex: { x: u.hexX, y: u.hexY },
                health: u.health,
            }));
            // Get enemy settlements on visible hexes
            const visibleSettlementIds = visibleMap
                .filter(h => h.settlementId !== null)
                .map(h => h.settlementId);
            if (visibleSettlementIds.length > 0) {
                const allSettlements = await db
                    .select({
                    id: settlements.id,
                    colonyId: settlements.colonyId,
                    name: settlements.name,
                    hexX: settlements.hexX,
                    hexY: settlements.hexY,
                    tier: settlements.tier,
                })
                    .from(settlements)
                    .where(and(eq(settlements.worldId, worldId), sql `${settlements.colonyId} != ${colony.id}`));
                enemySettlementsOnMap = allSettlements
                    .filter(s => visibleSet.has(`${s.hexX},${s.hexY}`))
                    .map(s => ({
                    id: s.id,
                    colonyId: s.colonyId,
                    name: s.name,
                    hex: { x: s.hexX, y: s.hexY },
                    tier: s.tier,
                }));
            }
        }
        // Get colony names for enemy reference
        const enemyColonyIds = new Set([
            ...enemyUnitsOnMap.map(u => u.colonyId),
            ...enemySettlementsOnMap.map(s => s.colonyId),
        ]);
        let knownColonies = {};
        if (enemyColonyIds.size > 0) {
            const colRows = await db
                .select({ id: colonies.id, name: colonies.name })
                .from(colonies)
                .where(eq(colonies.worldId, worldId));
            knownColonies = Object.fromEntries(colRows.filter(c => enemyColonyIds.has(c.id)).map(c => [c.id, c.name]));
        }
        // Load agreements involving this colony
        const colonyAgreements = await db
            .select()
            .from(agreements)
            .where(and(eq(agreements.worldId, worldId), or(eq(agreements.proposedBy, colony.id), eq(agreements.proposedTo, colony.id))));
        // Gather partner IDs for name lookup
        const agreementPartnerIds = new Set();
        for (const a of colonyAgreements) {
            agreementPartnerIds.add(a.proposedBy === colony.id ? a.proposedTo : a.proposedBy);
        }
        // Ensure we have names for agreement partners
        if (agreementPartnerIds.size > 0) {
            const missingIds = [...agreementPartnerIds].filter(id => !knownColonies[id]);
            if (missingIds.length > 0) {
                const partnerRows = await db
                    .select({ id: colonies.id, name: colonies.name })
                    .from(colonies)
                    .where(eq(colonies.worldId, worldId));
                for (const c of partnerRows) {
                    if (missingIds.includes(c.id)) {
                        knownColonies[c.id] = c.name;
                    }
                }
            }
        }
        // Filter to active/proposed only for state view
        const visibleAgreements = colonyAgreements
            .filter(a => a.status === 'active' || a.status === 'proposed')
            .map(a => {
            const partnerId = a.proposedBy === colony.id ? a.proposedTo : a.proposedBy;
            return {
                id: a.id,
                type: a.type,
                status: a.status,
                partnerColonyId: partnerId,
                partnerName: knownColonies[partnerId] ?? 'Unknown',
                terms: a.terms,
                proposedAtTick: a.proposedAtTick,
                acceptedAtTick: a.acceptedAtTick,
                direction: a.proposedBy === colony.id ? 'outgoing' : 'incoming',
            };
        });
        return {
            tick: world[0].currentTick,
            worldStatus: world[0].status,
            mapRadius: worldMeta[0]?.mapRadius ?? null,
            colony: {
                id: colony.id,
                name: colony.name,
                status: colonyData[0]?.status ?? 'active',
                resources: colonyData[0]?.resources ?? {},
                legacyScore: colonyData[0]?.legacyScore ?? 0,
            },
            research: {
                researched: colonyData[0]?.researchedTechs ?? [],
                queue: colonyData[0]?.researchQueue ?? [],
            },
            agreements: visibleAgreements,
            settlements: colonySettlements.map((s) => ({
                id: s.id,
                name: s.name,
                hex: { x: s.hexX, y: s.hexY },
                tier: s.tier,
                buildings: s.buildings,
                buildQueue: s.buildQueue,
                loyalty: s.loyalty,
                population: s.population,
            })),
            units: colonyUnits.map((u) => ({
                id: u.id,
                type: u.type,
                hex: { x: u.hexX, y: u.hexY },
                health: u.health,
                morale: u.morale,
                movementQueue: u.movementQueue,
            })),
            intel: {
                enemyUnits: enemyUnitsOnMap,
                enemySettlements: enemySettlementsOnMap,
                knownColonies,
            },
            map: visibleMap,
        };
    });
    // Map only (fog of war)
    app.get('/api/worlds/:id/map', {
        preHandler: requireAuth,
    }, async (request, reply) => {
        const colony = request.colony;
        const world = await db
            .select({ currentTick: worlds.currentTick })
            .from(worlds)
            .where(eq(worlds.id, colony.worldId))
            .limit(1);
        if (world.length === 0) {
            return reply.code(404).send({ error: 'not_found', message: 'World not found' });
        }
        const visibleMap = await getVisibleHexes(colony.worldId, colony.id);
        return {
            tick: world[0].currentTick,
            colonyId: colony.id,
            hexCount: visibleMap.length,
            hexes: visibleMap,
        };
    });
    // Tech tree (authenticated — shows what's available + what you've researched)
    app.get('/api/worlds/:id/tech', {
        preHandler: requireAuth,
    }, async (request, reply) => {
        const colony = request.colony;
        const colonyData = await db
            .select()
            .from(colonies)
            .where(eq(colonies.id, colony.id))
            .limit(1);
        const researched = colonyData[0]?.researchedTechs ?? [];
        const queue = colonyData[0]?.researchQueue ?? [];
        const techs = Object.values(TECH_TREE).map(tech => ({
            id: tech.id,
            name: tech.name,
            description: tech.description,
            cost: tech.cost,
            ticks: tech.ticks,
            requires: tech.requires ?? [],
            status: researched.includes(tech.id)
                ? 'researched'
                : queue.some(q => q.techId === tech.id)
                    ? 'in_progress'
                    : (tech.requires ?? []).every(r => researched.includes(r))
                        ? 'available'
                        : 'locked',
            ticksRemaining: queue.find(q => q.techId === tech.id)?.ticksRemaining ?? null,
        }));
        return {
            colonyId: colony.id,
            researched,
            queue,
            techs,
        };
    });
}
//# sourceMappingURL=state.js.map