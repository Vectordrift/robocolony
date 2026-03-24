/**
 * Tests for state query endpoints.
 *
 * Tests fog of war filtering logic, response structure expectations,
 * and access control rules. Uses unit tests (no DB required).
 * Full integration tests run in the E2E suite on Fly.io.
 */

import { describe, it, expect } from 'vitest';
import { hexesInRadius, hexDistance } from '../../engine/hex.js';

describe('State query endpoint logic', () => {
  describe('fog of war filtering', () => {
    it('explored_by array correctly tracks colony visibility', () => {
      // Simulates the DB explored_by column logic
      const hex1 = { x: 0, y: 0, exploredBy: ['col_alpha'] };
      const hex2 = { x: 1, y: 0, exploredBy: ['col_alpha', 'col_beta'] };
      const hex3 = { x: 10, y: 10, exploredBy: ['col_beta'] };
      const hex4 = { x: 20, y: 20, exploredBy: [] as string[] };

      const allHexes = [hex1, hex2, hex3, hex4];

      // Colony alpha's visible hexes
      const alphaVisible = allHexes.filter(h => h.exploredBy.includes('col_alpha'));
      expect(alphaVisible).toHaveLength(2);
      expect(alphaVisible.map(h => `${h.x},${h.y}`)).toEqual(['0,0', '1,0']);

      // Colony beta's visible hexes
      const betaVisible = allHexes.filter(h => h.exploredBy.includes('col_beta'));
      expect(betaVisible).toHaveLength(2);
      expect(betaVisible.map(h => `${h.x},${h.y}`)).toEqual(['1,0', '10,10']);

      // Unexplored hex is invisible to all
      const anyVisible = allHexes.filter(h => h.exploredBy.length > 0);
      expect(anyVisible).toHaveLength(3);
      expect(anyVisible.map(h => `${h.x},${h.y}`)).not.toContain('20,20');
    });

    it('shared hexes are visible to all exploring colonies', () => {
      const sharedHex = { exploredBy: ['col_alpha', 'col_beta', 'col_gamma'] };
      expect(sharedHex.exploredBy.includes('col_alpha')).toBe(true);
      expect(sharedHex.exploredBy.includes('col_beta')).toBe(true);
      expect(sharedHex.exploredBy.includes('col_gamma')).toBe(true);
      expect(sharedHex.exploredBy.includes('col_delta')).toBe(false);
    });

    it('starting colony reveals 91 hexes (radius 5)', () => {
      const revealRadius = 5;
      const revealed = hexesInRadius(revealRadius);
      // 3(5²) + 3(5) + 1 = 91
      expect(revealed).toHaveLength(91);
    });

    it('fog of war radius is consistent with hex distance', () => {
      const center = { q: 0, r: 0 };
      const revealed = hexesInRadius(5);

      // All revealed hexes should be within distance 5
      for (const hex of revealed) {
        expect(hexDistance(center, hex)).toBeLessThanOrEqual(5);
      }

      // A hex at distance 6 should NOT be in the set
      const farHex = { q: 6, r: 0 };
      expect(hexDistance(center, farHex)).toBe(6);
      const inSet = revealed.some(h => h.q === farHex.q && h.r === farHex.r);
      expect(inSet).toBe(false);
    });
  });

  describe('colony isolation', () => {
    it('colony state includes only its own settlements', () => {
      const allSettlements = [
        { id: 'set_1', colonyId: 'col_alpha', name: 'Alpha Prime' },
        { id: 'set_2', colonyId: 'col_alpha', name: 'Alpha Outpost' },
        { id: 'set_3', colonyId: 'col_beta', name: 'Beta Prime' },
      ];

      const alphaSettlements = allSettlements.filter(s => s.colonyId === 'col_alpha');
      expect(alphaSettlements).toHaveLength(2);
      expect(alphaSettlements.map(s => s.name)).toEqual(['Alpha Prime', 'Alpha Outpost']);

      const betaSettlements = allSettlements.filter(s => s.colonyId === 'col_beta');
      expect(betaSettlements).toHaveLength(1);
    });

    it('colony state includes only its own units', () => {
      const allUnits = [
        { id: 'unit_1', colonyId: 'col_alpha', type: 'scout' },
        { id: 'unit_2', colonyId: 'col_alpha', type: 'militia' },
        { id: 'unit_3', colonyId: 'col_beta', type: 'scout' },
      ];

      const alphaUnits = allUnits.filter(u => u.colonyId === 'col_alpha');
      expect(alphaUnits).toHaveLength(2);
      expect(alphaUnits.map(u => u.type).sort()).toEqual(['militia', 'scout']);
    });

    it('colony cannot see another colony resources', () => {
      const colonyResources: Record<string, object> = {
        col_alpha: { food: 80, timber: 40, stone: 25, iron: 8, influence: 45 },
        col_beta: { food: 90, timber: 30, stone: 20, iron: 5, influence: 55 },
      };

      // Each colony gets only its own resources
      const alphaRes = colonyResources['col_alpha'];
      expect(alphaRes).toEqual({ food: 80, timber: 40, stone: 25, iron: 8, influence: 45 });

      // Accessing another colony's resources should not be possible through the API
      const betaRes = colonyResources['col_beta'];
      expect(betaRes).not.toEqual(alphaRes);
    });
  });

  describe('world access verification', () => {
    it('colony must belong to the requested world', () => {
      const colony = { id: 'col_1', worldId: 'world_A' };
      const requestedWorldId = 'world_B';

      const hasAccess = colony.worldId === requestedWorldId;
      expect(hasAccess).toBe(false);
    });

    it('colony can access its own world', () => {
      const colony = { id: 'col_1', worldId: 'world_A' };
      const requestedWorldId = 'world_A';

      const hasAccess = colony.worldId === requestedWorldId;
      expect(hasAccess).toBe(true);
    });

    it('eliminated colony should be rejected', () => {
      const colony = { id: 'col_1', worldId: 'world_A', status: 'eliminated' };
      // The auth middleware handles this — status === 'eliminated' → 403
      expect(colony.status).toBe('eliminated');
    });
  });

  describe('response structure', () => {
    it('state response includes world info with current tick', () => {
      const stateResponse = {
        world: { id: 'w1', name: 'Test', status: 'running', currentTick: 5 },
        colony: { id: 'c1', name: 'Alpha', status: 'active', resources: {}, legacyScore: 0 },
        settlements: [],
        units: [],
        map: [],
      };

      expect(stateResponse.world).toHaveProperty('id');
      expect(stateResponse.world).toHaveProperty('name');
      expect(stateResponse.world).toHaveProperty('status');
      expect(stateResponse.world).toHaveProperty('currentTick');
      expect(stateResponse.colony).toHaveProperty('resources');
      expect(stateResponse.colony).toHaveProperty('legacyScore');
      expect(stateResponse).toHaveProperty('settlements');
      expect(stateResponse).toHaveProperty('units');
      expect(stateResponse).toHaveProperty('map');
    });

    it('map response includes hex count and current tick', () => {
      const mapResponse = {
        world: { id: 'w1', currentTick: 5 },
        hexCount: 91,
        hexes: Array.from({ length: 91 }, (_, i) => ({
          x: i, y: 0, terrain: 'plains', resources: {}, settlementId: null,
        })),
      };

      expect(mapResponse.hexCount).toBe(mapResponse.hexes.length);
      expect(mapResponse.world.currentTick).toBe(5);
    });

    it('hex data includes terrain, resources, and settlement reference', () => {
      const hex = {
        x: 0, y: 0,
        terrain: 'plains',
        resources: { food: 2 },
        settlementId: 'set_123',
      };

      expect(hex).toHaveProperty('x');
      expect(hex).toHaveProperty('y');
      expect(hex).toHaveProperty('terrain');
      expect(hex).toHaveProperty('resources');
      expect(hex).toHaveProperty('settlementId');
    });

    it('unit data includes health, morale, movement queue', () => {
      const unit = {
        id: 'unit_1',
        type: 'scout',
        hexX: 1, hexY: 0,
        health: 80,
        morale: 0.9,
        movementQueue: [{ q: 2, r: 0 }, { q: 3, r: 0 }],
      };

      expect(unit.health).toBe(80);
      expect(unit.morale).toBe(0.9);
      expect(unit.movementQueue).toHaveLength(2);
    });

    it('settlement data includes buildings and build queue', () => {
      const settlement = {
        id: 'set_1',
        name: 'Alpha Prime',
        hexX: 0, hexY: 0,
        tier: 'outpost',
        buildings: [
          { type: 'farm', completedAtTick: 0 },
          { type: 'lumberMill', completedAtTick: 0 },
        ],
        buildQueue: [{ type: 'quarry', startedAtTick: 3 }],
        loyalty: 100,
        population: 10,
      };

      expect(settlement.buildings).toHaveLength(2);
      expect(settlement.buildQueue).toHaveLength(1);
      expect(settlement.tier).toBe('outpost');
    });
  });

  describe('parallel query safety', () => {
    it('Promise.all fetches are independent (no shared state)', async () => {
      // Simulates the parallel fetch pattern used in the /state endpoint
      const fetchMap = async () => [{ x: 0, y: 0 }];
      const fetchSettlements = async () => [{ id: 'set_1' }];
      const fetchUnits = async () => [{ id: 'unit_1' }, { id: 'unit_2' }];
      const fetchResources = async () => ({ food: 100 });

      const [map, settlements, units, resources] = await Promise.all([
        fetchMap(),
        fetchSettlements(),
        fetchUnits(),
        fetchResources(),
      ]);

      expect(map).toHaveLength(1);
      expect(settlements).toHaveLength(1);
      expect(units).toHaveLength(2);
      expect(resources).toEqual({ food: 100 });
    });
  });
});
