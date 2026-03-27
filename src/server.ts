import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import cors from '@fastify/cors';
import { healthRoutes } from './routes/health.js';
import { worldRoutes } from './routes/worlds.js';
import { stateRoutes } from './routes/state.js';
import { actionRoutes } from './routes/actions.js';
import { eventRoutes } from './routes/events.js';
import { feedRoutes } from './routes/feed.js';
import { messageRoutes } from './routes/messages.js';
import { diplomacyRoutes } from './routes/diplomacy.js';
import { db } from './db/index.js';
import { worlds, settlements, colonies } from './db/schema/index.js';
import { eq, or } from 'drizzle-orm';
import { TickScheduler } from './engine/scheduler.js';
import { ensureSchema } from './db/migrate.js';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import {
  rateLimitStore, joinRateLimitStore,
  RATE_LIMIT_MAX, RATE_LIMIT_WINDOW_MS,
  RATE_LIMIT_JOIN_MAX, RATE_LIMIT_JOIN_WINDOW_MS,
  checkRateLimit, startRateLimitCleanup,
} from './lib/ratelimit.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/** Allowed CORS origins */
const ALLOWED_ORIGINS = [
  'https://robocolony.vectordrift.ai',
  'https://robocolony.fly.dev',
  'http://localhost:3000',
  'http://localhost:8080',
];

export function buildApp() {
  const app = Fastify({
    logger: {
      level: process.env.LOG_LEVEL || 'info',
    },
    bodyLimit: 256 * 1024, // 256KB max request body
  });

  app.register(cors, {
    origin: (origin, cb) => {
      // Allow requests with no origin (curl, server-to-server, mobile apps)
      if (!origin) return cb(null, true);
      if (ALLOWED_ORIGINS.includes(origin)) return cb(null, true);
      cb(new Error('CORS: origin not allowed'), false);
    },
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: false,
  });

  // Start periodic cleanup of stale rate limit entries
  startRateLimitCleanup();

  // Global rate limiting
  app.addHook('onRequest', async (request, reply) => {
    const ip = request.ip || request.headers['x-forwarded-for'] || 'unknown';
    const ipKey = Array.isArray(ip) ? ip[0] : ip;

    // Stricter limit for join endpoint
    if (request.url.endsWith('/join') && request.method === 'POST') {
      const result = checkRateLimit(joinRateLimitStore, ipKey, RATE_LIMIT_JOIN_MAX, RATE_LIMIT_JOIN_WINDOW_MS);
      reply.header('X-RateLimit-Limit', RATE_LIMIT_JOIN_MAX);
      reply.header('X-RateLimit-Remaining', result.remaining);
      if (!result.allowed) {
        return reply.code(429).send({
          error: 'rate_limit',
          message: `Too many join requests. Try again in 1 hour.`,
        });
      }
    }

    // Global rate limit (skip health checks)
    if (request.url !== '/health') {
      const result = checkRateLimit(rateLimitStore, ipKey, RATE_LIMIT_MAX, RATE_LIMIT_WINDOW_MS);
      reply.header('X-RateLimit-Limit', RATE_LIMIT_MAX);
      reply.header('X-RateLimit-Remaining', result.remaining);
      if (!result.allowed) {
        return reply.code(429).send({
          error: 'rate_limit',
          message: `Too many requests. Max ${RATE_LIMIT_MAX} per minute.`,
        });
      }
    }
  });

  // Debug endpoint — shows scheduler state and recent logs
  app.get('/debug/scheduler', async () => {
    return {
      schedulerCount: schedulers.size,
      schedulerWorldIds: [...schedulers.keys()],
      debugLog: debugLog.slice(-100),
      uptime: process.uptime(),
      memoryMB: Math.round(process.memoryUsage().rss / 1024 / 1024),
    };
  });

  app.register(healthRoutes);
  app.register(worldRoutes);
  app.register(stateRoutes);
  app.register(actionRoutes);
  app.register(eventRoutes);
  app.register(feedRoutes);
  app.register(messageRoutes);
  app.register(diplomacyRoutes);

  // Serve static website from web/ directory
  const webRoot = join(__dirname, '..', 'web');
  app.register(fastifyStatic, {
    root: webRoot,
    prefix: '/',
    decorateReply: false,
  });

  // Redirect /docs and /api/docs to /docs.html (#132)
  app.get('/docs', async (_request, reply) => {
    return reply.redirect('/docs.html');
  });
  app.get('/api/docs', async (_request, reply) => {
    return reply.redirect('/docs.html');
  });

  return app;
}

/** Active schedulers keyed by worldId */
const schedulers = new Map<string, TickScheduler>();

/** Debug log buffer — captures scheduler debug output */
const debugLog: string[] = [];
const originalConsoleLog = console.log;
const originalConsoleError = console.error;
console.log = (...args: unknown[]) => {
  const msg = args.map(a => typeof a === 'string' ? a : JSON.stringify(a)).join(' ');
  if (msg.includes('[SCHEDULER]') || msg.includes('[TICK]')) {
    debugLog.push(`${new Date().toISOString()} ${msg}`);
    if (debugLog.length > 200) debugLog.shift();
  }
  originalConsoleLog(...args);
};
console.error = (...args: unknown[]) => {
  const msg = args.map(a => {
    if (a instanceof Error) return `${a.message}\n${a.stack}`;
    return typeof a === 'string' ? a : JSON.stringify(a);
  }).join(' ');
  debugLog.push(`${new Date().toISOString()} ERROR: ${msg}`);
  if (debugLog.length > 200) debugLog.shift();
  originalConsoleError(...args);
};

/** Start tick schedulers for all active worlds (status: running or open) */
async function startSchedulers(logger: { info: (msg: string) => void; error: (msg: string) => void }) {
  const runningWorlds = await db
    .select()
    .from(worlds)
    .where(or(eq(worlds.status, 'running'), eq(worlds.status, 'open')));

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
        logger.error(`[${world.id}] Full error stack: ${err.stack}`);
        if (err.message.includes('column') || err.message.includes('relation') || err.message.includes('undefined')) {
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
 */
async function normalizeData(logger: { info: (msg: string) => void; error: (msg: string) => void }) {
  try {
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

    await ensureSchema(db as any, logger);
    await normalizeData(logger);
    await startSchedulers(logger);
    logger.info(`Tick schedulers initialized (${schedulers.size} world(s))`);
  } catch (err) {
    (app.log as any).error(err);
    process.exit(1);
  }
}

const isMainModule = process.argv[1]?.endsWith('server.js') || process.argv[1]?.endsWith('server.ts');
if (isMainModule) {
  start();
}
