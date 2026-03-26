"use strict";
/**
 * Action submission endpoints.
 *
 * POST /api/worlds/:id/actions — submit actions for next tick
 * GET  /api/worlds/:id/actions — list queued and recent resolved actions
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.actionRoutes = actionRoutes;
const drizzle_orm_1 = require("drizzle-orm");
const nanoid_1 = require("nanoid");
const index_js_1 = require("../db/index.js");
const index_js_2 = require("../db/schema/index.js");
const index_js_3 = require("../middleware/index.js");
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
    'propose_agreement': ['targetColonyId', 'agreementType'],
    'accept_agreement': ['agreementId'],
    'reject_agreement': ['agreementId'],
    'break_agreement': ['agreementId'],
};
// Allowed params per action type (used to strip extra fields)
const ALLOWED_PARAMS = {
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
    'propose_agreement': ['targetColonyId', 'agreementType', 'terms'],
    'accept_agreement': ['agreementId'],
    'reject_agreement': ['agreementId'],
    'break_agreement': ['agreementId'],
};
// Valid building types
const VALID_BUILDING_TYPES = new Set([
    'farm', 'lumberMill', 'quarry', 'mine', 'barracks', 'granary', 'market', 'workshop',
]);
// Valid unit types
const VALID_UNIT_TYPES = new Set([
    'scout', 'militia', 'soldier', 'siege', 'settler',
]);
// Valid resources
const VALID_RESOURCES = new Set([
    'food', 'timber', 'stone', 'iron', 'influence',
]);
// Valid agreement types
const VALID_AGREEMENT_TYPES = new Set([
    'non_aggression', 'trade', 'alliance', 'ceasefire',
]);
const MAX_ACTIONS_PER_TICK = 10;
const MAX_SETTLEMENT_NAME_LENGTH = 40;
const MAX_MESSAGE_LENGTH = 500;
// --- Sanitization ---
/** Strip HTML tags from a string */
function stripHtml(input) {
    return input.replace(/<[^>]*>/g, '');
}
/** Check if a value is a finite integer */
function isFiniteInt(val) {
    return typeof val === 'number' && Number.isFinite(val) && Number.isInteger(val);
}
/** Check if a value is a finite number (int or float) */
function isFiniteNum(val) {
    return typeof val === 'number' && Number.isFinite(val);
}
/**
 * Validate action type, required params, param types, and param values.
 * Also strips unknown params (additionalProperties: false equivalent).
 */
function validateActionParams(action, mapRadius) {
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
    // Check required params exist
    for (const param of requiredParams) {
        if (action.params[param] === undefined || action.params[param] === null) {
            return { valid: false, error: `Missing required param '${param}' for action type '${action.type}'` };
        }
    }
    // Strip unknown params
    const allowed = ALLOWED_PARAMS[action.type];
    if (allowed) {
        for (const key of Object.keys(action.params)) {
            if (!allowed.includes(key)) {
                delete action.params[key];
            }
        }
    }
    // --- Type-specific validation ---
    const p = action.params;
    // Coordinate validation for move_unit and attack
    if (action.type === 'move_unit' || action.type === 'attack') {
        if (!isFiniteInt(p.targetX)) {
            return { valid: false, error: `'targetX' must be an integer, got: ${typeof p.targetX === 'number' ? p.targetX : typeof p.targetX}` };
        }
        if (!isFiniteInt(p.targetY)) {
            return { valid: false, error: `'targetY' must be an integer, got: ${typeof p.targetY === 'number' ? p.targetY : typeof p.targetY}` };
        }
        if (p.targetX < -mapRadius || p.targetX > mapRadius) {
            return { valid: false, error: `'targetX' out of map bounds: ${p.targetX} (must be between -${mapRadius} and ${mapRadius})` };
        }
        if (p.targetY < -mapRadius || p.targetY > mapRadius) {
            return { valid: false, error: `'targetY' out of map bounds: ${p.targetY} (must be between -${mapRadius} and ${mapRadius})` };
        }
        if (typeof p.unitId !== 'string' || p.unitId.length === 0) {
            return { valid: false, error: `'unitId' must be a non-empty string` };
        }
    }
    // String ID validation for unit-based actions
    if (['explore', 'found_settlement'].includes(action.type)) {
        if (typeof p.unitId !== 'string' || p.unitId.length === 0) {
            return { valid: false, error: `'unitId' must be a non-empty string` };
        }
    }
    // Settlement name validation
    if (action.type === 'found_settlement') {
        if (typeof p.name !== 'string' || p.name.trim().length === 0) {
            return { valid: false, error: `'name' must be a non-empty string` };
        }
        if (p.name.length > MAX_SETTLEMENT_NAME_LENGTH) {
            return { valid: false, error: `'name' too long: max ${MAX_SETTLEMENT_NAME_LENGTH} characters` };
        }
        // Strip HTML from settlement names
        p.name = stripHtml(p.name).trim();
        if (p.name.length === 0) {
            return { valid: false, error: `'name' must contain visible characters (not just HTML tags)` };
        }
    }
    // Building type validation
    if (['build', 'upgrade_building', 'demolish'].includes(action.type)) {
        if (typeof p.settlementId !== 'string' || p.settlementId.length === 0) {
            return { valid: false, error: `'settlementId' must be a non-empty string` };
        }
        if (typeof p.buildingType !== 'string' || !VALID_BUILDING_TYPES.has(p.buildingType)) {
            return { valid: false, error: `Invalid buildingType '${p.buildingType}'. Valid: ${[...VALID_BUILDING_TYPES].join(', ')}` };
        }
    }
    // Unit type validation for train_unit
    if (action.type === 'train_unit') {
        if (typeof p.settlementId !== 'string' || p.settlementId.length === 0) {
            return { valid: false, error: `'settlementId' must be a non-empty string` };
        }
        if (typeof p.unitType !== 'string' || !VALID_UNIT_TYPES.has(p.unitType)) {
            return { valid: false, error: `Invalid unitType '${p.unitType}'. Valid: ${[...VALID_UNIT_TYPES].join(', ')}` };
        }
    }
    // upgrade_settlement validation
    if (action.type === 'upgrade_settlement') {
        if (typeof p.settlementId !== 'string' || p.settlementId.length === 0) {
            return { valid: false, error: `'settlementId' must be a non-empty string` };
        }
    }
    // send_message validation — sanitize HTML
    if (action.type === 'send_message') {
        if (typeof p.toColonyId !== 'string' || p.toColonyId.length === 0) {
            return { valid: false, error: `'toColonyId' must be a non-empty string` };
        }
        if (typeof p.message !== 'string') {
            return { valid: false, error: `'message' must be a string` };
        }
        // Strip HTML tags from message content
        p.message = stripHtml(p.message).trim();
        if (p.message.length === 0) {
            return { valid: false, error: `'message' must contain visible text (not just HTML tags)` };
        }
        if (p.message.length > MAX_MESSAGE_LENGTH) {
            return { valid: false, error: `'message' too long: max ${MAX_MESSAGE_LENGTH} characters (got ${p.message.length})` };
        }
    }
    // convert_resources validation
    if (action.type === 'convert_resources') {
        if (typeof p.settlementId !== 'string' || p.settlementId.length === 0) {
            return { valid: false, error: `'settlementId' must be a non-empty string` };
        }
        if (typeof p.fromResource !== 'string' || !VALID_RESOURCES.has(p.fromResource)) {
            return { valid: false, error: `Invalid fromResource '${p.fromResource}'. Valid: ${[...VALID_RESOURCES].join(', ')}` };
        }
        if (typeof p.toResource !== 'string' || !VALID_RESOURCES.has(p.toResource)) {
            return { valid: false, error: `Invalid toResource '${p.toResource}'. Valid: ${[...VALID_RESOURCES].join(', ')}` };
        }
        if (p.fromResource === p.toResource) {
            return { valid: false, error: `'fromResource' and 'toResource' must be different` };
        }
        if (!isFiniteNum(p.amount) || p.amount <= 0) {
            return { valid: false, error: `'amount' must be a positive number` };
        }
    }
    // research validation
    if (action.type === 'research') {
        if (typeof p.techId !== 'string' || p.techId.length === 0) {
            return { valid: false, error: `'techId' must be a non-empty string` };
        }
    }
    // Agreement validations
    if (action.type === 'propose_agreement') {
        if (typeof p.targetColonyId !== 'string' || p.targetColonyId.length === 0) {
            return { valid: false, error: `'targetColonyId' must be a non-empty string` };
        }
        if (typeof p.agreementType !== 'string' || !VALID_AGREEMENT_TYPES.has(p.agreementType)) {
            return { valid: false, error: `Invalid agreementType '${p.agreementType}'. Valid: ${[...VALID_AGREEMENT_TYPES].join(', ')}` };
        }
    }
    if (['accept_agreement', 'reject_agreement', 'break_agreement'].includes(action.type)) {
        if (typeof p.agreementId !== 'string' || p.agreementId.length === 0) {
            return { valid: false, error: `'agreementId' must be a non-empty string` };
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
        const unit = await index_js_1.db
            .select({ colonyId: index_js_2.units.colonyId, type: index_js_2.units.type })
            .from(index_js_2.units)
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(index_js_2.units.id, params.unitId), (0, drizzle_orm_1.eq)(index_js_2.units.worldId, worldId)))
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
        const settlement = await index_js_1.db
            .select({ colonyId: index_js_2.settlements.colonyId })
            .from(index_js_2.settlements)
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(index_js_2.settlements.id, params.settlementId), (0, drizzle_orm_1.eq)(index_js_2.settlements.worldId, worldId)))
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
async function actionRoutes(app) {
    // Submit actions
    app.post('/api/worlds/:id/actions', {
        preHandler: index_js_3.requireAuth,
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
        // Get world for current tick and map radius
        const world = await index_js_1.db
            .select({ currentTick: index_js_2.worlds.currentTick, status: index_js_2.worlds.status, mapRadius: index_js_2.worlds.mapRadius })
            .from(index_js_2.worlds)
            .where((0, drizzle_orm_1.eq)(index_js_2.worlds.id, worldId))
            .limit(1);
        if (world.length === 0) {
            return reply.code(404).send({ error: 'not_found', message: 'World not found' });
        }
        if (world[0].status === 'ended') {
            return reply.code(409).send({ error: 'world_ended', message: 'This world has ended' });
        }
        const currentTick = world[0].currentTick;
        const nextTick = currentTick + 1;
        const mapRadius = world[0].mapRadius;
        // Validate all actions first (before rate limit — invalid actions should not consume slots)
        const validationErrors = [];
        for (let i = 0; i < body.actions.length; i++) {
            const action = body.actions[i];
            // Comprehensive type + value validation (also strips extra params)
            const paramResult = validateActionParams(action, mapRadius);
            if (!paramResult.valid) {
                validationErrors.push({ index: i, error: paramResult.error });
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
        // Rate limit: count existing queued actions for next tick
        const existingCount = await index_js_1.db
            .select({ count: (0, drizzle_orm_1.sql) `count(*)` })
            .from(index_js_2.actions)
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(index_js_2.actions.worldId, worldId), (0, drizzle_orm_1.eq)(index_js_2.actions.colonyId, colony.id), (0, drizzle_orm_1.eq)(index_js_2.actions.tick, nextTick), (0, drizzle_orm_1.eq)(index_js_2.actions.status, 'queued')));
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
        // Insert all actions
        const inserted = [];
        for (const action of body.actions) {
            const actionId = `act_${(0, nanoid_1.nanoid)(12)}`;
            await index_js_1.db.insert(index_js_2.actions).values({
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
        preHandler: index_js_3.requireAuth,
    }, async (request, reply) => {
        const colony = request.colony;
        const worldId = colony.worldId;
        // Get world for current tick
        const world = await index_js_1.db
            .select({ currentTick: index_js_2.worlds.currentTick })
            .from(index_js_2.worlds)
            .where((0, drizzle_orm_1.eq)(index_js_2.worlds.id, worldId))
            .limit(1);
        if (world.length === 0) {
            return reply.code(404).send({ error: 'not_found', message: 'World not found' });
        }
        const currentTick = world[0].currentTick;
        // Get queued actions (next tick)
        const queued = await index_js_1.db
            .select({
            id: index_js_2.actions.id,
            type: index_js_2.actions.type,
            params: index_js_2.actions.params,
            tick: index_js_2.actions.tick,
            status: index_js_2.actions.status,
            result: index_js_2.actions.result,
            createdAt: index_js_2.actions.createdAt,
        })
            .from(index_js_2.actions)
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(index_js_2.actions.worldId, worldId), (0, drizzle_orm_1.eq)(index_js_2.actions.colonyId, colony.id), (0, drizzle_orm_1.eq)(index_js_2.actions.status, 'queued')));
        // Get recent resolved/failed actions (last 5 ticks)
        const recent = await index_js_1.db
            .select({
            id: index_js_2.actions.id,
            type: index_js_2.actions.type,
            params: index_js_2.actions.params,
            tick: index_js_2.actions.tick,
            status: index_js_2.actions.status,
            result: index_js_2.actions.result,
            createdAt: index_js_2.actions.createdAt,
        })
            .from(index_js_2.actions)
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(index_js_2.actions.worldId, worldId), (0, drizzle_orm_1.eq)(index_js_2.actions.colonyId, colony.id), (0, drizzle_orm_1.sql) `${index_js_2.actions.status} IN ('resolved', 'failed')`, (0, drizzle_orm_1.sql) `${index_js_2.actions.tick} >= ${currentTick - 5}`))
            .orderBy((0, drizzle_orm_1.desc)(index_js_2.actions.tick));
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
        preHandler: index_js_3.requireAuth,
    }, async (request, reply) => {
        const colony = request.colony;
        const { actionId } = request.params;
        const rows = await index_js_1.db
            .select({
            id: index_js_2.actions.id,
            type: index_js_2.actions.type,
            params: index_js_2.actions.params,
            tick: index_js_2.actions.tick,
            status: index_js_2.actions.status,
            result: index_js_2.actions.result,
            createdAt: index_js_2.actions.createdAt,
        })
            .from(index_js_2.actions)
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(index_js_2.actions.id, actionId), (0, drizzle_orm_1.eq)(index_js_2.actions.colonyId, colony.id)))
            .limit(1);
        if (rows.length === 0) {
            return reply.code(404).send({ error: 'not_found', message: 'Action not found' });
        }
        return rows[0];
    });
}
