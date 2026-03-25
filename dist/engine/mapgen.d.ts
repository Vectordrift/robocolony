/**
 * Hex map generation for RoboColony worlds.
 *
 * Generates a finite hex map with seeded terrain, resources, and colony starting positions.
 * All hexes are pre-generated at world creation for deterministic, reproducible worlds.
 */
import { type HexCoord } from './hex.js';
export type TerrainType = 'ocean' | 'coast' | 'plains' | 'forest' | 'mountains' | 'desert' | 'tundra';
export interface HexTile {
    q: number;
    r: number;
    terrain: TerrainType;
    resources: HexResources;
}
export interface HexResources {
    food: number;
    timber: number;
    stone: number;
    iron: number;
}
export interface WorldMap {
    seed: number;
    radius: number;
    hexes: HexTile[];
    startingPositions: HexCoord[];
}
/**
 * Recommend a map radius based on colony count.
 * Smaller worlds = faster contact = more strategic tension.
 */
export declare function recommendedRadius(maxColonies: number): number;
/**
 * Calculate minimum spawn spacing based on colony count and radius.
 * For small worlds, colonies start closer to force early contact.
 */
export declare function recommendedMinSpacing(maxColonies: number, radius: number): number;
/**
 * Find suitable colony starting positions.
 * Positions are on a spawn ring that scales with radius and colony count.
 * Smaller worlds use a tighter ring (35-50% of radius) for faster contact.
 * Larger worlds use a wider ring (55-70% of radius) for more breathing room.
 */
export declare function findStartingPositions(hexes: HexTile[], radius: number, seed: number, maxColonies?: number, minSpacing?: number): HexCoord[];
/**
 * Generate the complete world map.
 * Deterministic: same seed + radius always produces the same map.
 * If radius is not specified, it scales based on maxColonies.
 */
export declare function generateWorld(seed: number, radius?: number, maxColonies?: number): WorldMap;
/**
 * Get terrain distribution stats for a generated map.
 * Useful for testing and validation.
 */
export declare function getTerrainStats(hexes: HexTile[]): Record<TerrainType, number>;
//# sourceMappingURL=mapgen.d.ts.map
