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
 * Authenticate a request by verifying the API key against stored hashes.
 * Attaches the colony to the request object on success.
 */
declare function authenticateRequest(request: FastifyRequest, reply: FastifyReply): Promise<void>;
/**
 * Register the auth middleware as a Fastify plugin.
 * Adds an `authenticate` decorator that can be used as a preHandler.
 */
export declare function authPlugin(app: FastifyInstance): Promise<void>;
/**
 * Standalone auth preHandler for use in route definitions.
 */
export declare const requireAuth: typeof authenticateRequest;
export {};
//# sourceMappingURL=auth.d.ts.map