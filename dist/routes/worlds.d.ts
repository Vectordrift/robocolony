/**
 * World creation and colony join endpoints.
 *
 * POST /api/worlds       — Admin: create a new world (generates hex map)
 * POST /api/worlds/:id/join — Public: join a world (creates colony, returns API key)
 * GET  /api/worlds       — Public: list worlds
 * GET  /api/worlds/:id   — Public: world info
 */
import type { FastifyInstance } from 'fastify';
export declare function worldRoutes(app: FastifyInstance): Promise<void>;
//# sourceMappingURL=worlds.d.ts.map