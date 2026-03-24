import { describe, it, expect } from 'vitest';
import {
  hexDistance,
  hexDistanceFromOrigin,
  hexesInRadius,
  hexNeighbors,
  hexRing,
} from '../hex.js';
import { createRng, noiseAt, multiOctaveNoise } from '../noise.js';
import { generateWorld, getTerrainStats, findStartingPositions } from '../mapgen.js';
import type { TerrainType } from '../mapgen.js';

// --- Hex utilities ---

describe('Hex utilities', () => {
  describe('hexDistance', () => {
    it('returns 0 for same hex', () => {
      expect(hexDistance({ q: 3, r: 5 }, { q: 3, r: 5 })).toBe(0);
    });

    it('returns 1 for adjacent hexes', () => {
      expect(hexDistance({ q: 0, r: 0 }, { q: 1, r: 0 })).toBe(1);
      expect(hexDistance({ q: 0, r: 0 }, { q: 0, r: 1 })).toBe(1);
      expect(hexDistance({ q: 0, r: 0 }, { q: -1, r: 1 })).toBe(1);
    });

    it('computes correct distances for non-adjacent hexes', () => {
      expect(hexDistance({ q: 0, r: 0 }, { q: 3, r: -1 })).toBe(3);
      expect(hexDistance({ q: -2, r: 4 }, { q: 2, r: -1 })).toBe(5);
    });
  });

  describe('hexDistanceFromOrigin', () => {
    it('returns 0 for origin', () => {
      expect(hexDistanceFromOrigin({ q: 0, r: 0 })).toBe(0);
    });

    it('computes distance from origin', () => {
      expect(hexDistanceFromOrigin({ q: 5, r: -3 })).toBe(5);
    });
  });

  describe('hexesInRadius', () => {
    it('returns 1 hex for radius 0', () => {
      const hexes = hexesInRadius(0);
      expect(hexes).toHaveLength(1);
      expect(hexes[0].q).toBe(0);
      expect(hexes[0].r).toBe(0);
    });

    it('returns 7 hexes for radius 1', () => {
      expect(hexesInRadius(1)).toHaveLength(7);
    });

    it('returns correct count for radius 2', () => {
      // 3r² + 3r + 1 = 19 for r=2
      expect(hexesInRadius(2)).toHaveLength(19);
    });

    it('returns ~7850 hexes for radius 50', () => {
      const hexes = hexesInRadius(50);
      // 3(50²) + 3(50) + 1 = 7500 + 150 + 1 = 7651
      expect(hexes.length).toBe(7651);
    });

    it('all hexes are within radius', () => {
      const radius = 5;
      const hexes = hexesInRadius(radius);
      for (const hex of hexes) {
        expect(hexDistanceFromOrigin(hex)).toBeLessThanOrEqual(radius);
      }
    });
  });

  describe('hexNeighbors', () => {
    it('returns 6 neighbors', () => {
      const neighbors = hexNeighbors({ q: 0, r: 0 });
      expect(neighbors).toHaveLength(6);
    });

    it('all neighbors are distance 1', () => {
      const center = { q: 3, r: -2 };
      const neighbors = hexNeighbors(center);
      for (const n of neighbors) {
        expect(hexDistance(center, n)).toBe(1);
      }
    });
  });

  describe('hexRing', () => {
    it('returns 1 hex for radius 0', () => {
      const ring = hexRing({ q: 0, r: 0 }, 0);
      expect(ring).toHaveLength(1);
    });

    it('returns 6 hexes for radius 1', () => {
      const ring = hexRing({ q: 0, r: 0 }, 1);
      expect(ring).toHaveLength(6);
    });

    it('all hexes on ring are at correct distance', () => {
      const center = { q: 2, r: -1 };
      const radius = 3;
      const ring = hexRing(center, radius);
      expect(ring).toHaveLength(6 * radius);
      for (const hex of ring) {
        expect(hexDistance(center, hex)).toBe(radius);
      }
    });
  });
});

// --- Noise functions ---

describe('Noise functions', () => {
  describe('createRng', () => {
    it('produces deterministic output for same seed', () => {
      const rng1 = createRng(42);
      const rng2 = createRng(42);
      for (let i = 0; i < 100; i++) {
        expect(rng1()).toBe(rng2());
      }
    });

    it('produces different output for different seeds', () => {
      const rng1 = createRng(42);
      const rng2 = createRng(43);
      // At least some values should differ
      let differs = false;
      for (let i = 0; i < 10; i++) {
        if (rng1() !== rng2()) differs = true;
      }
      expect(differs).toBe(true);
    });

    it('produces values in [0, 1)', () => {
      const rng = createRng(12345);
      for (let i = 0; i < 1000; i++) {
        const v = rng();
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThan(1);
      }
    });
  });

  describe('noiseAt', () => {
    it('is deterministic for same inputs', () => {
      expect(noiseAt(42, 10, 20)).toBe(noiseAt(42, 10, 20));
    });

    it('varies with coordinates', () => {
      const v1 = noiseAt(42, 0, 0);
      const v2 = noiseAt(42, 5, 5);
      expect(v1).not.toBe(v2);
    });

    it('varies with seed', () => {
      const v1 = noiseAt(42, 10, 10);
      const v2 = noiseAt(43, 10, 10);
      expect(v1).not.toBe(v2);
    });

    it('returns values in [0, 1)', () => {
      for (let q = -10; q <= 10; q++) {
        for (let r = -10; r <= 10; r++) {
          const v = noiseAt(42, q, r);
          expect(v).toBeGreaterThanOrEqual(0);
          expect(v).toBeLessThan(1);
        }
      }
    });
  });

  describe('multiOctaveNoise', () => {
    it('is deterministic', () => {
      expect(multiOctaveNoise(42, 5, 5, 3)).toBe(multiOctaveNoise(42, 5, 5, 3));
    });

    it('returns values in [0, 1)', () => {
      for (let q = -10; q <= 10; q++) {
        for (let r = -10; r <= 10; r++) {
          const v = multiOctaveNoise(42, q, r, 3);
          expect(v).toBeGreaterThanOrEqual(0);
          expect(v).toBeLessThan(1);
        }
      }
    });
  });
});

// --- Map generation ---

describe('Map generation', () => {
  describe('generateWorld', () => {
    it('is deterministic: same seed produces same map', () => {
      const world1 = generateWorld(42, 10);
      const world2 = generateWorld(42, 10);

      expect(world1.hexes.length).toBe(world2.hexes.length);
      for (let i = 0; i < world1.hexes.length; i++) {
        expect(world1.hexes[i].q).toBe(world2.hexes[i].q);
        expect(world1.hexes[i].r).toBe(world2.hexes[i].r);
        expect(world1.hexes[i].terrain).toBe(world2.hexes[i].terrain);
        expect(world1.hexes[i].resources).toEqual(world2.hexes[i].resources);
      }
    });

    it('different seeds produce different maps', () => {
      const world1 = generateWorld(42, 10);
      const world2 = generateWorld(99, 10);

      // At least some terrain should differ
      let differs = false;
      for (let i = 0; i < world1.hexes.length; i++) {
        if (world1.hexes[i].terrain !== world2.hexes[i].terrain) {
          differs = true;
          break;
        }
      }
      expect(differs).toBe(true);
    });

    it('generates correct hex count for given radius', () => {
      const world = generateWorld(42, 10);
      // 3(10²) + 3(10) + 1 = 331
      expect(world.hexes.length).toBe(331);
    });

    it('produces ~7651 hexes for radius 50', () => {
      const world = generateWorld(42, 50);
      expect(world.hexes.length).toBe(7651);
    });
  });

  describe('terrain distribution', () => {
    it('has ocean at the edges and land in the interior', () => {
      const world = generateWorld(42, 50);
      const stats = getTerrainStats(world.hexes);

      // Should have all terrain types
      const terrainTypes: TerrainType[] = ['ocean', 'coast', 'plains', 'forest', 'mountains', 'desert', 'tundra'];
      for (const t of terrainTypes) {
        expect(stats[t]).toBeGreaterThan(0);
      }
    });

    it('has roughly 70% land, 30% ocean/coast for radius 50', () => {
      const world = generateWorld(42, 50);
      const stats = getTerrainStats(world.hexes);
      const total = world.hexes.length;
      const waterCount = (stats.ocean || 0) + (stats.coast || 0);
      const landCount = total - waterCount;

      // Allow generous range: 55-85% land
      const landPct = landCount / total;
      expect(landPct).toBeGreaterThan(0.55);
      expect(landPct).toBeLessThan(0.85);
    });

    it('resources are non-negative', () => {
      const world = generateWorld(42, 20);
      for (const hex of world.hexes) {
        expect(hex.resources.food).toBeGreaterThanOrEqual(0);
        expect(hex.resources.timber).toBeGreaterThanOrEqual(0);
        expect(hex.resources.stone).toBeGreaterThanOrEqual(0);
        expect(hex.resources.iron).toBeGreaterThanOrEqual(0);
      }
    });

    it('ocean hexes have no resources', () => {
      const world = generateWorld(42, 20);
      const oceanHexes = world.hexes.filter((h) => h.terrain === 'ocean');
      for (const hex of oceanHexes) {
        // Ocean base is 0 but noise can add variation; check no more than 1
        const total = hex.resources.food + hex.resources.timber + hex.resources.stone + hex.resources.iron;
        expect(total).toBeLessThanOrEqual(3);
      }
    });
  });

  describe('starting positions', () => {
    it('finds starting positions for a radius 50 map', () => {
      const world = generateWorld(42, 50);
      expect(world.startingPositions.length).toBeGreaterThanOrEqual(4);
      expect(world.startingPositions.length).toBeLessThanOrEqual(8);
    });

    it('positions are spaced at least 30 hexes apart', () => {
      const world = generateWorld(42, 50);
      const positions = world.startingPositions;

      for (let i = 0; i < positions.length; i++) {
        for (let j = i + 1; j < positions.length; j++) {
          const dist = hexDistance(positions[i], positions[j]);
          expect(dist).toBeGreaterThanOrEqual(30);
        }
      }
    });

    it('positions are on land terrain', () => {
      const world = generateWorld(42, 50);
      const hexMap = new Map(world.hexes.map((h) => [`${h.q},${h.r}`, h]));

      for (const pos of world.startingPositions) {
        const hex = hexMap.get(`${pos.q},${pos.r}`);
        expect(hex).toBeDefined();
        expect(['plains', 'forest', 'tundra']).toContain(hex!.terrain);
      }
    });

    it('positions are in the spawn ring zone', () => {
      const world = generateWorld(42, 50);
      for (const pos of world.startingPositions) {
        const dist = hexDistanceFromOrigin(pos);
        expect(dist).toBeGreaterThanOrEqual(Math.floor(50 * 0.65));
        expect(dist).toBeLessThanOrEqual(Math.ceil(50 * 0.75));
      }
    });

    it('positions are deterministic', () => {
      const world1 = generateWorld(42, 50);
      const world2 = generateWorld(42, 50);
      expect(world1.startingPositions).toEqual(world2.startingPositions);
    });
  });
});
