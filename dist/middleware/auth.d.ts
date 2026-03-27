import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
export interface AuthenticatedColony {
    id: string;
    worldId: string;
    name: string;
    status: string;
}
declare module 'fastify' {
    interface FastifyRequest {
        colony?: AuthenticatedColony;
    }
}
/**
 * Register the auth middleware as a Fastify plugin.
 * Adds an `authenticate` decorator that can be used as a preHandler.
 */
export declare function authPlugin(app: FastifyInstance): Promise<void>;
/**
 * Standalone auth preHandler for use in route definitions.
 */
export declare const requireAuth: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
/**
 * Auth preHandler variant for historical read-only routes.
 * Accepts eliminated/dead colonies so they can access epitaph-style feedback.
 */
export declare const requireAuthAllowInactive: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
//# sourceMappingURL=auth.d.ts.map