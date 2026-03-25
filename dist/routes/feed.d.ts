/**
 * Public feed endpoint — world activity visible to spectators.
 *
 * GET /api/worlds/:id/feed — public events + colony summary (no auth required)
 *   Query params:
 *     since_tick — only events after this tick (exclusive)
 *     limit      — max events to return (default 50, max 200)
 */
import type { FastifyInstance } from 'fastify';
export declare function feedRoutes(app: FastifyInstance): Promise<void>;
//# sourceMappingURL=feed.d.ts.map