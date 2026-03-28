/**
 * World and colony endpoints.
 *
 * POST   /api/worlds/:id/join   — Public: join a world (creates colony, returns API key)
 * DELETE /api/worlds/:id/colony — Auth: delete own colony (resets join rate limit)
 * GET    /api/worlds            — Public: list worlds
 * GET    /api/worlds/:id        — Public: world info
 *
 * World creation is not exposed via API — create worlds via DB/CLI.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { eq, and, sql } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { db } from '../db/index.js';
import { worlds, hexes, colonies, settlements, units } from '../db/schema/index.js';
import { generateWorld, findStartingPositions, recommendedRadius, recommendedMinSpacing } from '../engine/mapgen.js';
import { hexDistance } from '../engine/hex.js';
import { generateApiKey, hashApiKey } from '../lib/auth.js';
import { requireAuth } from '../middleware/index.js';
import { clearJoinRateLimit } from '../lib/ratelimit.js';
import { NEWCOMER_PROTECTION_TICKS } from '../engine/tick.js';
// --- Input Sanitization ---

/** Only allow alphanumeric, spaces, hyphens, underscores, apostrophes */
const VALID_NAME_REGEX = /^[a-zA-Z0-9 _'-]+$/;

function sanitizeName(name: string, maxLength: number): { valid: boolean; sanitized: string; error?: string } {
  const trimmed = name.trim();
  if (trimmed.length === 0) {
    return { valid: false, sanitized: '', error: 'Name is required' };
  }
  if (trimmed.length > maxLength) {
    return { valid: false, sanitized: '', error: `Name must be ${maxLength} characters or less` };
  }
  if (!VALID_NAME_REGEX.test(trimmed)) {
    return { valid: false, sanitized: '', error: 'Name may only contain letters, numbers, spaces, hyphens, underscores, and apostrophes' };
  }
  return { valid: true, sanitized: trimmed };
}

// --- Types ---

interface JoinWorldBody {
  name: string;
}

// --- Constants ---

const DEFAULT_RESOURCES = {
  food: 100,
  timber: 50,
  stone: 30,
  iron: 10,
  steel: 0,
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
        starSystemId: worlds.starSystemId,
        theaterType: worlds.theaterType,
        orbitalSlot: worlds.orbitalSlot,
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

  // Join world (creates colony)
  app.post('/api/worlds/:id/join', async (
    request: FastifyRequest<{ Params: { id: string }; Body: JoinWorldBody }>,
    reply: FastifyReply,
  ) => {
    const { id: worldId } = request.params;
    const body = request.body as JoinWorldBody;

    if (!body?.name || typeof body.name !== 'string') {
      return reply.code(400).send({
        error: 'validation_error',
        message: 'Colony name is required',
      });
    }

    const nameCheck = sanitizeName(body.name, 40);
    if (!nameCheck.valid) {
      return reply.code(400).send({
        error: 'validation_error',
        message: nameCheck.error,
      });
    }
    const colonyName = nameCheck.sanitized;

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

    // Count existing colonies and enforce maxColonies limit
    const colonyCountResult = await db
      .select({ count: sql<number>`count(*)` })
      .from(colonies)
      .where(eq(colonies.worldId, worldId));
    const colonyCount = Number(colonyCountResult[0]?.count ?? 0);

    if (colonyCount >= w.maxColonies) {
      if (w.status !== 'full') {
        await db.update(worlds).set({ status: 'full' }).where(eq(worlds.id, worldId));
      }
      return reply.code(409).send({
        error: 'world_full',
        message: `This world has reached the maximum of ${w.maxColonies} colonies.`,
      });
    }

    // Find a starting position dynamically
    const existingSettlements = await db
      .select({ hexX: settlements.hexX, hexY: settlements.hexY })
      .from(settlements)
      .where(eq(settlements.worldId, worldId));

    const worldMap = generateWorld(w.mapSeed, w.mapRadius, w.maxColonies);

    const occupied = existingSettlements.map(s => ({ q: s.hexX, r: s.hexY }));
    const MIN_SPAWN_SPACING = Math.min(20, recommendedMinSpacing(w.maxColonies, w.mapRadius));

    let startingHex: { q: number; r: number } | null = null;

    // 1. Check pre-generated starting positions
    for (const pos of worldMap.startingPositions) {
      const tooClose = occupied.some(
        (s) => hexDistance(s, pos) < MIN_SPAWN_SPACING,
      );
      if (!tooClose) {
        startingHex = pos;
        break;
      }
    }

    // 2. Dynamically find a spawn point if needed
    if (!startingHex) {
      const spawnPositions = findStartingPositions(
        worldMap.hexes, w.mapRadius, w.mapSeed, 64, MIN_SPAWN_SPACING,
      );
      for (const pos of spawnPositions) {
        const tooClose = occupied.some(
          (s) => hexDistance(s, pos) < MIN_SPAWN_SPACING,
        );
        if (!tooClose) {
          startingHex = pos;
          break;
        }
      }
    }

    if (!startingHex) {
      return reply.code(409).send({
        error: 'no_positions',
        message: 'No suitable starting positions available. The world map is full.',
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
      newcomerProtectionUntilTick: w.currentTick + NEWCOMER_PROTECTION_TICKS,
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
    const sq = startingHex.q;
    const sr = startingHex.r;
    await db.execute(sql`
      UPDATE hexes
      SET explored_by = array_append(explored_by, ${colonyId})
      WHERE world_id = ${worldId}
        AND NOT (${colonyId} = ANY(explored_by))
        AND (
          GREATEST(
            ABS(x - ${sq}),
            ABS(y - ${sr}),
            ABS((x - ${sq}) + (y - ${sr}))
          ) <= ${FOG_REVEAL_RADIUS}
        )
    `);

    // Transition world status
    if (w.status === 'open' && colonyCount === 0) {
      await db.update(worlds).set({ status: 'running' }).where(eq(worlds.id, worldId));
    }

    // Check if world should transition to FULL
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

    return reply.code(201).send({
      colonyId,
      name: colonyName,
      apiKey,
      worldId,
      newcomerProtectionUntilTick: w.currentTick + NEWCOMER_PROTECTION_TICKS,
      startingPosition: { x: startingHex.q, y: startingHex.r },
      settlement: {
        id: settlementId,
        name: `${colonyName} Prime`,
        tier: 'outpost',
      },
      units: unitRows.map((u) => ({ id: u.id, type: u.type })),
    });
  });

  // Delete own colony (resets join rate limit so player can rejoin)
  app.delete<{ Params: { id: string } }>('/api/worlds/:id/colony', {
    preHandler: requireAuth,
  }, async (request, reply) => {
    const colony = request.colony!;
    const worldId = request.params.id;

    if (colony.worldId !== worldId) {
      return reply.code(403).send({
        error: 'forbidden',
        message: 'API key does not belong to this world',
      });
    }

    // Don't allow deleting eliminated colonies (already gone)
    if (colony.status === 'eliminated') {
      return reply.code(409).send({
        error: 'already_eliminated',
        message: 'This colony is already eliminated',
      });
    }

    const colonyId = colony.id;

    // Delete in dependency order:
    // 1. Units
    await db.delete(units).where(eq(units.colonyId, colonyId));

    // 2. Clear settlement references on hexes
    await db
      .update(hexes)
      .set({ settlementId: null })
      .where(
        and(
          eq(hexes.worldId, worldId),
          sql`settlement_id IN (SELECT id FROM settlements WHERE colony_id = ${colonyId})`,
        ),
      );

    // 3. Settlements
    await db.delete(settlements).where(eq(settlements.colonyId, colonyId));

    // 4. Actions (queued and historical)
    await db.execute(sql`DELETE FROM actions WHERE colony_id = ${colonyId}`);

    // 5. Messages (sent by this colony)
    await db.execute(sql`DELETE FROM messages WHERE from_colony = ${colonyId} OR to_colony = ${colonyId}`);

    // 6. Agreements involving this colony
    await db.execute(sql`
      DELETE FROM agreements
      WHERE proposed_by = ${colonyId} OR proposed_to = ${colonyId}
    `);

    // 7. Remove colony from explored_by arrays on hexes
    await db.execute(sql`
      UPDATE hexes
      SET explored_by = array_remove(explored_by, ${colonyId})
      WHERE world_id = ${worldId}
        AND ${colonyId} = ANY(explored_by)
    `);

    // 8. Clear POI discoveries by this colony
    await db.execute(sql`
      UPDATE hexes
      SET poi = jsonb_set(poi, '{discovered_by}', 'null'::jsonb)
      WHERE world_id = ${worldId}
        AND poi IS NOT NULL
        AND poi->>'discovered_by' = ${colonyId}
    `);

    // 9. Delete the colony itself
    await db.delete(colonies).where(eq(colonies.id, colonyId));

    // 10. Clear join rate limit for this IP so they can rejoin immediately
    const ip = request.ip || request.headers['x-forwarded-for'] || 'unknown';
    const ipKey = Array.isArray(ip) ? ip[0] : ip;
    clearJoinRateLimit(ipKey);

    // Generate a public event
    const worldState = await db.select({ currentTick: worlds.currentTick }).from(worlds).where(eq(worlds.id, worldId)).limit(1);
    const currentTick = worldState[0]?.currentTick ?? 0;
    const eventId = 'evt_' + nanoid(10);
    await db.execute(sql`
      INSERT INTO events (id, world_id, tick, type, public, visibility, data, public_data)
      VALUES (
        ${eventId},
        ${worldId},
        ${currentTick},
        'colony_departed',
        true,
        ARRAY[]::text[],
        ${JSON.stringify({ colonyId, colonyName: colony.name })}::jsonb,
        ${JSON.stringify({ colony: colony.name })}::jsonb
      )
    `);

    request.log.info(`Colony ${colony.name} (${colonyId}) deleted from world ${worldId}`);

    return reply.code(200).send({
      message: `Colony "${colony.name}" has been deleted. You may rejoin immediately.`,
      colonyId,
      worldId,
    });
  });
}
