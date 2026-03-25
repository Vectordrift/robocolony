import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import cors from '@fastify/cors';
import { healthRoutes } from './routes/health.js';
import { worldRoutes } from './routes/worlds.js';
import { stateRoutes } from './routes/state.js';
import { actionRoutes } from './routes/actions.js';
import { eventRoutes } from './routes/events.js';
import { feedRoutes } from './routes/feed.js';
import { db } from './db/index.js';
import { worlds, settlements, colonies } from './db/schema/index.js';
import { eq } from 'drizzle-orm';
import { TickScheduler } from './engine/scheduler.js';
import { ensureSchema } from './db/migrate.js';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export function buildApp() {
  const app = Fastify({
    logger: {
      level: process.env.LOG_LEVEL || 'info',
    },
  });

  app.register(cors);
  app.register(healthRoutes);
  app.register(worldRoutes);
  app.register(stateRoutes);
  app.register(actionRoutes);
  app.register(eventRoutes);
  app.register(feedRoutes);

  // Serve static website from web/ directory
  // In dist/, the web/ folder is at ../web relative to compiled JS
  const webRoot = join(__dirname, '..', 'web');
  app.register(fastifyStatic, {
    root: webRoot,
    prefix: '/',
    decorateReply: false,
  });

  return app;
}

/** Active schedulers keyed by worldId */
const schedulers = new Map<string, TickScheduler>();

/** Start tick schedulers for all running worlds */
async function startSchedulers(logger: { info: (msg: string) => void; error: (msg: string) => void }) {
  const runningWorlds = await db
    .select()
    .from(worlds)
    .where(eq(worlds.status, 'running'));

  for (const world of runningWorlds) {
    if (schedulers.has(world.id)) continue;

    const scheduler = new TickScheduler({
      worldId: world.id,
      db: db as any,
      onTick: (tick, events) => {
        logger.info(`[${world.id}] Tick ${tick} resolved — ${events.length} events`);
      },
      onError: (err) => {
        logger.error(`[${world.id}] Tick error: ${err.message}`);
        // Log the full stack trace for DB column errors
        if (err.message.includes('column') || err.message.includes('relation') || err.message.includes('undefined')) {
          logger.error(`[${world.id}] Full error stack: ${err.stack}`);
          logger.error(`[${world.id}] HINT: This may be a missing DB column. Run ensureSchema() or check src/db/migrate.ts`);
        }
      },
    });

    try {
      await scheduler.start();
      schedulers.set(world.id, scheduler);
      logger.info(`Scheduler started for world ${world.id} (${world.name}) — tick rate ${world.tickRate}ms`);
    } catch (err) {
      logger.error(`Failed to start scheduler for world ${world.id}: ${err}`);
    }
  }
}

/**
 * One-time data normalization on startup.
 * Fixes known data issues from earlier code versions:
 * - Buildings with completedAtTick instead of level (#40)
 * - Colony resources with null values (#47)
 */
async function normalizeData(logger: { info: (msg: string) => void; error: (msg: string) => void }) {
  try {
    // Fix buildings: ensure every building has { type, level } format
    const allSettlements = await db.select().from(settlements);
    let fixedBuildings = 0;

    for (const s of allSettlements) {
      const buildings = (s.buildings ?? []) as Array<Record<string, unknown>>;
      let needsFix = false;

      const normalized = buildings.map((b) => {
        if (typeof b.level !== 'number' || b.level < 1) {
          needsFix = true;
          return { type: b.type, level: 1 };
        }
        // Strip any extra properties (e.g. completedAtTick)
        const keys = Object.keys(b);
        if (keys.length !== 2 || !keys.includes('type') || !keys.includes('level')) {
          needsFix = true;
          return { type: b.type, level: b.level };
        }
        return { type: b.type, level: b.level };
      });

      if (needsFix) {
        await db
          .update(settlements)
          .set({ buildings: normalized })
          .where(eq(settlements.id, s.id));
        fixedBuildings++;
      }
    }

    if (fixedBuildings > 0) {
      logger.info(`[normalize] Fixed buildings in ${fixedBuildings} settlement(s)`);
    }

    // Fix colony resources: replace null/NaN values with 0
    const allColonies = await db.select().from(colonies);
    let fixedResources = 0;

    for (const c of allColonies) {
      const resources = c.resources as Record<string, unknown>;
      let needsFix = false;

      for (const key of ['food', 'timber', 'stone', 'iron', 'influence']) {
        const val = resources[key];
        if (val == null || (typeof val === 'number' && Number.isNaN(val))) {
          resources[key] = 0;
          needsFix = true;
        }
      }

      if (needsFix) {
        await db
          .update(colonies)
          .set({ resources })
          .where(eq(colonies.id, c.id));
        fixedResources++;
      }
    }

    if (fixedResources > 0) {
      logger.info(`[normalize] Fixed resources in ${fixedResources} colony/colonies`);
    }

    if (fixedBuildings === 0 && fixedResources === 0) {
      logger.info('[normalize] No data fixes needed');
    }
  } catch (err) {
    logger.error(`[normalize] Data normalization failed: ${err}`);
    // Non-fatal — server can still start
  }
}

async function start() {
  const app = buildApp();

  const host = process.env.HOST || '0.0.0.0';
  const port = parseInt(process.env.PORT || '3000', 10);

  try {
    await app.listen({ host, port });
    const logger = app.log as any;
    logger.info(`RoboColony server running on ${host}:${port}`);

    // Run schema migration FIRST — ensures all columns exist before any queries
    await ensureSchema(db as any, logger);

    // Normalize data before starting schedulers
    await normalizeData(logger);

    // Start tick schedulers after server is listening
    await startSchedulers(logger);
    logger.info(`Tick schedulers initialized (${schedulers.size} world(s))`);
  } catch (err) {
    (app.log as any).error(err);
    process.exit(1);
  }
}

// Only start when run directly, not when imported by tests
const isMainModule = process.argv[1]?.endsWith('server.js') || process.argv[1]?.endsWith('server.ts');
if (isMainModule) {
  start();
}
