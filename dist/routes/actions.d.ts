/**
 * Action submission endpoints.
 *
 * POST /api/worlds/:id/actions — submit actions for next tick
 * GET  /api/worlds/:id/actions — list queued and recent resolved actions
 */
import type { FastifyInstance } from 'fastify';
export declare function actionRoutes(app: FastifyInstance): Promise<void>;
//# sourceMappingURL=actions.d.ts.map