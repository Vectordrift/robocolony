import { db } from '../db/index.js';
import { colonies } from '../db/schema/index.js';
import { isValidKeyFormat, verifyApiKey } from '../lib/auth.js';
/**
 * Extract Bearer token from Authorization header.
 */
function extractBearerToken(request) {
    const authHeader = request.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return null;
    }
    return authHeader.slice(7);
}
/**
 * Authenticate a request by verifying the API key against stored hashes.
 * Attaches the colony to the request object on success.
 */
async function authenticateRequest(request, reply) {
    const apiKey = extractBearerToken(request);
    if (!apiKey) {
        reply.code(401).send({
            error: 'Unauthorized',
            message: 'Missing or invalid Authorization header. Use: Bearer <api_key>',
        });
        return;
    }
    if (!isValidKeyFormat(apiKey)) {
        reply.code(401).send({
            error: 'Unauthorized',
            message: 'Invalid API key format',
        });
        return;
    }
    // Fetch all active colonies and verify against their hashes
    // Note: with max 8 colonies per world, this is efficient enough.
    // For scale, we'd add a key_prefix column for indexed lookup.
    const allColonies = await db
        .select({
        id: colonies.id,
        worldId: colonies.worldId,
        name: colonies.name,
        apiKeyHash: colonies.apiKeyHash,
        status: colonies.status,
    })
        .from(colonies);
    for (const colony of allColonies) {
        const isValid = await verifyApiKey(apiKey, colony.apiKeyHash);
        if (isValid) {
            if (colony.status === 'eliminated') {
                reply.code(403).send({
                    error: 'Forbidden',
                    message: 'This colony has been eliminated',
                });
                return;
            }
            request.colony = {
                id: colony.id,
                worldId: colony.worldId,
                name: colony.name,
                status: colony.status,
            };
            return;
        }
    }
    reply.code(401).send({
        error: 'Unauthorized',
        message: 'Invalid API key',
    });
}
/**
 * Register the auth middleware as a Fastify plugin.
 * Adds an `authenticate` decorator that can be used as a preHandler.
 */
export async function authPlugin(app) {
    app.decorate('authenticate', authenticateRequest);
}
/**
 * Standalone auth preHandler for use in route definitions.
 */
export const requireAuth = authenticateRequest;
//# sourceMappingURL=auth.js.map