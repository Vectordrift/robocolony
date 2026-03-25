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
import { agreementRoutes } from './routes/agreements.js';
import { db } from './db/index.js';
import { worlds, settlements, colonies } from './db/schema/index.js';
import { eq } from 'drizzle-orm';
import { TickScheduler } from './engine/scheduler.js';
import { ensureSchema } from './db/migrate.js';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
// --- In-memory rate limiter ---
const rateLimitStore = new Map();
const RATE_LIMIT_WINDOW_MS = 60_000; // 1 minute
const RATE_LIMIT_MAX = 60; // 60 requests per minute per IP
const RATE_LIMIT_JOIN_MAX = 3; // 3 joins per minute per IP
const joinRateLimitStore = new Map();
function checkRateLimit(store, key, max) {
    const now = Date.now();
    let entry = store.get(key);
    if (!entry || now >= entry.resetAt) {
        entry = { count: 0, resetAt: now + RATE_LIMIT_WINDOW_MS };
    }
    entry.count++;
    store.set(key, entry);
    return {
        allowed: entry.count <= max,
        remaining: Math.max(0, max - entry.count),
        resetAt: entry.resetAt,
    };
}
// Clean up stale entries every 5 minutes
setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of rateLimitStore) {
        if (now >= entry.resetAt)
            rateLimitStore.delete(key);
    }
    for (const [key, entry] of joinRateLimitStore) {
        if (now >= entry.resetAt)
            joinRateLimitStore.delete(key);
    }
}, 300_000);
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
export function buildApp() {
    const app = Fastify({
        logger: {
            level: process.env.LOG_LEVEL || 'info',
        },
    });
    app.register(cors);
    // Global rate limiting
    app.addHook('onRequest', async (request, reply) => {
        const ip = request.ip || request.headers['x-forwarded-for'] || 'unknown';
        const ipKey = Array.isArray(ip) ? ip[0] : ip;
        // Stricter limit for join endpoint
        if (request.url.endsWith('/join') && request.method === 'POST') {
            const result = checkRateLimit(joinRateLimitStore, ipKey, RATE_LIMIT_JOIN_MAX);
            reply.header('X-RateLimit-Limit', RATE_LIMIT_JOIN_MAX);
            reply.header('X-RateLimit-Remaining', result.remaining);
            if (!result.allowed) {
                return reply.code(429).send({
                    error: 'rate_limit',
                    message: `Too many join requests. Max ${RATE_LIMIT_JOIN_MAX} per minute.`,
                });
            }
        }
        // Global rate limit (skip health checks)
        if (request.url !== '/health') {
            const result = checkRateLimit(rateLimitStore, ipKey, RATE_LIMIT_MAX);
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
    app.register(healthRoutes);
    app.register(worldRoutes);
    app.register(stateRoutes);
    app.register(actionRoutes);
    app.register(eventRoutes);
    app.register(feedRoutes);
    app.register(messageRoutes);
    app.register(agreementRoutes);
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
const schedulers = new Map();
/** Start tick schedulers for all running worlds */
async function startSchedulers(logger) {
    const runningWorlds = await db
        .select()
        .from(worlds)
        .where(eq(worlds.status, 'running'));
    for (const world of runningWorlds) {
        if (schedulers.has(world.id))
            continue;
        const scheduler = new TickScheduler({
            worldId: world.id,
            db: db,
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
        }
        catch (err) {
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
async function normalizeData(logger) {
    try {
        // Fix buildings: ensure every building has { type, level } format
        const allSettlements = await db.select().from(settlements);
        let fixedBuildings = 0;
        for (const s of allSettlements) {
            const buildings = (s.buildings ?? []);
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
            const resources = c.resources;
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
    }
    catch (err) {
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
        const logger = app.log;
        logger.info(`RoboColony server running on ${host}:${port}`);
        // Run schema migration FIRST — ensures all columns exist before any queries
        await ensureSchema(db, logger);
        // Normalize data before starting schedulers
        await normalizeData(logger);
        // Start tick schedulers after server is listening
        await startSchedulers(logger);
        logger.info(`Tick schedulers initialized (${schedulers.size} world(s))`);
    }
    catch (err) {
        app.log.error(err);
        process.exit(1);
    }
}
// Only start when run directly, not when imported by tests
const isMainModule = process.argv[1]?.endsWith('server.js') || process.argv[1]?.endsWith('server.ts');
if (isMainModule) {
    start();
}
//# sourceMappingURL=server.js.map