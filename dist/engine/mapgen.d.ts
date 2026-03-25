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
 * Find suitable colony starting positions.
 * Positions are on a ring at ~70% of radius (radius ~35 for radius 50),
 * spaced at least minSpacing hexes apart, on land terrain with
 * adjacent food + timber.
 */
export declare function findStartingPositions(hexes: HexTile[], radius: number, seed: number, maxColonies?: number, minSpacing?: number): HexCoord[];
/**
 * Generate the complete world map.
 * Deterministic: same seed + radius always produces the same map.
 */
export declare function generateWorld(seed: number, radius?: number, maxColonies?: number): WorldMap;
/**
 * Get terrain distribution stats for a generated map.
 * Useful for testing and validation.
 */
export declare function getTerrainStats(hexes: HexTile[]): Record<TerrainType, number>;
//# sourceMappingURL=mapgen.d.ts.map