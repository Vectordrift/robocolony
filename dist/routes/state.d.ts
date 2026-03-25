/**
 * State query endpoints — authenticated colony state access.
 *
 * GET /api/worlds/:id/state — full colony state (resources, settlements, units, visible map)
 * GET /api/worlds/:id/map   — visible hexes only (fog of war applied)
 */
import type { FastifyInstance } from 'fastify';
export interface VisibleHex {
    x: number;
    y: number;
    terrain: string;
    resources: Record<string, number>;
    settlementId: string | null;
}
/**
 * Get all hexes visible to a colony (fog of war applied).
 * A hex is visible if the colony ID is in its explored_by array.
 * Alliance shared vision: if the colony has active alliance agreements,
 * hexes explored by allied colonies are also visible.
 */
export declare function getVisibleHexes(worldId: string, colonyId: string): Promise<VisibleHex[]>;
export declare function stateRoutes(app: FastifyInstance): Promise<void>;
//# sourceMappingURL=state.d.ts.map