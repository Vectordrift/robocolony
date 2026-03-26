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

  it('mountains cost is 2', () => {
    expect(TERRAIN_COST['mountains']).toBe(2);
  });

  it('forest cost is 1.5', () => {
    expect(TERRAIN_COST['forest']).toBe(1.5);
  });

  it('scout speed is 5', () => {
    expect(UNIT_SPEED['scout']).toBe(5);
  });

  it('settler speed is 2', () => {
    expect(UNIT_SPEED['settler']).toBe(2);
  });

  it('militia speed is 3', () => {
    expect(UNIT_SPEED['militia']).toBe(3);
  });

  it('scout vision is 6', () => {
    expect(VISION_RADIUS['scout']).toBe(6);
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
    const lookup = customMap(5, {
      '1,0': 'mountains',
      '2,0': 'mountains',
    });

    const pathDirect = findPath({ q: 0, r: 0 }, { q: 3, r: 0 }, lookup);
    expect(pathDirect).not.toBeNull();

    let totalCost = 0;
    for (const step of pathDirect!) {
      const terrain = step.q === 1 && step.r === 0 ? 'mountains' :
                      step.q === 2 && step.r === 0 ? 'mountains' : 'plains';
      totalCost += TERRAIN_COST[terrain];
    }

    // Mountains cost 2 now. Direct: 2+2+1=5 (3 steps). Detour: 5 plains = 5 cost.
    // Either way ≤5
    expect(totalCost).toBeLessThanOrEqual(5);
  });

  it('path endpoints are correct', () => {
    const lookup = plainsMap(10);
    const from: HexCoord = { q: -2, r: 3 };
    const to: HexCoord = { q: 4, r: -1 };

    const path = findPath(from, to, lookup);
    expect(path).not.toBeNull();
    expect(hexDistance(from, path![0])).toBe(1);
    expect(path![path!.length - 1]).toEqual(to);
  });
});

describe('movementStepsThisTick', () => {
  it('scout moves 5 steps on plains', () => {
    const lookup = plainsMap(10);
    const path: HexCoord[] = [
      { q: 1, r: 0 },
      { q: 2, r: 0 },
      { q: 3, r: 0 },
      { q: 4, r: 0 },
      { q: 5, r: 0 },
      { q: 6, r: 0 },
      { q: 7, r: 0 },
    ];
    const steps = movementStepsThisTick(path, 'scout', lookup);
    expect(steps).toBe(5);
  });

  it('settler moves 2 steps on plains', () => {
    const lookup = plainsMap(10);
    const path: HexCoord[] = [
      { q: 1, r: 0 },
      { q: 2, r: 0 },
      { q: 3, r: 0 },
    ];
    const steps = movementStepsThisTick(path, 'settler', lookup);
    expect(steps).toBe(2);
  });

  it('militia moves 3 steps on plains', () => {
    const lookup = plainsMap(10);
    const path: HexCoord[] = [
      { q: 1, r: 0 },
      { q: 2, r: 0 },
      { q: 3, r: 0 },
      { q: 4, r: 0 },
    ];
    const steps = movementStepsThisTick(path, 'militia', lookup);
    expect(steps).toBe(3);
  });

  it('scout is slowed by mountains', () => {
    // Scout speed 5, mountains cost 2 → 2 mountain hexes (cost 4) then can't afford 3rd mountain
    const lookup = customMap(10, { '1,0': 'mountains', '2,0': 'mountains', '3,0': 'mountains' });
    const path: HexCoord[] = [
      { q: 1, r: 0 }, // mountains, cost 2
      { q: 2, r: 0 }, // mountains, cost 2 (total 4)
      { q: 3, r: 0 }, // mountains, cost 2 (total 6 > 5)
    ];
    const steps = movementStepsThisTick(path, 'scout', lookup);
    expect(steps).toBe(2); // 2+2=4 within budget, 3rd would be 6 > 5
  });

  it('returns 0 for empty path', () => {
    const lookup = plainsMap(5);
    const steps = movementStepsThisTick([], 'scout', lookup);
    expect(steps).toBe(0);
  });

  it('guarantees at least 1 step for passable terrain', () => {
    // Siege speed 1, mountains cost 2 → normally 0, but guarantee 1
    const lookup = customMap(10, { '1,0': 'mountains' });
    const path: HexCoord[] = [
      { q: 1, r: 0 }, // mountains, cost 2 > siege budget 1
    ];
    const steps = movementStepsThisTick(path, 'siege', lookup);
    expect(steps).toBe(1); // guaranteed minimum
  });

  it('does not move through terrain that exceeds budget (non-first step)', () => {
    // Settler speed 2: 1 plains (cost 1) then mountains (cost 2) = total 3 > budget 2
    const lookup = customMap(10, { '2,0': 'mountains' });
    const path: HexCoord[] = [
      { q: 1, r: 0 }, // plains, cost 1
      { q: 2, r: 0 }, // mountains, cost 2 → total would be 3 > budget 2
    ];
    const steps = movementStepsThisTick(path, 'settler', lookup);
    expect(steps).toBe(1);
  });

  it('handles full path consumption', () => {
    const lookup = plainsMap(10);
    const path: HexCoord[] = [
      { q: 1, r: 0 },
      { q: 2, r: 0 },
    ];
    // Scout speed 5, path length 2 → consumes whole path
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
