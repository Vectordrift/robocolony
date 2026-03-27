import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { and, desc, eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { db } from '../db/index.js';
import { colonies, feedbackReports, worlds } from '../db/schema/index.js';
import { isValidKeyFormat, verifyApiKey } from '../lib/auth.js';

type FeedbackType = 'bug' | 'balance' | 'suggestion';

interface CreateFeedbackParams {
  Params: { id: string };
  Body: {
    type?: string;
    title?: string;
    description?: string;
    reporterName?: string;
    metadata?: Record<string, unknown>;
  };
}

interface ListFeedbackQuery {
  Querystring: {
    world_id?: string;
    limit?: string;
    type?: string;
  };
}

const FEEDBACK_TYPES: ReadonlySet<string> = new Set(['bug', 'balance', 'suggestion']);
const MAX_TITLE_LENGTH = 120;
const MAX_DESCRIPTION_LENGTH = 4000;
const MAX_REPORTER_NAME_LENGTH = 40;
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

function sanitizeText(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > maxLength) return null;
  return trimmed;
}

async function authenticateOptionalColony(request: FastifyRequest): Promise<{
  id: string;
  worldId: string;
  name: string;
  status: string;
} | null> {
  const authHeader = request.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;

  const apiKey = authHeader.slice(7);
  if (!isValidKeyFormat(apiKey)) {
    throw new Error('Invalid API key format');
  }

  const allColonies = await db
    .select({
      id: colonies.id,
      worldId: colonies.worldId,
      name: colonies.name,
      apiKeyHash: colonies.apiKeyHash,
      status: colonies.status,
    })
    .from(colonies);

  for (const colony of allColonies) {
    const isValid = await verifyApiKey(apiKey, colony.apiKeyHash);
    if (!isValid) continue;
    if (colony.status === 'eliminated') {
      throw new Error('Eliminated colonies cannot submit feedback');
    }
    return colony;
  }

  throw new Error('Invalid API key');
}

export async function feedbackRoutes(app: FastifyInstance) {
  app.post<CreateFeedbackParams>('/api/worlds/:id/feedback', async (request: FastifyRequest<CreateFeedbackParams>, reply: FastifyReply) => {
    const worldId = request.params.id;
    const body = request.body ?? {};

    const worldRows = await db
      .select({ id: worlds.id, currentTick: worlds.currentTick, name: worlds.name })
      .from(worlds)
      .where(eq(worlds.id, worldId))
      .limit(1);

    if (worldRows.length === 0) {
      return reply.code(404).send({ error: 'not_found', message: 'World not found' });
    }

    if (!body.type || !FEEDBACK_TYPES.has(body.type)) {
      return reply.code(400).send({
        error: 'validation_error',
        message: 'Feedback type must be one of: bug, balance, suggestion',
      });
    }

    const title = sanitizeText(body.title, MAX_TITLE_LENGTH);
    if (!title) {
      return reply.code(400).send({
        error: 'validation_error',
        message: `Title is required and must be ${MAX_TITLE_LENGTH} characters or less`,
      });
    }

    const description = sanitizeText(body.description, MAX_DESCRIPTION_LENGTH);
    if (!description) {
      return reply.code(400).send({
        error: 'validation_error',
        message: `Description is required and must be ${MAX_DESCRIPTION_LENGTH} characters or less`,
      });
    }

    const reporterName = body.reporterName === undefined
      ? null
      : sanitizeText(body.reporterName, MAX_REPORTER_NAME_LENGTH);

    if (body.reporterName !== undefined && reporterName === null) {
      return reply.code(400).send({
        error: 'validation_error',
        message: `Reporter name must be ${MAX_REPORTER_NAME_LENGTH} characters or less`,
      });
    }

    let colony: Awaited<ReturnType<typeof authenticateOptionalColony>> | null = null;
    try {
      colony = await authenticateOptionalColony(request);
    } catch (error) {
      return reply.code(401).send({
        error: 'unauthorized',
        message: error instanceof Error ? error.message : 'Invalid API key',
      });
    }

    if (colony && colony.worldId !== worldId) {
      return reply.code(403).send({
        error: 'forbidden',
        message: 'API key does not belong to this world',
      });
    }

    const world = worldRows[0];
    const id = `fb_${nanoid(12)}`;
    const metadata = body.metadata && typeof body.metadata === 'object' ? body.metadata : {};

    await db.insert(feedbackReports).values({
      id,
      worldId,
      colonyId: colony?.id ?? null,
      reporterName: reporterName ?? colony?.name ?? null,
      type: body.type as FeedbackType,
      title,
      description,
      tick: world.currentTick ?? 0,
      metadata,
    });

    return reply.code(201).send({
      id,
      world: {
        id: world.id,
        name: world.name,
        currentTick: world.currentTick ?? 0,
      },
      feedback: {
        type: body.type,
        title,
        description,
        reporterName: reporterName ?? colony?.name ?? null,
        colonyId: colony?.id ?? null,
        tick: world.currentTick ?? 0,
      },
    });
  });

  app.get<ListFeedbackQuery>('/api/feedback', async (request, reply) => {
    const worldId = request.query.world_id;
    const type = request.query.type;
    let limit = request.query.limit ? Number.parseInt(request.query.limit, 10) : DEFAULT_LIMIT;
    if (!Number.isFinite(limit) || limit < 1) limit = DEFAULT_LIMIT;
    if (limit > MAX_LIMIT) limit = MAX_LIMIT;

    if (type && !FEEDBACK_TYPES.has(type)) {
      return reply.code(400).send({
        error: 'validation_error',
        message: 'Feedback type must be one of: bug, balance, suggestion',
      });
    }

    const conditions = [];
    if (worldId) conditions.push(eq(feedbackReports.worldId, worldId));
    if (type) conditions.push(eq(feedbackReports.type, type as FeedbackType));

    const rows = await db
      .select({
        id: feedbackReports.id,
        worldId: feedbackReports.worldId,
        colonyId: feedbackReports.colonyId,
        reporterName: feedbackReports.reporterName,
        type: feedbackReports.type,
        title: feedbackReports.title,
        description: feedbackReports.description,
        tick: feedbackReports.tick,
        metadata: feedbackReports.metadata,
        createdAt: feedbackReports.createdAt,
      })
      .from(feedbackReports)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(feedbackReports.createdAt))
      .limit(limit);

    const worldRows = await db
      .select({
        id: worlds.id,
        name: worlds.name,
      })
      .from(worlds);

    const worldNames = new Map(worldRows.map((world) => [world.id, world.name]));

    return {
      count: rows.length,
      reports: rows.map((row) => ({
        id: row.id,
        worldId: row.worldId,
        worldName: worldNames.get(row.worldId) ?? row.worldId,
        colonyId: row.colonyId,
        reporterName: row.reporterName,
        type: row.type,
        title: row.title,
        description: row.description,
        tick: row.tick,
        metadata: row.metadata ?? {},
        createdAt: row.createdAt?.toISOString() ?? null,
      })),
    };
  });
}
