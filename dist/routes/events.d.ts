/**
 * Event feed endpoint — private event history for colonies.
 *
 * GET /api/worlds/:id/events — returns events visible to the authenticated colony
 *   Query params:
 *     since_tick — only events after this tick (exclusive)
 *     limit      — max events to return (default 50, max 200)
 */
import type { FastifyInstance } from 'fastify';
export declare function eventRoutes(app: FastifyInstance): Promise<void>;
//# sourceMappingURL=events.d.ts.map