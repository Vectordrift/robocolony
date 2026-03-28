/**
 * Action submission endpoints.
 *
 * POST /api/worlds/:id/actions — submit actions for next tick
 * GET  /api/worlds/:id/actions — list queued and recent resolved actions
 * DELETE /api/worlds/:id/actions/:actionId — cancel a queued action
 * DELETE /api/worlds/:id/actions — cancel all queued actions for next tick
 */

import type { FastifyInstance } from 'fastify';
import { eq, and, desc, sql, inArray, lt } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { db } from '../db/index.js';
import { worlds, actions, colonies, units, settlements } from '../db/schema/index.js';
import { requireAuth } from '../middleware/index.js';
import { normalizeAgreementTerms, TECH_TREE, canResearchTech, type AgreementType, type TechId } from '../engine/tick.js';

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

// Valid building types
const VALID_BUILDING_TYPES = new Set([
  'farm', 'lumberMill', 'quarry', 'mine', 'barracks', 'granary', 'market', 'workshop',
]);

// Valid unit types
const VALID_UNIT_TYPES = new Set([
  'scout', 'militia', 'soldier', 'siege', 'settler', 'engineer',
]);

// Valid resources
const VALID_RESOURCES = new Set([
  'food', 'timber', 'stone', 'iron', 'influence',
]);

// Valid agreement types
const VALID_AGREEMENT_TYPES = new Set([
  'non_aggression', 'trade', 'alliance', 'ceasefire',
]);

const BASE_ACTIONS_PER_TICK = 10;
const ACTIONS_PER_SETTLEMENT = 2;
const MAX_SETTLEMENT_NAME_LENGTH = 40;
const MAX_MESSAGE_LENGTH = 500;

type ParamType = 'string' | 'integer' | 'number' | 'object';

interface ActionParamSchema {
  type: ParamType;
  description: string;
  validValues?: string[];
}

interface ActionDefinition {
  description: string;
  required: string[];
  optional: string[];
  params: Record<string, ActionParamSchema>;
}

const ACTION_DEFINITIONS: Record<string, ActionDefinition> = {
  move_unit: {
    description: 'Queue a unit to move toward a target hex.',
    required: ['unitId', 'targetX', 'targetY'],
    optional: [],
    params: {
      unitId: { type: 'string', description: 'The unit to move.' },
      targetX: { type: 'integer', description: 'Destination hex x coordinate.' },
      targetY: { type: 'integer', description: 'Destination hex y coordinate.' },
    },
  },
  build: {
    description: 'Queue a building in one of your settlements.',
    required: ['settlementId', 'buildingType'],
    optional: [],
    params: {
      settlementId: { type: 'string', description: 'Settlement that will build.' },
      buildingType: { type: 'string', description: 'Building to construct.', validValues: [...VALID_BUILDING_TYPES] },
    },
  },
  upgrade_building: {
    description: 'Upgrade an existing building in one of your settlements.',
    required: ['settlementId', 'buildingType'],
    optional: [],
    params: {
      settlementId: { type: 'string', description: 'Settlement that contains the building.' },
      buildingType: { type: 'string', description: 'Building to upgrade.', validValues: [...VALID_BUILDING_TYPES] },
    },
  },
  train_unit: {
    description: 'Train a new unit in a settlement.',
    required: ['settlementId', 'unitType'],
    optional: [],
    params: {
      settlementId: { type: 'string', description: 'Settlement that will train the unit.' },
      unitType: { type: 'string', description: 'Unit type to train.', validValues: [...VALID_UNIT_TYPES] },
    },
  },
  found_settlement: {
    description: 'Use a settler to found a new settlement.',
    required: ['unitId', 'name'],
    optional: [],
    params: {
      unitId: { type: 'string', description: 'Settler unit that will found the settlement.' },
      name: { type: 'string', description: `Settlement name, max ${MAX_SETTLEMENT_NAME_LENGTH} characters.` },
    },
  },
  demolish: {
    description: 'Remove a building from a settlement.',
    required: ['settlementId', 'buildingType'],
    optional: [],
    params: {
      settlementId: { type: 'string', description: 'Settlement that contains the building.' },
      buildingType: { type: 'string', description: 'Building to demolish.', validValues: [...VALID_BUILDING_TYPES] },
    },
  },
  upgrade_settlement: {
    description: 'Upgrade a settlement to the next tier.',
    required: ['settlementId'],
    optional: [],
    params: {
      settlementId: { type: 'string', description: 'Settlement to upgrade.' },
    },
  },
  attack: {
    description: 'Order a unit to attack a target hex.',
    required: ['unitId', 'targetX', 'targetY'],
    optional: [],
    params: {
      unitId: { type: 'string', description: 'Unit that will attack.' },
      targetX: { type: 'integer', description: 'Target hex x coordinate.' },
      targetY: { type: 'integer', description: 'Target hex y coordinate.' },
    },
  },
  build_road: {
    description: 'Order an engineer to construct a road between adjacent hexes.',
    required: ['unitId', 'fromX', 'fromY', 'toX', 'toY'],
    optional: [],
    params: {
      unitId: { type: 'string', description: 'Engineer unit that will build the road.' },
      fromX: { type: 'integer', description: 'Starting hex x coordinate.' },
      fromY: { type: 'integer', description: 'Starting hex y coordinate.' },
      toX: { type: 'integer', description: 'Ending hex x coordinate.' },
      toY: { type: 'integer', description: 'Ending hex y coordinate.' },
    },
  },
  send_message: {
    description: 'Send a diplomatic message to another colony.',
    required: ['toColonyId', 'message'],
    optional: [],
    params: {
      toColonyId: { type: 'string', description: 'Recipient colony ID.' },
      message: { type: 'string', description: `Message body, max ${MAX_MESSAGE_LENGTH} characters.` },
    },
  },
  explore: {
    description: 'Let a scout automatically explore the frontier.',
    required: ['unitId'],
    optional: [],
    params: {
      unitId: { type: 'string', description: 'Scout unit that will auto-explore.' },
    },
  },
  survey_poi: {
    description: 'Survey a point of interest with a scout.',
    required: ['unitId'],
    optional: [],
    params: {
      unitId: { type: 'string', description: 'Scout unit performing the survey.' },
    },
  },
  convert_resources: {
    description: 'Convert one resource into another at a settlement.',
    required: ['settlementId', 'fromResource', 'toResource', 'amount'],
    optional: [],
    params: {
      settlementId: { type: 'string', description: 'Settlement doing the conversion.' },
      fromResource: { type: 'string', description: 'Resource spent in the conversion.', validValues: [...VALID_RESOURCES] },
      toResource: { type: 'string', description: 'Resource produced by the conversion.', validValues: [...VALID_RESOURCES] },
      amount: { type: 'number', description: 'Positive amount to convert.' },
    },
  },
  research: {
    description: 'Queue research toward a technology.',
    required: ['techId'],
    optional: [],
    params: {
      techId: { type: 'string', description: 'Technology identifier to research.' },
    },
  },
  propose_agreement: {
    description: 'Propose a diplomatic agreement to another colony.',
    required: ['targetColonyId', 'agreementType'],
    optional: ['terms'],
    params: {
      targetColonyId: { type: 'string', description: 'Target colony for the proposal.' },
      agreementType: { type: 'string', description: 'Agreement type being proposed.', validValues: [...VALID_AGREEMENT_TYPES] },
      terms: { type: 'object', description: 'Optional agreement terms object, normalized per agreement type.' },
    },
  },
  accept_agreement: {
    description: 'Accept a proposed agreement.',
    required: ['agreementId'],
    optional: [],
    params: {
      agreementId: { type: 'string', description: 'Agreement to accept.' },
    },
  },
  reject_agreement: {
    description: 'Reject a proposed agreement.',
    required: ['agreementId'],
    optional: [],
    params: {
      agreementId: { type: 'string', description: 'Agreement to reject.' },
    },
  },
  break_agreement: {
    description: 'Break an active agreement.',
    required: ['agreementId'],
    optional: [],
    params: {
      agreementId: { type: 'string', description: 'Agreement to break.' },
    },
  },
  disband: {
    description: 'Disband one of your units.',
    required: ['unitId'],
    optional: [],
    params: {
      unitId: { type: 'string', description: 'Unit to disband.' },
    },
  },
};

const VALID_ACTION_TYPES = Object.fromEntries(
  Object.entries(ACTION_DEFINITIONS).map(([type, definition]) => [type, definition.required]),
);

const ALLOWED_PARAMS = Object.fromEntries(
  Object.entries(ACTION_DEFINITIONS).map(([type, definition]) => [type, [...definition.required, ...definition.optional]]),
);

/** Number of ticks after which unprocessed queued actions are auto-expired */
const STALE_ACTION_TICKS = 5;

/**
 * Expire stale queued actions: any action with status 'queued' whose tick
 * is <= currentTick (i.e. the tick has already been processed) gets marked
 * as 'failed' with an expiry reason.
 */
async function expireStaleActions(worldId: string, currentTick: number): Promise<number> {
  const result = await db
    .update(actions)
    .set({ status: 'failed', result: 'Auto-expired: action was queued for a tick that has already passed' })
    .where(
      and(
        eq(actions.worldId, worldId),
        eq(actions.status, 'queued'),
        sql`${actions.tick} <= ${currentTick}`,
      ),
    );
  // drizzle update returns the rows affected (driver-dependent)
  return (result as any)?.rowCount ?? (result as any)?.changes ?? 0;
}

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
  help?: Record<string, unknown>;
}

interface ActionValidationError {
  index: number;
  actionType: string | null;
  error: string;
  help?: Record<string, unknown>;
}

export function getMaxActionsPerTick(settlementCount: number): number {
  return BASE_ACTIONS_PER_TICK + Math.max(0, settlementCount) * ACTIONS_PER_SETTLEMENT;
}

async function getQueuedActionLimit(colonyId: string, worldId: string): Promise<number> {
  const settlementCountRows = await db
    .select({ count: sql<number>`count(*)` })
    .from(settlements)
    .where(
      and(
        eq(settlements.worldId, worldId),
        eq(settlements.colonyId, colonyId),
      ),
    );

  return getMaxActionsPerTick(Number(settlementCountRows[0]?.count ?? 0));
}

/**
 * Validate action type, required params, param types, and param values.
 * Also strips unknown params (additionalProperties: false equivalent).
 */
function validateActionParams(action: ActionInput, mapRadius: number): ValidationResult {
  if (!action.type || typeof action.type !== 'string') {
    return {
      valid: false,
      error: 'Action type is required',
      help: { validActionTypes: Object.keys(ACTION_DEFINITIONS) },
    };
  }

  const definition = ACTION_DEFINITIONS[action.type];
  const requiredParams = VALID_ACTION_TYPES[action.type];
  if (!requiredParams || !definition) {
    return {
      valid: false,
      error: `Unknown action type: ${action.type}. Valid types: ${Object.keys(VALID_ACTION_TYPES).join(', ')}`,
      help: { validActionTypes: Object.keys(ACTION_DEFINITIONS) },
    };
  }

  if (!action.params || typeof action.params !== 'object') {
    return {
      valid: false,
      error: `Action params are required for type: ${action.type}`,
      help: {
        requiredParams,
        optionalParams: definition.optional,
      },
    };
  }

  // Check required params exist
  for (const param of requiredParams) {
    if (action.params[param] === undefined || action.params[param] === null) {
      return {
        valid: false,
        error: `Missing required param '${param}' for action type '${action.type}'`,
        help: {
          requiredParams,
          optionalParams: definition.optional,
          paramSchema: definition.params,
        },
      };
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
      return { valid: false, error: `'targetX' must be an integer, got: ${typeof p.targetX === 'number' ? p.targetX : typeof p.targetX}`, help: { expectedType: 'integer' } };
    }
    if (!isFiniteInt(p.targetY)) {
      return { valid: false, error: `'targetY' must be an integer, got: ${typeof p.targetY === 'number' ? p.targetY : typeof p.targetY}`, help: { expectedType: 'integer' } };
    }
    if ((p.targetX as number) < -mapRadius || (p.targetX as number) > mapRadius) {
      return { valid: false, error: `'targetX' out of map bounds: ${p.targetX} (must be between -${mapRadius} and ${mapRadius})`, help: { min: -mapRadius, max: mapRadius } };
    }
    if ((p.targetY as number) < -mapRadius || (p.targetY as number) > mapRadius) {
      return { valid: false, error: `'targetY' out of map bounds: ${p.targetY} (must be between -${mapRadius} and ${mapRadius})`, help: { min: -mapRadius, max: mapRadius } };
    }
    if (typeof p.unitId !== 'string' || p.unitId.length === 0) {
      return { valid: false, error: `'unitId' must be a non-empty string` };
    }
  }

  if (action.type === 'build_road') {
    if (typeof p.unitId !== 'string' || p.unitId.length === 0) {
      return { valid: false, error: `'unitId' must be a non-empty string` };
    }
    for (const coordKey of ['fromX', 'fromY', 'toX', 'toY'] as const) {
      if (!isFiniteInt(p[coordKey])) {
        return { valid: false, error: `'${coordKey}' must be an integer`, help: { expectedType: 'integer' } };
      }
      if ((p[coordKey] as number) < -mapRadius || (p[coordKey] as number) > mapRadius) {
        return { valid: false, error: `'${coordKey}' out of map bounds: ${p[coordKey]} (must be between -${mapRadius} and ${mapRadius})`, help: { min: -mapRadius, max: mapRadius } };
      }
    }

    const fromX = p.fromX as number;
    const fromY = p.fromY as number;
    const toX = p.toX as number;
    const toY = p.toY as number;
    const axialDistance = (Math.abs(fromX - toX) + Math.abs(fromY - toY) + Math.abs((fromX + fromY) - (toX + toY))) / 2;
    if (axialDistance !== 1) {
      return { valid: false, error: 'Road endpoints must be adjacent hexes' };
    }
  }

  // String ID validation for unit-based actions
  if (['explore', 'survey_poi', 'found_settlement', 'disband'].includes(action.type)) {
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
      return { valid: false, error: `Invalid buildingType '${p.buildingType}'. Valid: ${[...VALID_BUILDING_TYPES].join(', ')}`, help: { validValues: [...VALID_BUILDING_TYPES] } };
    }
  }

  // Unit type validation for train_unit
  if (action.type === 'train_unit') {
    if (typeof p.settlementId !== 'string' || p.settlementId.length === 0) {
      return { valid: false, error: `'settlementId' must be a non-empty string` };
    }
    if (typeof p.unitType !== 'string' || !VALID_UNIT_TYPES.has(p.unitType as string)) {
      return { valid: false, error: `Invalid unitType '${p.unitType}'. Valid: ${[...VALID_UNIT_TYPES].join(', ')}`, help: { validValues: [...VALID_UNIT_TYPES] } };
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
      return { valid: false, error: `Invalid fromResource '${p.fromResource}'. Valid: ${[...VALID_RESOURCES].join(', ')}`, help: { validValues: [...VALID_RESOURCES] } };
    }
    if (typeof p.toResource !== 'string' || !VALID_RESOURCES.has(p.toResource as string)) {
      return { valid: false, error: `Invalid toResource '${p.toResource}'. Valid: ${[...VALID_RESOURCES].join(', ')}`, help: { validValues: [...VALID_RESOURCES] } };
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
      return { valid: false, error: `Invalid agreementType '${p.agreementType}'. Valid: ${[...VALID_AGREEMENT_TYPES].join(', ')}`, help: { validValues: [...VALID_AGREEMENT_TYPES] } };
    }
    const normalizedTerms = normalizeAgreementTerms(p.agreementType as AgreementType, p.terms);
    if (!normalizedTerms.valid) {
      return { valid: false, error: normalizedTerms.error, help: { agreementType: p.agreementType } };
    }
    p.terms = normalizedTerms.terms as Record<string, unknown>;
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
    if ((action.type === 'explore' || action.type === 'survey_poi') && unit[0].type !== 'scout') {
      return { valid: false, error: `Unit ${truncId(params.unitId as string)} is a ${unit[0].type}, not a scout. Only scouts can use the ${action.type} action.` };
    }
    if (action.type === 'build_road' && unit[0].type !== 'engineer') {
      return { valid: false, error: `Unit ${truncId(params.unitId as string)} is a ${unit[0].type}, not an engineer. Only engineers can build roads.` };
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

async function validateActionContext(
  colonyId: string,
  worldId: string,
  action: ActionInput,
): Promise<ValidationResult> {
  if (action.type === 'build_road') {
    const colonyRows = await db
      .select({ researchedTechs: colonies.researchedTechs })
      .from(colonies)
      .where(
        and(
          eq(colonies.worldId, worldId),
          eq(colonies.id, colonyId),
        ),
      )
      .limit(1);

    const researched: string[] = (colonyRows[0] as { researchedTechs?: string[] } | undefined)?.researchedTechs ?? [];
    if (!researched.includes('civil_engineering')) {
      return { valid: false, error: 'You need Civil Engineering before engineers can build roads.' };
    }

    return { valid: true };
  }

  if (action.type !== 'research') {
    return { valid: true };
  }

  const colonySettlements = await db
    .select({ buildings: settlements.buildings })
    .from(settlements)
    .where(
      and(
        eq(settlements.worldId, worldId),
        eq(settlements.colonyId, colonyId),
      ),
    );

  const hasWorkshop = colonySettlements.some((settlement) =>
    Array.isArray(settlement.buildings)
    && settlement.buildings.some((building) => building?.type === 'workshop'),
  );

  if (!hasWorkshop) {
    return { valid: false, error: 'You need a workshop building to research. Build a workshop first.' };
  }

  const colonyRows = await db
    .select({ researchedTechs: colonies.researchedTechs })
    .from(colonies)
    .where(
      and(
        eq(colonies.worldId, worldId),
        eq(colonies.id, colonyId),
      ),
    )
    .limit(1);

  const techId = action.params.techId as TechId | undefined;
  if (!techId || !TECH_TREE[techId]) {
    return { valid: false, error: `Unknown tech: ${techId}. Valid techs: ${Object.keys(TECH_TREE).join(', ')}` };
  }

  const researched: string[] = (colonyRows[0] as { researchedTechs?: string[] } | undefined)?.researchedTechs ?? [];
  const eligibility = canResearchTech(techId, researched);
  if (!eligibility.ok) {
    return { valid: false, error: eligibility.reason };
  }

  return { valid: true };
}

// --- Action Schema (for discoverability) ---

/** Build the action schema object describing all valid action types and their params */
function getActionSchema(): Record<string, { required: string[]; optional: string[]; validValues?: Record<string, string[]> }> {
  const schema: Record<string, { description: string; required: string[]; optional: string[]; params: Record<string, ActionParamSchema>; validValues?: Record<string, string[]> }> = {};
  for (const [type, definition] of Object.entries(ACTION_DEFINITIONS)) {
    const validValues = Object.fromEntries(
      Object.entries(definition.params)
        .filter(([, value]) => Array.isArray(value.validValues))
        .map(([key, value]) => [key, value.validValues as string[]]),
    );

    schema[type] = {
      description: definition.description,
      required: definition.required,
      optional: definition.optional,
      params: definition.params,
      ...(Object.keys(validValues).length > 0 ? { validValues } : {}),
    };
  }
  return schema;
}

// --- Routes ---

export async function actionRoutes(app: FastifyInstance) {
  // Action schema — discover valid action types and their params (no auth required)
  app.get('/api/worlds/:id/actions/schema', async (_request, reply) => {
    return {
      maxActionsPerTick: BASE_ACTIONS_PER_TICK,
      actionCapacity: {
        basePerTick: BASE_ACTIONS_PER_TICK,
        perSettlement: ACTIONS_PER_SETTLEMENT,
      },
      notes: {
        unknownParamsStripped: true,
        validationErrorsIncludeHints: true,
      },
      actionTypes: getActionSchema(),
    };
  });

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
    const maxActionsPerTick = await getQueuedActionLimit(colony.id, worldId);

    // Auto-expire stale queued actions from previous ticks
    await expireStaleActions(worldId, currentTick);

    // Validate all actions first (before rate limit — invalid actions should not consume slots)
    const validationErrors: ActionValidationError[] = [];

    for (let i = 0; i < body.actions.length; i++) {
      const action = body.actions[i];

      // Comprehensive type + value validation (also strips extra params)
      const paramResult = validateActionParams(action, mapRadius);
      if (!paramResult.valid) {
        validationErrors.push({
          index: i,
          actionType: action?.type ?? null,
          error: paramResult.error!,
          ...(paramResult.help ? { help: paramResult.help } : {}),
        });
        continue;
      }

      // Ownership validation
      const ownerResult = await validateOwnership(colony.id, worldId, action);
      if (!ownerResult.valid) {
        validationErrors.push({ index: i, actionType: action.type, error: ownerResult.error! });
        continue;
      }

      const contextResult = await validateActionContext(colony.id, worldId, action);
      if (!contextResult.valid) {
        validationErrors.push({
          index: i,
          actionType: action.type,
          error: contextResult.error!,
          ...(contextResult.help ? { help: contextResult.help } : {}),
        });
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
    const remainingSlots = maxActionsPerTick - currentQueuedCount;

    // Truncate batch to fit remaining slots (partial accept)
    let truncated = false;
    if (body.actions.length > remainingSlots) {
      if (remainingSlots <= 0) {
        return reply.code(429).send({
          error: 'rate_limit',
          message: `Rate limit: max ${maxActionsPerTick} actions per tick. You have ${currentQueuedCount} queued, 0 remaining.`,
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
        message: `Batch truncated: ${inserted.length} of your actions accepted (max ${maxActionsPerTick}/tick, ${currentQueuedCount} already queued).`,
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
    const nextTick = currentTick + 1;
    const maxActionsPerTick = await getQueuedActionLimit(colony.id, worldId);

    // Auto-expire stale queued actions from previous ticks
    await expireStaleActions(worldId, currentTick);

    // Get queued actions (next tick only — stale ones have been expired above)
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
          eq(actions.tick, nextTick),
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
        maxPerTick: maxActionsPerTick,
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

  // Cancel a single queued action
  app.delete<{ Params: { id: string; actionId: string } }>('/api/worlds/:id/actions/:actionId', {
    preHandler: requireAuth,
  }, async (request, reply) => {
    const colony = request.colony!;
    const { actionId } = request.params;

    // Find the action
    const rows = await db
      .select({
        id: actions.id,
        status: actions.status,
        colonyId: actions.colonyId,
      })
      .from(actions)
      .where(
        and(
          eq(actions.id, actionId),
          eq(actions.worldId, colony.worldId),
        ),
      )
      .limit(1);

    if (rows.length === 0) {
      return reply.code(404).send({ error: 'not_found', message: 'Action not found' });
    }

    if (rows[0].colonyId !== colony.id) {
      return reply.code(403).send({ error: 'forbidden', message: 'Action does not belong to your colony' });
    }

    if (rows[0].status !== 'queued') {
      return reply.code(409).send({
        error: 'conflict',
        message: `Cannot cancel action with status '${rows[0].status}' — only queued actions can be cancelled`,
      });
    }

    await db
      .update(actions)
      .set({ status: 'failed', result: 'Cancelled by player' })
      .where(eq(actions.id, actionId));

    return { cancelled: true, actionId };
  });

  // Cancel all queued actions for next tick
  app.delete<WorldParams>('/api/worlds/:id/actions', {
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

    // First expire any stale actions
    await expireStaleActions(worldId, currentTick);

    // Cancel all queued actions for this colony (any future tick)
    const result = await db
      .update(actions)
      .set({ status: 'failed', result: 'Cancelled by player (bulk cancel)' })
      .where(
        and(
          eq(actions.worldId, worldId),
          eq(actions.colonyId, colony.id),
          eq(actions.status, 'queued'),
        ),
      );

    const cancelledCount = (result as any)?.rowCount ?? (result as any)?.changes ?? 0;
    return { cancelled: true, count: cancelledCount };
  });
}
