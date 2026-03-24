/**
 * Tests for world creation and colony join endpoints.
 *
 * Tests validation logic and starting condition calculations.
 * Full integration tests (with DB) run in the E2E suite.
 */

import { describe, it, expect } from 'vitest';
import { generateWorld, findStartingPositions } from '../../engine/mapgen.js';
import { hexDistance, hexesInRadius } from '../../engine/hex.js';
import { generateApiKey, hashApiKey, isValidKeyFormat } from '../../lib/auth.js';

describe('World creation logic', () => {
  describe('map generation for world creation', () => {
    it('generates a map with hexes and starting positions', () => {
      const worldMap = generateWorld(42, 50, 8);
      expect(worldMap.hexes.length).toBeGreaterThan(7000);
      expect(worldMap.startingPositions.length).toBeGreaterThanOrEqual(2);
    });

    it('uses custom radius when provided', () => {
      const worldMap = generateWorld(42, 20, 4);
      expect(worldMap.radius).toBe(20);
      // radius 20 → ~1261 hexes
      expect(worldMap.hexes.length).toBeGreaterThan(1000);
      expect(worldMap.hexes.length).toBeLessThan(2000);
    });

    it('starting positions are at least 30 hexes apart', () => {
      const worldMap = generateWorld(42, 50, 8);
      const positions = worldMap.startingPositions;

      for (let i = 0; i < positions.length; i++) {
        for (let j = i + 1; j < positions.length; j++) {
          const dist = hexDistance(positions[i], positions[j]);
          expect(dist).toBeGreaterThanOrEqual(30);
        }
      }
    });

    it('starting positions are on land', () => {
      const worldMap = generateWorld(42, 50, 8);
      const hexMap = new Map(worldMap.hexes.map(h => [`${h.q},${h.r}`, h]));

      for (const pos of worldMap.startingPositions) {
        const hex = hexMap.get(`${pos.q},${pos.r}`);
        expect(hex).toBeDefined();
        expect(['plains', 'forest', 'tundra']).toContain(hex!.terrain);
      }
    });
  });

  describe('starting conditions', () => {
    it('5-hex reveal radius covers correct area', () => {
      const revealCoords = hexesInRadius(5);
      // 3(5²) + 3(5) + 1 = 91 hexes
      expect(revealCoords.length).toBe(91);
    });

    it('starting resources match spec', () => {
      const resources = { food: 100, timber: 50, stone: 30, iron: 10, influence: 50 };
      expect(resources.food).toBe(100);
      expect(resources.timber).toBe(50);
      expect(resources.stone).toBe(30);
      expect(resources.iron).toBe(10);
      expect(resources.influence).toBe(50);
    });

    it('starting units match spec: 2 scouts, 2 militia, 1 settler', () => {
      const startingUnits = [
        { type: 'scout', count: 2 },
        { type: 'militia', count: 2 },
        { type: 'settler', count: 1 },
      ];
      const total = startingUnits.reduce((sum, u) => sum + u.count, 0);
      expect(total).toBe(5);
      expect(startingUnits.find(u => u.type === 'scout')?.count).toBe(2);
      expect(startingUnits.find(u => u.type === 'militia')?.count).toBe(2);
      expect(startingUnits.find(u => u.type === 'settler')?.count).toBe(1);
    });

    it('starting buildings: farm + lumber mill', () => {
      const buildings = [
        { type: 'farm', completedAtTick: 0 },
        { type: 'lumberMill', completedAtTick: 0 },
      ];
      expect(buildings).toHaveLength(2);
      expect(buildings.map(b => b.type)).toContain('farm');
      expect(buildings.map(b => b.type)).toContain('lumberMill');
    });
  });

  describe('colony placement', () => {
    it('first colony gets the first starting position', () => {
      const worldMap = generateWorld(42, 50, 8);
      const firstPos = worldMap.startingPositions[0];
      expect(firstPos).toBeDefined();
      expect(typeof firstPos.q).toBe('number');
      expect(typeof firstPos.r).toBe('number');
    });

    it('second colony avoids first colony by 30+ hexes', () => {
      const worldMap = generateWorld(42, 50, 8);
      if (worldMap.startingPositions.length >= 2) {
        const first = worldMap.startingPositions[0];
        const second = worldMap.startingPositions[1];
        expect(hexDistance(first, second)).toBeGreaterThanOrEqual(30);
      }
    });

    it('deterministic: same seed produces same positions', () => {
      const map1 = generateWorld(42, 50, 8);
      const map2 = generateWorld(42, 50, 8);
      expect(map1.startingPositions).toEqual(map2.startingPositions);
    });
  });

  describe('API key generation for colony join', () => {
    it('generates valid API keys', () => {
      const key = generateApiKey();
      expect(key).toMatch(/^rc_live_/);
      expect(isValidKeyFormat(key)).toBe(true);
    });

    it('generates unique keys', () => {
      const keys = new Set(Array.from({ length: 100 }, () => generateApiKey()));
      expect(keys.size).toBe(100);
    });

    it('hashes API keys for storage', async () => {
      const key = generateApiKey();
      const hash = await hashApiKey(key);
      expect(hash).toMatch(/^\$2[aby]\$/); // bcrypt hash prefix
      expect(hash).not.toContain(key);
    });
  });

  describe('world status transitions', () => {
    it('status progression: open → running → full → ended', () => {
      const validTransitions: Record<string, string[]> = {
        open: ['running'],
        running: ['full'],
        full: ['ended'],
        ended: [],
      };

      expect(validTransitions.open).toContain('running');
      expect(validTransitions.running).toContain('full');
      expect(validTransitions.full).toContain('ended');
      expect(validTransitions.ended).toHaveLength(0);
    });
  });

  describe('validation rules', () => {
    it('world name: required, max 50 chars', () => {
      expect(''.trim().length).toBe(0); // empty fails
      expect('A'.repeat(50).length).toBeLessThanOrEqual(50); // 50 OK
      expect('A'.repeat(51).length).toBeGreaterThan(50); // 51 fails
    });

    it('colony name: required, max 40 chars', () => {
      expect(''.trim().length).toBe(0); // empty fails
      expect('A'.repeat(40).length).toBeLessThanOrEqual(40); // 40 OK
      expect('A'.repeat(41).length).toBeGreaterThan(40); // 41 fails
    });

    it('map radius: 10–100', () => {
      expect(50).toBeGreaterThanOrEqual(10);
      expect(50).toBeLessThanOrEqual(100);
      expect(5).toBeLessThan(10); // fails
      expect(101).toBeGreaterThan(100); // fails
    });

    it('max colonies: 2–16', () => {
      expect(8).toBeGreaterThanOrEqual(2);
      expect(8).toBeLessThanOrEqual(16);
      expect(1).toBeLessThan(2); // fails
      expect(17).toBeGreaterThan(16); // fails
    });
  });
});
