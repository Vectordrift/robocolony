import Fastify from 'fastify';
import cors from '@fastify/cors';
import { healthRoutes } from './routes/health.js';
import { worldRoutes } from './routes/worlds.js';
import { stateRoutes } from './routes/state.js';
import { actionRoutes } from './routes/actions.js';
import { eventRoutes } from './routes/events.js';
import { db } from './db/index.js';
import { worlds } from './db/schema/index.js';
import { eq } from 'drizzle-orm';
import { TickScheduler } from './engine/scheduler.js';

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

async function start() {
  const app = buildApp();

  const host = process.env.HOST || '0.0.0.0';
  const port = parseInt(process.env.PORT || '3000', 10);

  try {
    await app.listen({ host, port });
    app.log.info(`RoboColony server running on ${host}:${port}`);

    // Start tick schedulers after server is listening
    await startSchedulers(app.log);
    app.log.info(`Tick schedulers initialized (${schedulers.size} world(s))`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

// Only start when run directly, not when imported by tests
const isMainModule = process.argv[1]?.endsWith('server.js') || process.argv[1]?.endsWith('server.ts');
if (isMainModule) {
  start();
}
