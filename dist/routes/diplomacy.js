/**
 * Diplomacy endpoints — view agreements for a colony.
 *
 * GET /api/worlds/:id/agreements — list agreements (proposed, active, broken) involving your colony
 */
import { eq, and, or } from 'drizzle-orm';
import { db } from '../db/index.js';
import { agreements, colonies } from '../db/schema/index.js';
import { requireAuth } from '../middleware/index.js';
export async function diplomacyRoutes(app) {
    // List agreements involving this colony
    app.get('/api/worlds/:id/agreements', {
        preHandler: requireAuth,
    }, async (request, reply) => {
        const colony = request.colony;
        const worldId = colony.worldId;
        const rows = await db
            .select()
            .from(agreements)
            .where(and(eq(agreements.worldId, worldId), or(eq(agreements.proposedBy, colony.id), eq(agreements.proposedTo, colony.id))));
        // Gather all partner colony IDs for name lookup
        const partnerIds = new Set();
        for (const row of rows) {
            partnerIds.add(row.proposedBy);
            partnerIds.add(row.proposedTo);
        }
        partnerIds.delete(colony.id);
        const colonyNames = {};
        if (partnerIds.size > 0) {
            const colRows = await db
                .select({ id: colonies.id, name: colonies.name })
                .from(colonies)
                .where(eq(colonies.worldId, worldId));
            for (const c of colRows) {
                if (partnerIds.has(c.id)) {
                    colonyNames[c.id] = c.name;
                }
            }
        }
        return {
            colonyId: colony.id,
            agreements: rows.map(a => {
                const partnerId = a.proposedBy === colony.id ? a.proposedTo : a.proposedBy;
                return {
                    id: a.id,
                    type: a.type,
                    status: a.status,
                    partnerColonyId: partnerId,
                    partnerName: colonyNames[partnerId] ?? 'Unknown',
                    proposedBy: a.proposedBy,
                    proposedTo: a.proposedTo,
                    terms: a.terms,
                    proposedAtTick: a.proposedAtTick,
                    acceptedAtTick: a.acceptedAtTick,
                    direction: a.proposedBy === colony.id ? 'outgoing' : 'incoming',
                };
            }),
        };
    });
}
//# sourceMappingURL=diplomacy.js.map