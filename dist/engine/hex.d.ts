/**
 * Hex coordinate utilities using axial coordinates (q, r).
 * https://www.redblobgames.com/grids/hexagons/
 */
export interface HexCoord {
    q: number;
    r: number;
}
/**
 * Compute the cube distance between two hex coordinates.
 * In axial coordinates, s = -q - r.
 */
export declare function hexDistance(a: HexCoord, b: HexCoord): number;
/**
 * Get the distance from the origin (0, 0).
 */
export declare function hexDistanceFromOrigin(coord: HexCoord): number;
/**
 * Get all hex coordinates within a given radius from the origin.
 * Returns ~3r² + 3r + 1 hexes for radius r.
 */
export declare function hexesInRadius(radius: number): HexCoord[];
/**
 * Get the 6 neighboring hex coordinates.
 */
export declare function hexNeighbors(coord: HexCoord): HexCoord[];
/**
 * Get hex coordinates on a ring at exactly the given distance from center.
 */
export declare function hexRing(center: HexCoord, radius: number): HexCoord[];
//# sourceMappingURL=hex.d.ts.map