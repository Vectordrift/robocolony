/**
 * World and colony endpoints.
 *
 * POST /api/worlds/:id/join — Public: join a world (creates colony, returns API key)
 * GET  /api/worlds           — Public: list worlds
 * GET  /api/worlds/:id       — Public: world info
 *
 * World creation is not exposed via API — create worlds via DB/CLI.
 */
import type { FastifyInstance } from 'fastify';
export declare function worldRoutes(app: FastifyInstance): Promise<void>;
//# sourceMappingURL=worlds.d.ts.map