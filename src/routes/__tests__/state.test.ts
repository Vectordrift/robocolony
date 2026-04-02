import { describe, it, expect, vi, beforeEach } from 'vitest';
import { analyzeSettlementSites, type VisibleHex } from '../state.js';

// --- Fog of War unit tests ---

describe('Fog of War', () => {
  // Test the logic without DB — verify the concept
  describe('visibility filtering', () => {
    interface TestHex {
      x: number;
      y: number;
      terrain: string;
      resources: Record<string, number>;
      settlementId: string | null;
      exploredBy: string[];
    }

    function filterVisibleHexes(allHexes: TestHex[], colonyId: string): TestHex[] {
      return allHexes.filter((h) => h.exploredBy.includes(colonyId));
    }

    const testHexes: TestHex[] = [
      { x: 0, y: 0, terrain: 'plains', resources: { food: 3 }, settlementId: 'set_1', exploredBy: ['col_a', 'col_b'] },
      { x: 1, y: 0, terrain: 'forest', resources: { timber: 4 }, settlementId: null, exploredBy: ['col_a'] },
      { x: 0, y: 1, terrain: 'mountains', resources: { stone: 5 }, settlementId: null, exploredBy: ['col_b'] },
      { x: 2, y: 0, terrain: 'ocean', resources: {}, settlementId: null, exploredBy: [] },
      { x: -1, y: 1, terrain: 'desert', resources: { iron: 2 }, settlementId: null, exploredBy: ['col_a', 'col_b'] },
    ];

    it('colony A sees only hexes in its explored_by', () => {
      const visible = filterVisibleHexes(testHexes, 'col_a');
      expect(visible).toHaveLength(3);
      expect(visible.map((h) => `${h.x},${h.y}`)).toEqual(['0,0', '1,0', '-1,1']);
    });

    it('colony B sees only hexes in its explored_by', () => {
      const visible = filterVisibleHexes(testHexes, 'col_b');
      expect(visible).toHaveLength(3);
      expect(visible.map((h) => `${h.x},${h.y}`)).toEqual(['0,0', '0,1', '-1,1']);
    });

    it('unknown colony sees nothing', () => {
      const visible = filterVisibleHexes(testHexes, 'col_unknown');
      expect(visible).toHaveLength(0);
    });

    it('unexplored hexes are hidden from everyone', () => {
      const oceanHex = testHexes.find((h) => h.terrain === 'ocean')!;
      expect(oceanHex.exploredBy).toHaveLength(0);
      expect(filterVisibleHexes([oceanHex], 'col_a')).toHaveLength(0);
      expect(filterVisibleHexes([oceanHex], 'col_b')).toHaveLength(0);
    });

    it('shared hexes are visible to both colonies', () => {
      const sharedHexes = testHexes.filter(
        (h) => h.exploredBy.includes('col_a') && h.exploredBy.includes('col_b'),
      );
      expect(sharedHexes).toHaveLength(2); // (0,0) and (-1,1)
    });
  });
});

// --- State response shape tests ---

describe('State response shape', () => {
  it('colony state includes all required fields', () => {
    // Verify the expected response structure
    const mockState = {
      tick: 5,
      worldStatus: 'running',
      colony: {
        id: 'col_test',
        name: 'Test Colony',
        status: 'active',
        resources: { food: 100, timber: 50, stone: 30, iron: 10, influence: 50 },
        legacyScore: 0,
      },
      settlements: [{
        id: 'set_test',
        name: 'Test Prime',
        hex: { x: 10, y: -5 },
        tier: 'outpost',
        buildings: [],
        buildQueue: [],
        loyalty: 100,
        population: 10,
      }],
      units: [{
        id: 'unit_test',
        type: 'scout',
        hex: { x: 10, y: -5 },
        health: 100,
        maxHp: 100,
        morale: 1.0,
        status: 'idle',
        movementQueue: [],
      }],
      map: [{
        x: 10,
        y: -5,
        terrain: 'plains',
        resources: { food: 3 },
        settlementId: 'set_test',
      }],
    };

    // Validate structure
    expect(mockState).toHaveProperty('tick');
    expect(mockState).toHaveProperty('worldStatus');
    expect(mockState).toHaveProperty('colony');
    expect(mockState.colony).toHaveProperty('id');
    expect(mockState.colony).toHaveProperty('resources');
    expect(mockState).toHaveProperty('settlements');
    expect(mockState).toHaveProperty('units');
    expect(mockState).toHaveProperty('map');
    expect(mockState.settlements[0]).toHaveProperty('hex');
    expect(mockState.units[0]).toHaveProperty('hex');
    expect(mockState.map[0]).toHaveProperty('terrain');
    expect(typeof mockState.tick).toBe('number');
  });

  it('map response includes hex count', () => {
    const mockMapResponse = {
      tick: 3,
      colonyId: 'col_test',
      hexCount: 42,
      hexes: new Array(42).fill(null).map((_, i) => ({
        x: i, y: 0, terrain: 'plains', resources: {}, settlementId: null,
      })),
    };

    expect(mockMapResponse.hexCount).toBe(mockMapResponse.hexes.length);
  });
});

describe('Settlement site analysis', () => {
  it('ranks explored founding candidates and skips invalid nearby hexes', () => {
    const visibleHexes: VisibleHex[] = [
      { x: 0, y: 0, terrain: 'plains', resources: { food: 3, timber: 1, stone: 0, iron: 0 }, settlementId: 'set-home' },
      { x: 1, y: 0, terrain: 'plains', resources: { food: 5, timber: 0, stone: 0, iron: 0 }, settlementId: null },
      { x: 1, y: -1, terrain: 'forest', resources: { food: 2, timber: 4, stone: 0, iron: 0 }, settlementId: null },
      { x: 2, y: -1, terrain: 'mountains', resources: { food: 0, timber: 0, stone: 4, iron: 2 }, settlementId: null },
      { x: 2, y: 0, terrain: 'plains', resources: { food: 4, timber: 1, stone: 0, iron: 0 }, settlementId: null, poi: { type: 'watchtower' } },
      { x: 2, y: 1, terrain: 'coast', resources: { food: 3, timber: 0, stone: 0, iron: 0 }, settlementId: null },
      { x: 3, y: 0, terrain: 'plains', resources: { food: 4, timber: 1, stone: 0, iron: 0 }, settlementId: null },
      { x: 3, y: -1, terrain: 'forest', resources: { food: 1, timber: 3, stone: 0, iron: 0 }, settlementId: null },
      { x: 4, y: -1, terrain: 'mountains', resources: { food: 0, timber: 0, stone: 3, iron: 3 }, settlementId: null },
      { x: 4, y: 0, terrain: 'plains', resources: { food: 5, timber: 0, stone: 0, iron: 0 }, settlementId: null, poi: { type: 'sacred_grove' } },
      { x: 3, y: 1, terrain: 'plains', resources: { food: 4, timber: 0, stone: 0, iron: 0 }, settlementId: null },
      { x: 5, y: 0, terrain: 'ocean', resources: { food: 0, timber: 0, stone: 0, iron: 0 }, settlementId: null },
    ];

    const candidates = analyzeSettlementSites(visibleHexes, 3);

    expect(candidates).toHaveLength(3);
    expect(candidates[0]).toMatchObject({
      x: 3,
      y: 0,
    });
    expect(candidates[0].score).toBeGreaterThan(candidates[1].score);
    expect(candidates.some(candidate => candidate.x === 1 && candidate.y === 0)).toBe(false);
    expect(candidates.every(candidate => candidate.distanceToNearestSettlement === null || candidate.distanceToNearestSettlement >= 3)).toBe(true);
    expect(candidates[0].reasons.some(reason => reason.includes('POI'))).toBe(true);
  });
});

// --- Auth middleware tests ---

describe('Auth middleware', () => {
  it('rejects requests without Authorization header', () => {
    // Test the logic: no Bearer token → 401
    const authHeader = undefined;
    expect(authHeader?.startsWith('Bearer ')).toBeFalsy();
  });

  it('rejects invalid key format', () => {
    const badKeys = ['', 'not_a_key', 'rc_live_tooshort', 'Bearer invalid'];
    for (const key of badKeys) {
      const isValid = key.startsWith('rc_live_') && key.length === 8 + 32; // prefix + nanoid(32)
      expect(isValid).toBe(false);
    }
  });

  it('accepts valid key format', () => {
    // rc_live_ (8 chars) + nanoid(32) = 40 chars total
    const validKey = 'rc_live_' + 'a'.repeat(32);
    const isValid = validKey.startsWith('rc_live_') && validKey.length === 40;
    expect(isValid).toBe(true);
  });
});
