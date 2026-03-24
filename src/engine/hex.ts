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
export function hexDistance(a: HexCoord, b: HexCoord): number {
  const dq = a.q - b.q;
  const dr = a.r - b.r;
  const ds = (-a.q - a.r) - (-b.q - b.r); // ds = dq + dr negated
  return Math.max(Math.abs(dq), Math.abs(dr), Math.abs(ds));
}

/**
 * Get the distance from the origin (0, 0).
 */
export function hexDistanceFromOrigin(coord: HexCoord): number {
  return hexDistance(coord, { q: 0, r: 0 });
}

/**
 * Get all hex coordinates within a given radius from the origin.
 * Returns ~3r² + 3r + 1 hexes for radius r.
 */
export function hexesInRadius(radius: number): HexCoord[] {
  const hexes: HexCoord[] = [];
  for (let q = -radius; q <= radius; q++) {
    const r1 = Math.max(-radius, -q - radius);
    const r2 = Math.min(radius, -q + radius);
    for (let r = r1; r <= r2; r++) {
      hexes.push({ q, r });
    }
  }
  return hexes;
}

/**
 * Get the 6 neighboring hex coordinates.
 */
export function hexNeighbors(coord: HexCoord): HexCoord[] {
  const directions = [
    { q: 1, r: 0 },
    { q: 1, r: -1 },
    { q: 0, r: -1 },
    { q: -1, r: 0 },
    { q: -1, r: 1 },
    { q: 0, r: 1 },
  ];
  return directions.map((d) => ({ q: coord.q + d.q, r: coord.r + d.r }));
}

/**
 * Get hex coordinates on a ring at exactly the given distance from center.
 */
export function hexRing(center: HexCoord, radius: number): HexCoord[] {
  if (radius === 0) return [center];

  const results: HexCoord[] = [];
  // Start at one corner and walk each edge
  let hex: HexCoord = { q: center.q - radius, r: center.r + radius };

  const directions = [
    { q: 1, r: 0 },
    { q: 1, r: -1 },
    { q: 0, r: -1 },
    { q: -1, r: 0 },
    { q: -1, r: 1 },
    { q: 0, r: 1 },
  ];

  for (const dir of directions) {
    for (let i = 0; i < radius; i++) {
      results.push({ ...hex });
      hex = { q: hex.q + dir.q, r: hex.r + dir.r };
    }
  }
  return results;
}
