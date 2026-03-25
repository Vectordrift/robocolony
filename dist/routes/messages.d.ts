/**
 * Colony-to-colony messaging endpoints.
 *
 * GET  /api/worlds/:id/messages       — inbox for authenticated colony (with pagination)
 * POST /api/worlds/:id/messages/:msgId/read — mark a message as read
 */
import type { FastifyInstance } from 'fastify';
export declare function messageRoutes(app: FastifyInstance): Promise<void>;
//# sourceMappingURL=messages.d.ts.map