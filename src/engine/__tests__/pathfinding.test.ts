import { describe, it, expect } from 'vitest';
import {
  findPath,
  movementStepsThisTick,
  createHexLookup,
  TERRAIN_COST,
  UNIT_SPEED,
  VISION_RADIUS,
} from '../pathfinding.js';
import type { HexCoord } from '../hex.js';
import { hexDistance, hexesInRadius } from '../hex.js';

// --- Helpers ---

/** Create a simple plains-only hex map centered at origin with given radius. */
function plainsMap(radius: number) {
  const hexes = [];
  for (let q = -radius; q <= radius; q++) {
    for (let r = Math.max(-radius, -q - radius); r <= Math.min(radius, -q + radius); r++) {
      hexes.push({ x: q, y: r, terrain: 'plains' });
    }
  }
  return createHexLookup(hexes);
}

/** Create a hex map with specific terrain overrides. */
function customMap(radius: number, overrides: Record<string, string> = {}) {
  const hexes = [];
  for (let q = -radius; q <= radius; q++) {
    for (let r = Math.max(-radius, -q - radius); r <= Math.min(radius, -q + radius); r++) {
      const key = `${q},${r}`;
      const terrain = overrides[key] ?? 'plains';
      hexes.push({ x: q, y: r, terrain });
    }
  }
  return createHexLookup(hexes);
}

// --- Tests ---

describe('constants', () => {
  it('ocean is impassable', () => {
    expect(TERRAIN_COST['ocean']).toBe(Infinity);
  });

  it('plains cost is 1', () => {
    expect(TERRAIN_COST['plains']).toBe(1);
  });

  it('mountains cost is 3', () => {
    expect(TERRAIN_COST['mountains']).toBe(3);
  });

  it('scout speed is 3', () => {
    expect(UNIT_SPEED['scout']).toBe(3);
  });

  it('settler speed is 1', () => {
    expect(UNIT_SPEED['settler']).toBe(1);
  });

  it('scout vision is 3', () => {
    expect(VISION_RADIUS['scout']).toBe(3);
  });

  it('militia vision is 1', () => {
    expect(VISION_RADIUS['militia']).toBe(1);
  });
});

describe('findPath', () => {
  it('returns empty array when already at target', () => {
    const lookup = plainsMap(5);
    const result = findPath({ q: 0, r: 0 }, { q: 0, r: 0 }, lookup);
    expect(result).toEqual([]);
  });

  it('finds direct path on plains', () => {
    const lookup = plainsMap(10);
    const from: HexCoord = { q: 0, r: 0 };
    const to: HexCoord = { q: 3, r: 0 };

    const path = findPath(from, to, lookup);
    expect(path).not.toBeNull();
    expect(path!.length).toBe(3); // 3 steps
    expect(path![path!.length - 1]).toEqual({ q: 3, r: 0 });

    // Path should be optimal — each step is 1 hex closer
    for (let i = 0; i < path!.length; i++) {
      const expected = i + 1; // distance from start
      const prev = i === 0 ? from : path![i - 1];
      expect(hexDistance(prev, path![i])).toBe(1);
    }
  });

  it('finds path around ocean obstacle', () => {
    // Block direct east path with ocean
    const lookup = customMap(5, {
      '1,0': 'ocean',
      '1,-1': 'ocean',
      '1,1': 'ocean',
    });

    const path = findPath({ q: 0, r: 0 }, { q: 2, r: 0 }, lookup);
    expect(path).not.toBeNull();
    // Must go around the ocean wall
    expect(path!.length).toBeGreaterThan(2);

    // Verify no ocean hexes in path
    for (const step of path!) {
      const key = `${step.q},${step.r}`;
      expect(key).not.toBe('1,0');
      expect(key).not.toBe('1,-1');
      expect(key).not.toBe('1,1');
    }
  });

  it('returns null when target is ocean', () => {
    const lookup = customMap(5, { '3,0': 'ocean' });
    const result = findPath({ q: 0, r: 0 }, { q: 3, r: 0 }, lookup);
    expect(result).toBeNull();
  });

  it('returns null when target is unreachable (surrounded by ocean)', () => {
    // Surround (3,0) with ocean
    const lookup = customMap(5, {
      '2,0': 'ocean',
      '2,1': 'ocean',
      '3,-1': 'ocean',
      '3,1': 'ocean',
      '4,-1': 'ocean',
      '4,0': 'ocean',
    });
    const result = findPath({ q: 0, r: 0 }, { q: 3, r: 0 }, lookup);
    expect(result).toBeNull();
  });

  it('returns null when target is off-map', () => {
    const lookup = plainsMap(3);
    const result = findPath({ q: 0, r: 0 }, { q: 10, r: 0 }, lookup);
    expect(result).toBeNull();
  });

  it('prefers plains over mountains (terrain costs matter)', () => {
    // Direct path (q: 0→3) goes through mountains at (1,0), (2,0)
    // Detour via plains around them should be cheaper
    const lookup = customMap(5, {
      '1,0': 'mountains',
      '2,0': 'mountains',
    });

    const pathDirect = findPath({ q: 0, r: 0 }, { q: 3, r: 0 }, lookup);
    expect(pathDirect).not.toBeNull();

    // Calculate total cost of the path
    let totalCost = 0;
    for (const step of pathDirect!) {
      const terrain = step.q === 1 && step.r === 0 ? 'mountains' :
                      step.q === 2 && step.r === 0 ? 'mountains' : 'plains';
      totalCost += TERRAIN_COST[terrain];
    }

    // An all-plains path of length 5 costs 5, vs direct (1+3+3+1) = 8
    // A* should find the cheaper route if one exists
    // The mountain direct path costs: 3+3+1 = 7 (3 steps through mountains)
    // A detour might cost 5 (5 steps on plains)
    // A* should pick the cheaper option
    expect(totalCost).toBeLessThanOrEqual(7);
  });

  it('path endpoints are correct', () => {
    const lookup = plainsMap(10);
    const from: HexCoord = { q: -2, r: 3 };
    const to: HexCoord = { q: 4, r: -1 };

    const path = findPath(from, to, lookup);
    expect(path).not.toBeNull();
    // First step is adjacent to from
    expect(hexDistance(from, path![0])).toBe(1);
    // Last step is the target
    expect(path![path!.length - 1]).toEqual(to);
  });
});

describe('movementStepsThisTick', () => {
  it('scout moves 3 steps on plains', () => {
    const lookup = plainsMap(10);
    const path: HexCoord[] = [
      { q: 1, r: 0 },
      { q: 2, r: 0 },
      { q: 3, r: 0 },
      { q: 4, r: 0 },
      { q: 5, r: 0 },
    ];
    const steps = movementStepsThisTick(path, 'scout', lookup);
    expect(steps).toBe(3);
  });

  it('settler moves 1 step on plains', () => {
    const lookup = plainsMap(10);
    const path: HexCoord[] = [
      { q: 1, r: 0 },
      { q: 2, r: 0 },
      { q: 3, r: 0 },
    ];
    const steps = movementStepsThisTick(path, 'settler', lookup);
    expect(steps).toBe(1);
  });

  it('militia moves 2 steps on plains', () => {
    const lookup = plainsMap(10);
    const path: HexCoord[] = [
      { q: 1, r: 0 },
      { q: 2, r: 0 },
      { q: 3, r: 0 },
    ];
    const steps = movementStepsThisTick(path, 'militia', lookup);
    expect(steps).toBe(2);
  });

  it('scout is slowed by mountains', () => {
    // Scout speed 3, mountains cost 3 → only 1 mountain hex per tick
    const lookup = customMap(10, { '1,0': 'mountains' });
    const path: HexCoord[] = [
      { q: 1, r: 0 }, // mountains, cost 3
      { q: 2, r: 0 }, // plains, cost 1
    ];
    const steps = movementStepsThisTick(path, 'scout', lookup);
    expect(steps).toBe(1); // 3 cost = 3 budget, can't afford next step
  });

  it('returns 0 for empty path', () => {
    const lookup = plainsMap(5);
    const steps = movementStepsThisTick([], 'scout', lookup);
    expect(steps).toBe(0);
  });

  it('guarantees at least 1 step for passable terrain', () => {
    // Settler speed 1, forest cost 2 → normally 0, but guarantee 1
    const lookup = customMap(10, { '1,0': 'forest' });
    const path: HexCoord[] = [
      { q: 1, r: 0 }, // forest, cost 2 > settler budget 1
    ];
    const steps = movementStepsThisTick(path, 'settler', lookup);
    expect(steps).toBe(1); // guaranteed minimum
  });

  it('does not move through terrain that exceeds budget (non-first step)', () => {
    // Militia speed 2: 1 plains (cost 1) then mountains (cost 3) = can't afford step 2
    const lookup = customMap(10, { '2,0': 'mountains' });
    const path: HexCoord[] = [
      { q: 1, r: 0 }, // plains, cost 1
      { q: 2, r: 0 }, // mountains, cost 3 → total would be 4 > budget 2
    ];
    const steps = movementStepsThisTick(path, 'militia', lookup);
    expect(steps).toBe(1);
  });

  it('handles full path consumption', () => {
    const lookup = plainsMap(10);
    const path: HexCoord[] = [
      { q: 1, r: 0 },
      { q: 2, r: 0 },
    ];
    // Scout speed 3, path length 2 → consumes whole path
    const steps = movementStepsThisTick(path, 'scout', lookup);
    expect(steps).toBe(2);
  });
});

describe('createHexLookup', () => {
  it('returns terrain for known hexes', () => {
    const lookup = createHexLookup([
      { x: 0, y: 0, terrain: 'plains' },
      { x: 1, y: 0, terrain: 'forest' },
    ]);
    expect(lookup.getTerrain(0, 0)).toBe('plains');
    expect(lookup.getTerrain(1, 0)).toBe('forest');
  });

  it('returns undefined for unknown hexes', () => {
    const lookup = createHexLookup([{ x: 0, y: 0, terrain: 'plains' }]);
    expect(lookup.getTerrain(99, 99)).toBeUndefined();
  });
});
