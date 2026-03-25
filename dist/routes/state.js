/**
 * State query endpoints — authenticated colony state access.
 *
 * GET /api/worlds/:id/state — full colony state (resources, settlements, units, visible map)
 * GET /api/worlds/:id/map   — visible hexes only (fog of war applied)
 */
import { eq, and, sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { worlds, hexes, colonies, settlements, units } from '../db/schema/index.js';
import { requireAuth } from '../middleware/index.js';
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
            .select({ resources: colonies.resources, legacyScore: colonies.legacyScore, status: colonies.status })
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
        return {
            tick: world[0].currentTick,
            worldStatus: world[0].status,
            colony: {
                id: colony.id,
                name: colony.name,
                status: colonyData[0]?.status ?? 'active',
                resources: colonyData[0]?.resources ?? {},
                legacyScore: colonyData[0]?.legacyScore ?? 0,
            },
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
}
//# sourceMappingURL=state.js.map