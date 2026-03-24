/**
 * Tests for fog of war reveal logic.
 */

import { describe, it, expect } from 'vitest';
import { computeFogReveals, computeStartingReveals, hexesWithinRadius } from '../fog.js';
import type { Unit } from '../tick.js';

// --- Helpers ---

/** Create a set of valid hex coordinate keys for a hex grid of given radius. */
function createHexGrid(radius: number): Set<string> {
  const hexes = new Set<string>();
  for (let q = -radius; q <= radius; q++) {
    const r1 = Math.max(-radius, -q - radius);
    const r2 = Math.min(radius, -q + radius);
    for (let r = r1; r <= r2; r++) {
      hexes.set(`${q},${r}`);
    }
  }
  return hexes;
}

function makeUnit(overrides: Partial<Unit> = {}): Unit {
  return {
    id: 'unit_test',
    colonyId: 'col_test',
    worldId: 'world_test',
    type: 'militia',
    hexX: 0,
    hexY: 0,
    health: 100,
    morale: 1.0,
    movementQueue: [],
    ...overrides,
  };
}

// --- Tests ---

describe('hexesWithinRadius', () => {
  it('returns only the center hex at radius 0', () => {
    const grid = createHexGrid(5);
    const result = hexesWithinRadius({ q: 0, r: 0 }, 0, grid);
    expect(result).toEqual([{ q: 0, r: 0 }]);
  });

  it('returns 7 hexes at radius 1 (center + 6 neighbors)', () => {
    const grid = createHexGrid(5);
    const result = hexesWithinRadius({ q: 0, r: 0 }, 1, grid);
    expect(result).toHaveLength(7);
    // Should include center
    expect(result).toContainEqual({ q: 0, r: 0 });
    // Should include all 6 neighbors
    expect(result).toContainEqual({ q: 1, r: 0 });
    expect(result).toContainEqual({ q: -1, r: 0 });
    expect(result).toContainEqual({ q: 0, r: 1 });
    expect(result).toContainEqual({ q: 0, r: -1 });
    expect(result).toContainEqual({ q: 1, r: -1 });
    expect(result).toContainEqual({ q: -1, r: 1 });
  });

  it('returns 19 hexes at radius 2', () => {
    const grid = createHexGrid(5);
    const result = hexesWithinRadius({ q: 0, r: 0 }, 2, grid);
    expect(result).toHaveLength(19);
  });

  it('filters out hexes not in the valid set', () => {
    // Grid radius 1 = 7 hexes. Ask for radius 2 from origin = would be 19, but only 7 exist.
    const grid = createHexGrid(1);
    const result = hexesWithinRadius({ q: 0, r: 0 }, 2, grid);
    expect(result).toHaveLength(7);
  });

  it('works with non-origin center', () => {
    const grid = createHexGrid(5);
    const result = hexesWithinRadius({ q: 2, r: -1 }, 1, grid);
    expect(result).toHaveLength(7);
    expect(result).toContainEqual({ q: 2, r: -1 });
  });
});

describe('computeFogReveals', () => {
  it('reveals hexes around a moved militia (radius 1)', () => {
    const grid = createHexGrid(5);
    const explored = new Map<string, boolean>();
    const unit = makeUnit({ type: 'militia', hexX: 0, hexY: 0 });

    const result = computeFogReveals([unit], grid, explored);

    // Militia has vision radius 1 → 7 hexes revealed
    expect(result.reveals).toHaveLength(7);
    expect(result.events).toHaveLength(1);
    expect(result.events[0].type).toBe('hexes_revealed');
    expect(result.events[0].data.radius).toBe(1);
    expect(result.events[0].data.newHexCount).toBe(7);
  });

  it('reveals hexes around a moved scout (radius 3)', () => {
    const grid = createHexGrid(10);
    const explored = new Map<string, boolean>();
    const unit = makeUnit({ type: 'scout', hexX: 0, hexY: 0 });

    const result = computeFogReveals([unit], grid, explored);

    // Scout has vision radius 3 → 37 hexes (1 + 6 + 12 + 18)
    expect(result.reveals).toHaveLength(37);
    expect(result.events).toHaveLength(1);
    expect(result.events[0].data.radius).toBe(3);
    expect(result.events[0].data.newHexCount).toBe(37);
  });

  it('does not re-reveal already explored hexes', () => {
    const grid = createHexGrid(5);
    const explored = new Map<string, boolean>();

    // Pre-mark center and some neighbors as explored
    explored.set('col_test:0,0', true);
    explored.set('col_test:1,0', true);
    explored.set('col_test:-1,0', true);

    const unit = makeUnit({ type: 'militia', hexX: 0, hexY: 0 });
    const result = computeFogReveals([unit], grid, explored);

    // 7 total - 3 already explored = 4 new
    expect(result.reveals).toHaveLength(4);
    expect(result.events[0].data.newHexCount).toBe(4);
  });

  it('skips reveal when all hexes already explored', () => {
    const grid = createHexGrid(5);
    const explored = new Map<string, boolean>();

    // Pre-mark all hexes in radius 1 as explored
    const neighbors = [
      { q: 0, r: 0 }, { q: 1, r: 0 }, { q: -1, r: 0 },
      { q: 0, r: 1 }, { q: 0, r: -1 }, { q: 1, r: -1 }, { q: -1, r: 1 },
    ];
    for (const h of neighbors) {
      explored.set(`col_test:${h.q},${h.r}`, true);
    }

    const unit = makeUnit({ type: 'militia', hexX: 0, hexY: 0 });
    const result = computeFogReveals([unit], grid, explored);

    expect(result.reveals).toHaveLength(0);
    expect(result.events).toHaveLength(0);
  });

  it('handles multiple units from the same colony without duplication', () => {
    const grid = createHexGrid(5);
    const explored = new Map<string, boolean>();

    const unit1 = makeUnit({ id: 'unit_1', type: 'militia', hexX: 0, hexY: 0 });
    const unit2 = makeUnit({ id: 'unit_2', type: 'militia', hexX: 0, hexY: 0 });

    const result = computeFogReveals([unit1, unit2], grid, explored);

    // Both units at same position — first reveals 7, second reveals 0
    expect(result.reveals).toHaveLength(7);
    expect(result.events).toHaveLength(1); // Only unit1 generates an event
  });

  it('handles units from different colonies independently', () => {
    const grid = createHexGrid(5);
    const explored = new Map<string, boolean>();

    const unit1 = makeUnit({ id: 'unit_1', colonyId: 'col_alpha', type: 'militia', hexX: 0, hexY: 0 });
    const unit2 = makeUnit({ id: 'unit_2', colonyId: 'col_beta', type: 'militia', hexX: 0, hexY: 0 });

    const result = computeFogReveals([unit1, unit2], grid, explored);

    // Each colony reveals 7 hexes independently
    expect(result.reveals).toHaveLength(14);
    expect(result.events).toHaveLength(2);

    const alphaReveals = result.reveals.filter(r => r.colonyId === 'col_alpha');
    const betaReveals = result.reveals.filter(r => r.colonyId === 'col_beta');
    expect(alphaReveals).toHaveLength(7);
    expect(betaReveals).toHaveLength(7);
  });

  it('handles units near the edge of the map', () => {
    const grid = createHexGrid(2);
    const explored = new Map<string, boolean>();

    // Place scout at edge — some of its vision radius 3 hexes won't exist
    const unit = makeUnit({ type: 'scout', hexX: 2, hexY: 0 });
    const result = computeFogReveals([unit], grid, explored);

    // Should only reveal hexes that actually exist in the grid
    for (const reveal of result.reveals) {
      expect(grid.has(`${reveal.hex.q},${reveal.hex.r}`)).toBe(true);
    }
    // Should be less than 37 (full radius 3)
    expect(result.reveals.length).toBeLessThan(37);
    expect(result.reveals.length).toBeGreaterThan(0);
  });

  it('generates correct event data', () => {
    const grid = createHexGrid(5);
    const explored = new Map<string, boolean>();

    const unit = makeUnit({ id: 'unit_scout1', colonyId: 'col_abc', type: 'scout', hexX: 2, hexY: -1 });
    const result = computeFogReveals([unit], grid, explored);

    expect(result.events[0]).toEqual({
      type: 'hexes_revealed',
      colonyId: 'col_abc',
      unitId: 'unit_scout1',
      data: {
        unitType: 'scout',
        position: { x: 2, y: -1 },
        radius: 3,
        newHexCount: expect.any(Number),
      },
    });
  });
});

describe('computeStartingReveals', () => {
  it('reveals hexes at the specified radius', () => {
    const grid = createHexGrid(10);
    const reveals = computeStartingReveals('col_test', { q: 0, r: 0 }, 5, grid);

    // Radius 5 = 1 + 6 + 12 + 18 + 24 + 30 = 91 hexes
    expect(reveals).toHaveLength(91);
    for (const r of reveals) {
      expect(r.colonyId).toBe('col_test');
    }
  });

  it('respects map boundaries', () => {
    const grid = createHexGrid(3);
    const reveals = computeStartingReveals('col_test', { q: 0, r: 0 }, 5, grid);

    // Grid has 37 hexes (radius 3), reveal radius 5 would be 91 — clamped to 37
    expect(reveals).toHaveLength(37);
  });

  it('works with non-origin starting hex', () => {
    const grid = createHexGrid(10);
    const reveals = computeStartingReveals('col_test', { q: 3, r: -2 }, 2, grid);

    // Radius 2 = 19 hexes
    expect(reveals).toHaveLength(19);
    // All should be within distance 2 of (3, -2)
    for (const r of reveals) {
      const dq = r.hex.q - 3;
      const dr = r.hex.r - (-2);
      const ds = -dq - dr;
      const dist = Math.max(Math.abs(dq), Math.abs(dr), Math.abs(ds));
      expect(dist).toBeLessThanOrEqual(2);
    }
  });
});
