/**
 * World creation and colony join endpoints.
 *
 * POST /api/worlds       — Admin: create a new world (generates hex map)
 * POST /api/worlds/:id/join — Public: join a world (creates colony, returns API key)
 * GET  /api/worlds       — Public: list worlds
 * GET  /api/worlds/:id   — Public: world info
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { eq, and, sql } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { db } from '../db/index.js';
import { worlds, hexes, colonies, settlements, units } from '../db/schema/index.js';
import { generateWorld } from '../engine/mapgen.js';
import { hexDistance, hexesInRadius } from '../engine/hex.js';
import { generateApiKey, hashApiKey } from '../lib/auth.js';

// --- Types ---

interface CreateWorldBody {
  name: string;
  mapSeed?: number;
  mapRadius?: number;
  maxColonies?: number;
  tickRate?: number;
}

interface JoinWorldBody {
  name: string;
}

// --- Constants ---

const DEFAULT_RESOURCES = {
  food: 100,
  timber: 50,
  stone: 30,
  iron: 10,
  influence: 50,
};

const STARTING_BUILDINGS = [
  { type: 'farm', level: 1 },
  { type: 'lumberMill', level: 1 },
];

const STARTING_UNITS: Array<{ type: string; count: number }> = [
  { type: 'scout', count: 2 },
  { type: 'militia', count: 2 },
  { type: 'settler', count: 1 },
];

const FOG_REVEAL_RADIUS = 5;
const MIN_BUILDABLE_LAND = 300;

// --- Routes ---

export async function worldRoutes(app: FastifyInstance) {
  // List worlds
  app.get('/api/worlds', async (_request: FastifyRequest, _reply: FastifyReply) => {
    const allWorlds = await db
      .select({
        id: worlds.id,
        name: worlds.name,
        status: worlds.status,
        currentTick: worlds.currentTick,
        maxColonies: worlds.maxColonies,
        createdAt: worlds.createdAt,
      })
      .from(worlds);

    // Count colonies per world
    const result = [];
    for (const w of allWorlds) {
      const colonyCount = await db
        .select({ count: sql<number>`count(*)` })
        .from(colonies)
        .where(eq(colonies.worldId, w.id));

      result.push({
        ...w,
        colonyCount: Number(colonyCount[0]?.count ?? 0),
      });
    }

    return result;
  });

  // Get world info
  app.get('/api/worlds/:id', async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const { id } = request.params;

    const world = await db
      .select()
      .from(worlds)
      .where(eq(worlds.id, id))
      .limit(1);

    if (world.length === 0) {
      return reply.code(404).send({ error: 'not_found', message: 'World not found' });
    }

    const colonyCount = await db
      .select({ count: sql<number>`count(*)` })
      .from(colonies)
      .where(eq(colonies.worldId, id));

    return {
      ...world[0],
      colonyCount: Number(colonyCount[0]?.count ?? 0),
    };
  });

  // Create world (admin)
  app.post('/api/worlds', async (request: FastifyRequest<{ Body: CreateWorldBody }>, reply: FastifyReply) => {
    const body = request.body as CreateWorldBody;

    if (!body?.name || typeof body.name !== 'string' || body.name.trim().length === 0) {
      return reply.code(400).send({
        error: 'validation_error',
        message: 'World name is required',
      });
    }

    const name = body.name.trim();
    if (name.length > 50) {
      return reply.code(400).send({
        error: 'validation_error',
        message: 'World name must be 50 characters or less',
      });
    }

    const mapSeed = body.mapSeed ?? Math.floor(Math.random() * 2147483647);
    const mapRadius = body.mapRadius ?? 50;
    const maxColonies = body.maxColonies ?? 8;
    const tickRate = body.tickRate ?? 300000;

    // Validate ranges
    if (mapRadius < 10 || mapRadius > 100) {
      return reply.code(400).send({
        error: 'validation_error',
        message: 'Map radius must be between 10 and 100',
      });
    }

    if (maxColonies < 2 || maxColonies > 16) {
      return reply.code(400).send({
        error: 'validation_error',
        message: 'Max colonies must be between 2 and 16',
      });
    }

    const worldId = `world_${nanoid(12)}`;

    // Generate the hex map
    const worldMap = generateWorld(mapSeed, mapRadius, maxColonies);

    if (worldMap.startingPositions.length < 2) {
      return reply.code(500).send({
        error: 'generation_error',
        message: 'Map seed produced insufficient starting positions. Try a different seed.',
      });
    }

    // Insert world
    await db.insert(worlds).values({
      id: worldId,
      name,
      tickRate,
      currentTick: 0,
      mapSeed,
      status: 'open',
      mapRadius,
      maxColonies,
    });

    // Insert hexes in batches (7850+ hexes for radius 50)
    const hexRows = worldMap.hexes.map((h) => ({
      worldId,
      x: h.q,
      y: h.r,
      terrain: h.terrain,
      resources: h.resources,
      settlementId: null,
      exploredBy: [] as string[],
    }));

    // Batch insert (500 at a time to avoid query size limits)
    const BATCH_SIZE = 500;
    for (let i = 0; i < hexRows.length; i += BATCH_SIZE) {
      const batch = hexRows.slice(i, i + BATCH_SIZE);
      await db.insert(hexes).values(batch);
    }

    return reply.code(201).send({
      id: worldId,
      name,
      status: 'open',
      mapSeed,
      mapRadius,
      maxColonies,
      tickRate,
      currentTick: 0,
      hexCount: worldMap.hexes.length,
      startingPositions: worldMap.startingPositions.length,
    });
  });

  // Join world (creates colony)
  app.post('/api/worlds/:id/join', async (
    request: FastifyRequest<{ Params: { id: string }; Body: JoinWorldBody }>,
    reply: FastifyReply,
  ) => {
    const { id: worldId } = request.params;
    const body = request.body as JoinWorldBody;

    if (!body?.name || typeof body.name !== 'string' || body.name.trim().length === 0) {
      return reply.code(400).send({
        error: 'validation_error',
        message: 'Colony name is required',
      });
    }

    const colonyName = body.name.trim();
    if (colonyName.length > 40) {
      return reply.code(400).send({
        error: 'validation_error',
        message: 'Colony name must be 40 characters or less',
      });
    }

    // Get world
    const world = await db
      .select()
      .from(worlds)
      .where(eq(worlds.id, worldId))
      .limit(1);

    if (world.length === 0) {
      return reply.code(404).send({ error: 'not_found', message: 'World not found' });
    }

    const w = world[0];

    if (w.status === 'full') {
      return reply.code(409).send({
        error: 'world_full',
        message: 'This world is full. No more colonies can join.',
      });
    }

    if (w.status === 'ended') {
      return reply.code(409).send({
        error: 'world_ended',
        message: 'This world has ended.',
      });
    }

    // Check name uniqueness
    const existingName = await db
      .select({ id: colonies.id })
      .from(colonies)
      .where(and(eq(colonies.worldId, worldId), eq(colonies.name, colonyName)))
      .limit(1);

    if (existingName.length > 0) {
      return reply.code(400).send({
        error: 'name_taken',
        message: 'Colony name is already taken in this world',
      });
    }

    // Count existing colonies
    const colonyCountResult = await db
      .select({ count: sql<number>`count(*)` })
      .from(colonies)
      .where(eq(colonies.worldId, worldId));
    const colonyCount = Number(colonyCountResult[0]?.count ?? 0);

    if (colonyCount >= w.maxColonies) {
      return reply.code(409).send({
        error: 'world_full',
        message: 'This world has reached maximum colony count.',
      });
    }

    // Find a starting position
    // Get existing colony settlements to check spacing
    const existingSettlements = await db
      .select({ hexX: settlements.hexX, hexY: settlements.hexY })
      .from(settlements)
      .where(eq(settlements.worldId, worldId));

    // Regenerate map to get starting positions (deterministic from seed)
    const worldMap = generateWorld(w.mapSeed, w.mapRadius, w.maxColonies);

    // Find the first unused starting position (at least 30 hexes from any existing colony)
    let startingHex: { q: number; r: number } | null = null;
    for (const pos of worldMap.startingPositions) {
      const tooClose = existingSettlements.some(
        (s) => hexDistance({ q: s.hexX, r: s.hexY }, pos) < 30,
      );
      if (!tooClose) {
        startingHex = pos;
        break;
      }
    }

    if (!startingHex) {
      return reply.code(409).send({
        error: 'no_positions',
        message: 'No suitable starting positions available.',
      });
    }

    // Generate API key
    const apiKey = generateApiKey();
    const apiKeyHash = await hashApiKey(apiKey);

    const colonyId = `col_${nanoid(10)}`;
    const settlementId = `set_${nanoid(10)}`;

    // Create colony
    await db.insert(colonies).values({
      id: colonyId,
      worldId,
      name: colonyName,
      apiKeyHash,
      resources: DEFAULT_RESOURCES,
      legacyScore: 0,
      status: 'active',
    });

    // Create starting settlement
    await db.insert(settlements).values({
      id: settlementId,
      colonyId,
      worldId,
      name: `${colonyName} Prime`,
      hexX: startingHex.q,
      hexY: startingHex.r,
      tier: 'outpost',
      buildings: STARTING_BUILDINGS,
      buildQueue: [],
      loyalty: 100,
      population: 10,
    });

    // Update the hex with the settlement ID
    await db
      .update(hexes)
      .set({ settlementId })
      .where(
        and(
          eq(hexes.worldId, worldId),
          eq(hexes.x, startingHex.q),
          eq(hexes.y, startingHex.r),
        ),
      );

    // Create starting units
    const unitRows = [];
    for (const unitDef of STARTING_UNITS) {
      for (let i = 0; i < unitDef.count; i++) {
        unitRows.push({
          id: `unit_${nanoid(10)}`,
          colonyId,
          worldId,
          type: unitDef.type,
          hexX: startingHex.q,
          hexY: startingHex.r,
          health: 100,
          morale: 1.0,
          movementQueue: [],
        });
      }
    }
    await db.insert(units).values(unitRows);

    // Reveal hexes in a 5-hex radius around starting position
    // Use raw SQL for efficient batch update with array_append
    const sq = startingHex.q;
    const sr = startingHex.r;
    await db.execute(sql`
      UPDATE hexes
      SET explored_by = array_append(explored_by, ${colonyId})
      WHERE world_id = ${worldId}
        AND NOT (${colonyId} = ANY(explored_by))
        AND (
          -- Hex distance formula for axial coordinates:
          -- dist = max(|dq|, |dr|, |dq+dr|) <= radius
          GREATEST(
            ABS(x - ${sq}),
            ABS(y - ${sr}),
            ABS((x - ${sq}) + (y - ${sr}))
          ) <= ${FOG_REVEAL_RADIUS}
        )
    `);

    // Transition world status
    if (w.status === 'open' && colonyCount === 0) {
      // First colony joins → RUNNING
      await db.update(worlds).set({ status: 'running' }).where(eq(worlds.id, worldId));
    }

    // Check if world should transition to FULL
    const newColonyCount = colonyCount + 1;
    if (newColonyCount >= w.maxColonies) {
      await db.update(worlds).set({ status: 'full' }).where(eq(worlds.id, worldId));
    } else {
      // Also check unclaimed buildable land
      const unclaimedLand = await db
        .select({ count: sql<number>`count(*)` })
        .from(hexes)
        .where(
          and(
            eq(hexes.worldId, worldId),
            sql`terrain NOT IN ('ocean', 'coast')`,
            sql`settlement_id IS NULL`,
          ),
        );

      if (Number(unclaimedLand[0]?.count ?? 0) < MIN_BUILDABLE_LAND) {
        await db.update(worlds).set({ status: 'full' }).where(eq(worlds.id, worldId));
      }
    }

    return reply.code(201).send({
      colonyId,
      name: colonyName,
      apiKey,
      worldId,
      startingPosition: { x: startingHex.q, y: startingHex.r },
      settlement: {
        id: settlementId,
        name: `${colonyName} Prime`,
        tier: 'outpost',
      },
      units: unitRows.map((u) => ({ id: u.id, type: u.type })),
    });
  });
}
