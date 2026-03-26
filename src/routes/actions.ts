/**
 * Action submission endpoints.
 *
 * POST /api/worlds/:id/actions — submit actions for next tick
 * GET  /api/worlds/:id/actions — list queued and recent resolved actions
 */

import type { FastifyInstance } from 'fastify';
import { eq, and, desc, sql, inArray } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { db } from '../db/index.js';
import { worlds, actions, colonies, units, settlements } from '../db/schema/index.js';
import { requireAuth } from '../middleware/index.js';

// --- Types ---

interface WorldParams {
  Params: { id: string };
}

interface SubmitActionsBody {
  Params: { id: string };
  Body: {
    actions: ActionInput[];
  };
}

interface ActionInput {
  type: string;
  params: Record<string, unknown>;
}

// --- Valid action types and their required params ---

const VALID_ACTION_TYPES: Record<string, string[]> = {
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
  'disband': ['unitId'],
};

// Allowed params per action type (used to strip extra fields)
const ALLOWED_PARAMS: Record<string, string[]> = {
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
  'disband': ['unitId'],
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

/** Truncate user-supplied IDs in error messages to prevent log bloat */
function truncId(id: string, maxLen = 50): string {
  if (id.length <= maxLen) return id;
  return id.substring(0, maxLen) + '…[truncated]';
}

// --- Sanitization ---

/** Strip HTML tags from a string */
function stripHtml(input: string): string {
  return input.replace(/<[^>]*>/g, '');
}

/** Check if a value is a finite integer */
function isFiniteInt(val: unknown): val is number {
  return typeof val === 'number' && Number.isFinite(val) && Number.isInteger(val);
}

/** Check if a value is a finite number (int or float) */
function isFiniteNum(val: unknown): val is number {
  return typeof val === 'number' && Number.isFinite(val);
}

// --- Validation ---

interface ValidationResult {
  valid: boolean;
  error?: string;
}

/**
 * Validate action type, required params, param types, and param values.
 * Also strips unknown params (additionalProperties: false equivalent).
 */
function validateActionParams(action: ActionInput, mapRadius: number): ValidationResult {
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
    if ((p.targetX as number) < -mapRadius || (p.targetX as number) > mapRadius) {
      return { valid: false, error: `'targetX' out of map bounds: ${p.targetX} (must be between -${mapRadius} and ${mapRadius})` };
    }
    if ((p.targetY as number) < -mapRadius || (p.targetY as number) > mapRadius) {
      return { valid: false, error: `'targetY' out of map bounds: ${p.targetY} (must be between -${mapRadius} and ${mapRadius})` };
    }
    if (typeof p.unitId !== 'string' || p.unitId.length === 0) {
      return { valid: false, error: `'unitId' must be a non-empty string` };
    }
  }

  // String ID validation for unit-based actions
  if (['explore', 'found_settlement', 'disband'].includes(action.type)) {
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
    p.name = stripHtml(p.name as string).trim();
    if ((p.name as string).length === 0) {
      return { valid: false, error: `'name' must contain visible characters (not just HTML tags)` };
    }
  }

  // Building type validation
  if (['build', 'upgrade_building', 'demolish'].includes(action.type)) {
    if (typeof p.settlementId !== 'string' || p.settlementId.length === 0) {
      return { valid: false, error: `'settlementId' must be a non-empty string` };
    }
    if (typeof p.buildingType !== 'string' || !VALID_BUILDING_TYPES.has(p.buildingType as string)) {
      return { valid: false, error: `Invalid buildingType '${p.buildingType}'. Valid: ${[...VALID_BUILDING_TYPES].join(', ')}` };
    }
  }

  // Unit type validation for train_unit
  if (action.type === 'train_unit') {
    if (typeof p.settlementId !== 'string' || p.settlementId.length === 0) {
      return { valid: false, error: `'settlementId' must be a non-empty string` };
    }
    if (typeof p.unitType !== 'string' || !VALID_UNIT_TYPES.has(p.unitType as string)) {
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
    p.message = stripHtml(p.message as string).trim();
    if ((p.message as string).length === 0) {
      return { valid: false, error: `'message' must contain visible text (not just HTML tags)` };
    }
    if ((p.message as string).length > MAX_MESSAGE_LENGTH) {
      return { valid: false, error: `'message' too long: max ${MAX_MESSAGE_LENGTH} characters (got ${(p.message as string).length})` };
    }
  }

  // convert_resources validation
  if (action.type === 'convert_resources') {
    if (typeof p.settlementId !== 'string' || p.settlementId.length === 0) {
      return { valid: false, error: `'settlementId' must be a non-empty string` };
    }
    if (typeof p.fromResource !== 'string' || !VALID_RESOURCES.has(p.fromResource as string)) {
      return { valid: false, error: `Invalid fromResource '${p.fromResource}'. Valid: ${[...VALID_RESOURCES].join(', ')}` };
    }
    if (typeof p.toResource !== 'string' || !VALID_RESOURCES.has(p.toResource as string)) {
      return { valid: false, error: `Invalid toResource '${p.toResource}'. Valid: ${[...VALID_RESOURCES].join(', ')}` };
    }
    if (p.fromResource === p.toResource) {
      return { valid: false, error: `'fromResource' and 'toResource' must be different` };
    }
    if (!isFiniteNum(p.amount) || (p.amount as number) <= 0) {
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
    if (typeof p.agreementType !== 'string' || !VALID_AGREEMENT_TYPES.has(p.agreementType as string)) {
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
async function validateOwnership(
  colonyId: string,
  worldId: string,
  action: ActionInput,
): Promise<ValidationResult> {
  const params = action.params;

  // Check unit ownership + type constraints
  if (params.unitId && typeof params.unitId === 'string') {
    const unit = await db
      .select({ colonyId: units.colonyId, type: units.type })
      .from(units)
      .where(
        and(
          eq(units.id, params.unitId as string),
          eq(units.worldId, worldId),
        ),
      )
      .limit(1);

    if (unit.length === 0) {
      return { valid: false, error: `Unit ${truncId(params.unitId as string)} not found` };
    }
    if (unit[0].colonyId !== colonyId) {
      return { valid: false, error: `Unit ${truncId(params.unitId as string)} does not belong to your colony` };
    }

    // Type-specific checks
    if (action.type === 'found_settlement' && unit[0].type !== 'settler') {
      return { valid: false, error: `Unit ${truncId(params.unitId as string)} is a ${unit[0].type}, not a settler. Only settlers can found settlements.` };
    }
    if (action.type === 'attack' && unit[0].type === 'settler') {
      return { valid: false, error: `Settlers cannot attack. Use military units (scout, militia, soldier, siege).` };
    }
    if (action.type === 'explore' && unit[0].type !== 'scout') {
      return { valid: false, error: `Unit ${truncId(params.unitId as string)} is a ${unit[0].type}, not a scout. Only scouts can use the explore action.` };
    }
  }

  // Check settlement ownership
  if (params.settlementId && typeof params.settlementId === 'string') {
    const settlement = await db
      .select({ colonyId: settlements.colonyId })
      .from(settlements)
      .where(
        and(
          eq(settlements.id, params.settlementId as string),
          eq(settlements.worldId, worldId),
        ),
      )
      .limit(1);

    if (settlement.length === 0) {
      return { valid: false, error: `Settlement ${truncId(params.settlementId as string)} not found` };
    }
    if (settlement[0].colonyId !== colonyId) {
      return { valid: false, error: `Settlement ${truncId(params.settlementId as string)} does not belong to your colony` };
    }
  }

  return { valid: true };
}

// --- Routes ---

export async function actionRoutes(app: FastifyInstance) {
  // Submit actions
  app.post<SubmitActionsBody>('/api/worlds/:id/actions', {
    preHandler: requireAuth,
  }, async (request, reply) => {
    const colony = request.colony!;
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
    const world = await db
      .select({ currentTick: worlds.currentTick, status: worlds.status, mapRadius: worlds.mapRadius })
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
    const mapRadius = world[0].mapRadius;

    // Validate all actions first (before rate limit — invalid actions should not consume slots)
    const validationErrors: Array<{ index: number; error: string }> = [];

    for (let i = 0; i < body.actions.length; i++) {
      const action = body.actions[i];

      // Comprehensive type + value validation (also strips extra params)
      const paramResult = validateActionParams(action, mapRadius);
      if (!paramResult.valid) {
        validationErrors.push({ index: i, error: paramResult.error! });
        continue;
      }

      // Ownership validation
      const ownerResult = await validateOwnership(colony.id, worldId, action);
      if (!ownerResult.valid) {
        validationErrors.push({ index: i, error: ownerResult.error! });
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
    const existingCount = await db
      .select({ count: sql<number>`count(*)` })
      .from(actions)
      .where(
        and(
          eq(actions.worldId, worldId),
          eq(actions.colonyId, colony.id),
          eq(actions.tick, nextTick),
          eq(actions.status, 'queued'),
        ),
      );

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

    // Update last_action_tick for colony neglect tracking
    await db.update(colonies).set({ lastActionTick: nextTick } as any).where(eq(colonies.id, colony.id));

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
  app.get<WorldParams>('/api/worlds/:id/actions', {
    preHandler: requireAuth,
  }, async (request, reply) => {
    const colony = request.colony!;
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
      .where(
        and(
          eq(actions.worldId, worldId),
          eq(actions.colonyId, colony.id),
          eq(actions.status, 'queued'),
        ),
      );

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
      .where(
        and(
          eq(actions.worldId, worldId),
          eq(actions.colonyId, colony.id),
          sql`${actions.status} IN ('resolved', 'failed')`,
          sql`${actions.tick} >= ${currentTick - 5}`,
        ),
      )
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
  app.get<{ Params: { id: string; actionId: string } }>('/api/worlds/:id/actions/:actionId', {
    preHandler: requireAuth,
  }, async (request, reply) => {
    const colony = request.colony!;
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
      .where(
        and(
          eq(actions.id, actionId),
          eq(actions.colonyId, colony.id),
        ),
      )
      .limit(1);

    if (rows.length === 0) {
      return reply.code(404).send({ error: 'not_found', message: 'Action not found' });
    }

    return rows[0];
  });
}
