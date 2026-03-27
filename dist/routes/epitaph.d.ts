/**
 * Historical elimination feedback endpoint.
 *
 * GET /api/worlds/:id/epitaph — returns post-death summary for an authenticated colony,
 * including eliminated/dead colonies whose API keys would normally be blocked elsewhere.
 */
import type { FastifyInstance } from 'fastify';
export declare function epitaphRoutes(app: FastifyInstance): Promise<void>;
//# sourceMappingURL=epitaph.d.ts.map