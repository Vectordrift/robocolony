/**
 * Action submission endpoints.
 *
 * POST /api/worlds/:id/actions — submit actions for next tick
 * GET  /api/worlds/:id/actions — list queued and recent resolved actions
 */
import { eq, and, desc, sql } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { db } from '../db/index.js';
import { worlds, actions, units, settlements } from '../db/schema/index.js';
import { requireAuth } from '../middleware/index.js';
// --- Valid action types and their required params ---
const VALID_ACTION_TYPES = {
    'move_unit': ['unitId', 'targetX', 'targetY'],
    'build': ['settlementId', 'buildingType'],
    'upgrade_building': ['settlementId', 'buildingType'],
    'train_unit': ['settlementId', 'unitType'],
    'found_settlement': ['unitId', 'name'],
    'demolish': ['settlementId', 'buildingType'],
    'upgrade_settlement': ['settlementId'],
    'attack': ['unitId', 'targetX', 'targetY'],
    'send_message': ['toColonyId', 'message'],
    'explore': ['unitId'],
    'convert_resources': ['settlementId', 'fromResource', 'toResource', 'amount'],
    'research': ['techId'],
};
const MAX_ACTIONS_PER_TICK = 10;
function validateActionType(action) {
    if (!action.type || typeof action.type !== 'string') {
        return { valid: false, error: 'Action type is required' };
    }
    const requiredParams = VALID_ACTION_TYPES[action.type];
    if (!requiredParams) {
        return { valid: false, error: `Unknown action type: ${action.type}. Valid types: ${Object.keys(VALID_ACTION_TYPES).join(', ')}` };
    }
    if (!action.params || typeof action.params !== 'object') {
        return { valid: false, error: `Action params are required for type: ${action.type}` };
    }
    for (const param of requiredParams) {
        if (action.params[param] === undefined || action.params[param] === null) {
            return { valid: false, error: `Missing required param '${param}' for action type '${action.type}'` };
        }
    }
    return { valid: true };
}
/**
 * Verify that the colony owns the referenced units/settlements.
 */
async function validateOwnership(colonyId, worldId, action) {
    const params = action.params;
    // Check unit ownership + type constraints
    if (params.unitId && typeof params.unitId === 'string') {
        const unit = await db
            .select({ colonyId: units.colonyId, type: units.type })
            .from(units)
            .where(and(eq(units.id, params.unitId), eq(units.worldId, worldId)))
            .limit(1);
        if (unit.length === 0) {
            return { valid: false, error: `Unit ${params.unitId} not found` };
        }
        if (unit[0].colonyId !== colonyId) {
            return { valid: false, error: `Unit ${params.unitId} does not belong to your colony` };
        }
        // Type-specific checks
        if (action.type === 'found_settlement' && unit[0].type !== 'settler') {
            return { valid: false, error: `Unit ${params.unitId} is a ${unit[0].type}, not a settler. Only settlers can found settlements.` };
        }
        if (action.type === 'attack' && unit[0].type === 'settler') {
            return { valid: false, error: `Settlers cannot attack. Use military units (scout, militia, soldier, siege).` };
        }
        if (action.type === 'explore' && unit[0].type !== 'scout') {
            return { valid: false, error: `Unit ${params.unitId} is a ${unit[0].type}, not a scout. Only scouts can use the explore action.` };
        }
    }
    // Check settlement ownership
    if (params.settlementId && typeof params.settlementId === 'string') {
        const settlement = await db
            .select({ colonyId: settlements.colonyId })
            .from(settlements)
            .where(and(eq(settlements.id, params.settlementId), eq(settlements.worldId, worldId)))
            .limit(1);
        if (settlement.length === 0) {
            return { valid: false, error: `Settlement ${params.settlementId} not found` };
        }
        if (settlement[0].colonyId !== colonyId) {
            return { valid: false, error: `Settlement ${params.settlementId} does not belong to your colony` };
        }
    }
    return { valid: true };
}
// --- Routes ---
export async function actionRoutes(app) {
    // Submit actions
    app.post('/api/worlds/:id/actions', {
        preHandler: requireAuth,
    }, async (request, reply) => {
        const colony = request.colony;
        const worldId = colony.worldId;
        const body = request.body;
        if (!body?.actions || !Array.isArray(body.actions)) {
            return reply.code(400).send({
                error: 'validation_error',
                message: 'Request body must contain an "actions" array',
            });
        }
        if (body.actions.length === 0) {
            return reply.code(400).send({
                error: 'validation_error',
                message: 'At least one action is required',
            });
        }
        // Get world for current tick
        const world = await db
            .select({ currentTick: worlds.currentTick, status: worlds.status })
            .from(worlds)
            .where(eq(worlds.id, worldId))
            .limit(1);
        if (world.length === 0) {
            return reply.code(404).send({ error: 'not_found', message: 'World not found' });
        }
        if (world[0].status === 'ended') {
            return reply.code(409).send({ error: 'world_ended', message: 'This world has ended' });
        }
        const currentTick = world[0].currentTick;
        const nextTick = currentTick + 1;
        // Rate limit: count existing queued actions for next tick
        const existingCount = await db
            .select({ count: sql `count(*)` })
            .from(actions)
            .where(and(eq(actions.worldId, worldId), eq(actions.colonyId, colony.id), eq(actions.tick, nextTick), eq(actions.status, 'queued')));
        const currentQueuedCount = Number(existingCount[0]?.count ?? 0);
        const remainingSlots = MAX_ACTIONS_PER_TICK - currentQueuedCount;
        // Truncate batch to fit remaining slots (partial accept)
        let truncated = false;
        if (body.actions.length > remainingSlots) {
            if (remainingSlots <= 0) {
                return reply.code(429).send({
                    error: 'rate_limit',
                    message: `Rate limit: max ${MAX_ACTIONS_PER_TICK} actions per tick. You have ${currentQueuedCount} queued, 0 remaining.`,
                });
            }
            body.actions = body.actions.slice(0, remainingSlots);
            truncated = true;
        }
        // Validate all actions first (fail fast)
        const validationErrors = [];
        for (let i = 0; i < body.actions.length; i++) {
            const action = body.actions[i];
            // Type validation
            const typeResult = validateActionType(action);
            if (!typeResult.valid) {
                validationErrors.push({ index: i, error: typeResult.error });
                continue;
            }
            // Ownership validation
            const ownerResult = await validateOwnership(colony.id, worldId, action);
            if (!ownerResult.valid) {
                validationErrors.push({ index: i, error: ownerResult.error });
            }
        }
        if (validationErrors.length > 0) {
            return reply.code(400).send({
                error: 'validation_error',
                message: 'One or more actions failed validation',
                details: validationErrors,
            });
        }
        // Insert all actions
        const inserted = [];
        for (const action of body.actions) {
            const actionId = `act_${nanoid(12)}`;
            await db.insert(actions).values({
                id: actionId,
                worldId,
                colonyId: colony.id,
                tick: nextTick,
                type: action.type,
                params: action.params,
                status: 'queued',
            });
            inserted.push({
                id: actionId,
                type: action.type,
                tick: nextTick,
                status: 'queued',
            });
        }
        return reply.code(201).send({
            submitted: inserted.length,
            tick: nextTick,
            actions: inserted,
            ...(truncated ? {
                truncated: true,
                message: `Batch truncated: ${inserted.length} of your actions accepted (max ${MAX_ACTIONS_PER_TICK}/tick, ${currentQueuedCount} already queued).`,
            } : {}),
        });
    });
    // List actions (queued + recent resolved)
    app.get('/api/worlds/:id/actions', {
        preHandler: requireAuth,
    }, async (request, reply) => {
        const colony = request.colony;
        const worldId = colony.worldId;
        // Get world for current tick
        const world = await db
            .select({ currentTick: worlds.currentTick })
            .from(worlds)
            .where(eq(worlds.id, worldId))
            .limit(1);
        if (world.length === 0) {
            return reply.code(404).send({ error: 'not_found', message: 'World not found' });
        }
        const currentTick = world[0].currentTick;
        // Get queued actions (next tick)
        const queued = await db
            .select({
            id: actions.id,
            type: actions.type,
            params: actions.params,
            tick: actions.tick,
            status: actions.status,
            result: actions.result,
            createdAt: actions.createdAt,
        })
            .from(actions)
            .where(and(eq(actions.worldId, worldId), eq(actions.colonyId, colony.id), eq(actions.status, 'queued')));
        // Get recent resolved/failed actions (last 5 ticks)
        const recent = await db
            .select({
            id: actions.id,
            type: actions.type,
            params: actions.params,
            tick: actions.tick,
            status: actions.status,
            result: actions.result,
            createdAt: actions.createdAt,
        })
            .from(actions)
            .where(and(eq(actions.worldId, worldId), eq(actions.colonyId, colony.id), sql `${actions.status} IN ('resolved', 'failed')`, sql `${actions.tick} >= ${currentTick - 5}`))
            .orderBy(desc(actions.tick));
        return {
            tick: currentTick,
            queued: {
                count: queued.length,
                maxPerTick: MAX_ACTIONS_PER_TICK,
                actions: queued,
            },
            recent: recent,
        };
    });
    // Single action lookup
    app.get('/api/worlds/:id/actions/:actionId', {
        preHandler: requireAuth,
    }, async (request, reply) => {
        const colony = request.colony;
        const { actionId } = request.params;
        const rows = await db
            .select({
            id: actions.id,
            type: actions.type,
            params: actions.params,
            tick: actions.tick,
            status: actions.status,
            result: actions.result,
            createdAt: actions.createdAt,
        })
            .from(actions)
            .where(and(eq(actions.id, actionId), eq(actions.colonyId, colony.id)))
            .limit(1);
        if (rows.length === 0) {
            return reply.code(404).send({ error: 'not_found', message: 'Action not found' });
        }
        return rows[0];
    });
}
//# sourceMappingURL=actions.js.map