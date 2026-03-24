import { describe, it, expect } from 'vitest';
import {
  findPath,
  pathCost,
  createTerrainLookup,
  isPassable,
  TERRAIN_MOVEMENT_COST,
} from '../pathfinding.js';
import type { TerrainType, HexTile } from '../mapgen.js';
import type { HexCoord } from '../hex.js';

// --- Test helpers ---

/** Create a small test map centered at origin */
function createTestMap(radius: number, terrain: TerrainType = 'plains'): Array<{ q: number; r: number; terrain: TerrainType }> {
  const hexes: Array<{ q: number; r: number; terrain: TerrainType }> = [];
  for (let q = -radius; q <= radius; q++) {
    const r1 = Math.max(-radius, -q - radius);
    const r2 = Math.min(radius, -q + radius);
    for (let r = r1; r <= r2; r++) {
      hexes.push({ q, r, terrain });
    }
  }
  return hexes;
}

/** Create a test map with a mountain wall */
function createMapWithWall(): Array<{ q: number; r: number; terrain: TerrainType }> {
  const hexes = createTestMap(5);
  // Create a mountain wall at q=2 (blocking east passage)
  for (const hex of hexes) {
    if (hex.q === 2 && hex.r >= -3 && hex.r <= 3) {
      hex.terrain = 'mountains';
    }
  }
  return hexes;
}

describe('TERRAIN_MOVEMENT_COST', () => {
  it('plains cost 1', () => {
    expect(TERRAIN_MOVEMENT_COST.plains).toBe(1);
  });

  it('forest costs 2', () => {
    expect(TERRAIN_MOVEMENT_COST.forest).toBe(2);
  });

  it('mountains are impassable', () => {
    expect(TERRAIN_MOVEMENT_COST.mountains).toBe(Infinity);
  });

  it('ocean is impassable', () => {
    expect(TERRAIN_MOVEMENT_COST.ocean).toBe(Infinity);
  });

  it('all terrain types have a cost', () => {
    const types: TerrainType[] = ['ocean', 'coast', 'plains', 'forest', 'mountains', 'desert', 'tundra'];
    for (const t of types) {
      expect(TERRAIN_MOVEMENT_COST[t]).toBeDefined();
    }
  });
});

describe('isPassable', () => {
  it('plains are passable', () => expect(isPassable('plains')).toBe(true));
  it('forest is passable', () => expect(isPassable('forest')).toBe(true));
  it('coast is passable', () => expect(isPassable('coast')).toBe(true));
  it('desert is passable', () => expect(isPassable('desert')).toBe(true));
  it('tundra is passable', () => expect(isPassable('tundra')).toBe(true));
  it('mountains are impassable', () => expect(isPassable('mountains')).toBe(false));
  it('ocean is impassable', () => expect(isPassable('ocean')).toBe(false));
});

describe('findPath', () => {
  it('returns trivial path for same start and goal', () => {
    const lookup = createTerrainLookup(createTestMap(3));
    const result = findPath({ q: 0, r: 0 }, { q: 0, r: 0 }, lookup);
    expect(result).not.toBeNull();
    expect(result!.path).toHaveLength(1);
    expect(result!.cost).toBe(0);
  });

  it('finds direct path between adjacent hexes', () => {
    const lookup = createTerrainLookup(createTestMap(3));
    const result = findPath({ q: 0, r: 0 }, { q: 1, r: 0 }, lookup);
    expect(result).not.toBeNull();
    expect(result!.path).toHaveLength(2);
    expect(result!.cost).toBe(1); // plains = 1
  });

  it('finds path across multiple hexes', () => {
    const lookup = createTerrainLookup(createTestMap(5));
    const result = findPath({ q: -3, r: 0 }, { q: 3, r: 0 }, lookup);
    expect(result).not.toBeNull();
    expect(result!.path.length).toBeGreaterThan(1);
    expect(result!.path[0]).toEqual({ q: -3, r: 0 });
    expect(result!.path[result!.path.length - 1]).toEqual({ q: 3, r: 0 });
    // Direct distance is 6, cost should be 6 on all-plains
    expect(result!.cost).toBe(6);
  });

  it('routes around impassable terrain', () => {
    const hexes = createMapWithWall();
    const lookup = createTerrainLookup(hexes);
    const result = findPath({ q: 0, r: 0 }, { q: 4, r: 0 }, lookup);
    expect(result).not.toBeNull();
    // Path should not pass through q=2 (mountains)
    for (const hex of result!.path) {
      if (hex.q === 2) {
        const terrain = hexes.find(h => h.q === hex.q && h.r === hex.r)?.terrain;
        expect(terrain).not.toBe('mountains');
      }
    }
    // Cost should be more than direct (4) since detour needed
    expect(result!.cost).toBeGreaterThan(4);
  });

  it('returns null when goal is impassable', () => {
    const hexes = createTestMap(3);
    hexes.find(h => h.q === 2 && h.r === 0)!.terrain = 'mountains';
    const lookup = createTerrainLookup(hexes);
    const result = findPath({ q: 0, r: 0 }, { q: 2, r: 0 }, lookup);
    expect(result).toBeNull();
  });

  it('returns null when goal is off-map', () => {
    const lookup = createTerrainLookup(createTestMap(3));
    const result = findPath({ q: 0, r: 0 }, { q: 10, r: 0 }, lookup);
    expect(result).toBeNull();
  });

  it('returns null when completely blocked', () => {
    // Create a map where origin is surrounded by mountains
    const hexes = createTestMap(3);
    const neighbors = [
      { q: 1, r: 0 }, { q: 1, r: -1 }, { q: 0, r: -1 },
      { q: -1, r: 0 }, { q: -1, r: 1 }, { q: 0, r: 1 },
    ];
    for (const n of neighbors) {
      const hex = hexes.find(h => h.q === n.q && h.r === n.r);
      if (hex) hex.terrain = 'mountains';
    }
    const lookup = createTerrainLookup(hexes);
    const result = findPath({ q: 0, r: 0 }, { q: 3, r: 0 }, lookup);
    expect(result).toBeNull();
  });

  it('prefers cheaper terrain', () => {
    // Create map with forest corridor and plains corridor
    const hexes = createTestMap(5);
    // Make upper path forest (cost 2 each)
    hexes.find(h => h.q === 1 && h.r === -1)!.terrain = 'forest';
    hexes.find(h => h.q === 2 && h.r === -1)!.terrain = 'forest';
    // Lower path stays plains (cost 1 each) — A* should prefer it

    const lookup = createTerrainLookup(hexes);
    const result = findPath({ q: 0, r: 0 }, { q: 3, r: 0 }, lookup);
    expect(result).not.toBeNull();
    // On all-plains direct path, cost should be 3
    expect(result!.cost).toBe(3);
  });

  it('handles start hex off-map', () => {
    const lookup = createTerrainLookup(createTestMap(3));
    const result = findPath({ q: 99, r: 0 }, { q: 0, r: 0 }, lookup);
    expect(result).toBeNull();
  });

  it('path is continuous (each step is a neighbor)', () => {
    const lookup = createTerrainLookup(createTestMap(5));
    const result = findPath({ q: -4, r: 1 }, { q: 3, r: -2 }, lookup);
    expect(result).not.toBeNull();
    for (let i = 1; i < result!.path.length; i++) {
      const prev = result!.path[i - 1];
      const curr = result!.path[i];
      const dq = curr.q - prev.q;
      const dr = curr.r - prev.r;
      const ds = -(dq + dr);
      // Adjacent hexes have distance 1 in cube coords
      const dist = Math.max(Math.abs(dq), Math.abs(dr), Math.abs(ds));
      expect(dist).toBe(1);
    }
  });
});

describe('pathCost', () => {
  it('returns 0 for single-hex path', () => {
    const lookup = createTerrainLookup(createTestMap(3));
    expect(pathCost([{ q: 0, r: 0 }], lookup)).toBe(0);
  });

  it('sums terrain costs along path', () => {
    const hexes = createTestMap(3);
    hexes.find(h => h.q === 1 && h.r === 0)!.terrain = 'forest'; // cost 2
    hexes.find(h => h.q === 2 && h.r === 0)!.terrain = 'desert'; // cost 2
    const lookup = createTerrainLookup(hexes);
    const path = [{ q: 0, r: 0 }, { q: 1, r: 0 }, { q: 2, r: 0 }];
    expect(pathCost(path, lookup)).toBe(4); // 2 + 2
  });

  it('returns Infinity if path crosses impassable terrain', () => {
    const hexes = createTestMap(3);
    hexes.find(h => h.q === 1 && h.r === 0)!.terrain = 'mountains';
    const lookup = createTerrainLookup(hexes);
    const path = [{ q: 0, r: 0 }, { q: 1, r: 0 }, { q: 2, r: 0 }];
    expect(pathCost(path, lookup)).toBe(Infinity);
  });
});

describe('createTerrainLookup', () => {
  it('returns terrain for known hexes', () => {
    const lookup = createTerrainLookup([
      { q: 0, r: 0, terrain: 'plains' },
      { q: 1, r: 0, terrain: 'forest' },
    ]);
    expect(lookup(0, 0)).toBe('plains');
    expect(lookup(1, 0)).toBe('forest');
  });

  it('returns undefined for unknown hexes', () => {
    const lookup = createTerrainLookup([{ q: 0, r: 0, terrain: 'plains' }]);
    expect(lookup(99, 99)).toBeUndefined();
  });
});

describe('performance', () => {
  it('finds cross-map path on radius-50 map in <50ms', () => {
    // Generate a large all-plains map
    const hexes: Array<{ q: number; r: number; terrain: TerrainType }> = [];
    const radius = 50;
    for (let q = -radius; q <= radius; q++) {
      const r1 = Math.max(-radius, -q - radius);
      const r2 = Math.min(radius, -q + radius);
      for (let r = r1; r <= r2; r++) {
        hexes.push({ q, r, terrain: 'plains' });
      }
    }
    const lookup = createTerrainLookup(hexes);

    const start = performance.now();
    const result = findPath({ q: -40, r: 0 }, { q: 40, r: 0 }, lookup);
    const elapsed = performance.now() - start;

    expect(result).not.toBeNull();
    expect(elapsed).toBeLessThan(50);
  });
});
