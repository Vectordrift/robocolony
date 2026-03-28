import { describe, it, expect } from 'vitest';
import { getTableName, getTableColumns } from 'drizzle-orm';
import { worlds } from '../worlds.js';
import { starSystems } from '../starSystems.js';
import { hexes } from '../hexes.js';
import { colonies } from '../colonies.js';
import { settlements } from '../settlements.js';
import { units } from '../units.js';
import { actions } from '../actions.js';
import { agreements } from '../agreements.js';
import { messages } from '../messages.js';
import { events } from '../events.js';
import { feedbackReports } from '../feedbackReports.js';

describe('Database schema', () => {
  describe('worlds table', () => {
    it('has correct table name', () => {
      expect(getTableName(worlds)).toBe('worlds');
    });

    it('has all required columns', () => {
      const cols = getTableColumns(worlds);
      expect(cols).toHaveProperty('id');
      expect(cols).toHaveProperty('name');
      expect(cols).toHaveProperty('tickRate');
      expect(cols).toHaveProperty('currentTick');
      expect(cols).toHaveProperty('mapSeed');
      expect(cols).toHaveProperty('status');
      expect(cols).toHaveProperty('mapRadius');
      expect(cols).toHaveProperty('maxColonies');
      expect(cols).toHaveProperty('starSystemId');
      expect(cols).toHaveProperty('theaterType');
      expect(cols).toHaveProperty('orbitalSlot');
      expect(cols).toHaveProperty('createdAt');
    });
  });

  describe('star_systems table', () => {
    it('has correct table name', () => {
      expect(getTableName(starSystems)).toBe('star_systems');
    });

    it('has all required columns', () => {
      const cols = getTableColumns(starSystems);
      expect(cols).toHaveProperty('id');
      expect(cols).toHaveProperty('name');
      expect(cols).toHaveProperty('status');
      expect(cols).toHaveProperty('importance');
      expect(cols).toHaveProperty('positionX');
      expect(cols).toHaveProperty('positionY');
      expect(cols).toHaveProperty('claimants');
      expect(cols).toHaveProperty('neighborSystemIds');
      expect(cols).toHaveProperty('metadata');
      expect(cols).toHaveProperty('createdAt');
    });
  });

  describe('hexes table', () => {
    it('has correct table name', () => {
      expect(getTableName(hexes)).toBe('hexes');
    });

    it('has all required columns', () => {
      const cols = getTableColumns(hexes);
      expect(cols).toHaveProperty('worldId');
      expect(cols).toHaveProperty('x');
      expect(cols).toHaveProperty('y');
      expect(cols).toHaveProperty('terrain');
      expect(cols).toHaveProperty('resources');
      expect(cols).toHaveProperty('settlementId');
      expect(cols).toHaveProperty('exploredBy');
    });
  });

  describe('colonies table', () => {
    it('has correct table name', () => {
      expect(getTableName(colonies)).toBe('colonies');
    });

    it('has all required columns', () => {
      const cols = getTableColumns(colonies);
      expect(cols).toHaveProperty('id');
      expect(cols).toHaveProperty('worldId');
      expect(cols).toHaveProperty('name');
      expect(cols).toHaveProperty('apiKeyHash');
      expect(cols).toHaveProperty('resources');
      expect(cols).toHaveProperty('legacyScore');
      expect(cols).toHaveProperty('status');
      expect(cols).toHaveProperty('createdAt');
    });
  });

  describe('settlements table', () => {
    it('has correct table name', () => {
      expect(getTableName(settlements)).toBe('settlements');
    });

    it('has all required columns', () => {
      const cols = getTableColumns(settlements);
      expect(cols).toHaveProperty('id');
      expect(cols).toHaveProperty('colonyId');
      expect(cols).toHaveProperty('worldId');
      expect(cols).toHaveProperty('name');
      expect(cols).toHaveProperty('hexX');
      expect(cols).toHaveProperty('hexY');
      expect(cols).toHaveProperty('tier');
      expect(cols).toHaveProperty('buildings');
      expect(cols).toHaveProperty('buildQueue');
      expect(cols).toHaveProperty('loyalty');
      expect(cols).toHaveProperty('population');
    });
  });

  describe('units table', () => {
    it('has correct table name', () => {
      expect(getTableName(units)).toBe('units');
    });

    it('has all required columns', () => {
      const cols = getTableColumns(units);
      expect(cols).toHaveProperty('id');
      expect(cols).toHaveProperty('colonyId');
      expect(cols).toHaveProperty('worldId');
      expect(cols).toHaveProperty('type');
      expect(cols).toHaveProperty('hexX');
      expect(cols).toHaveProperty('hexY');
      expect(cols).toHaveProperty('health');
      expect(cols).toHaveProperty('morale');
      expect(cols).toHaveProperty('movementQueue');
    });
  });

  describe('actions table', () => {
    it('has correct table name', () => {
      expect(getTableName(actions)).toBe('actions');
    });

    it('has all required columns', () => {
      const cols = getTableColumns(actions);
      expect(cols).toHaveProperty('id');
      expect(cols).toHaveProperty('worldId');
      expect(cols).toHaveProperty('colonyId');
      expect(cols).toHaveProperty('tick');
      expect(cols).toHaveProperty('type');
      expect(cols).toHaveProperty('params');
      expect(cols).toHaveProperty('status');
      expect(cols).toHaveProperty('result');
      expect(cols).toHaveProperty('createdAt');
    });
  });

  describe('agreements table', () => {
    it('has correct table name', () => {
      expect(getTableName(agreements)).toBe('agreements');
    });

    it('has all required columns', () => {
      const cols = getTableColumns(agreements);
      expect(cols).toHaveProperty('id');
      expect(cols).toHaveProperty('worldId');
      expect(cols).toHaveProperty('type');
      expect(cols).toHaveProperty('proposedBy');
      expect(cols).toHaveProperty('proposedTo');
      expect(cols).toHaveProperty('status');
      expect(cols).toHaveProperty('terms');
      expect(cols).toHaveProperty('proposedAtTick');
      expect(cols).toHaveProperty('acceptedAtTick');
    });
  });

  describe('messages table', () => {
    it('has correct table name', () => {
      expect(getTableName(messages)).toBe('messages');
    });

    it('has all required columns', () => {
      const cols = getTableColumns(messages);
      expect(cols).toHaveProperty('id');
      expect(cols).toHaveProperty('worldId');
      expect(cols).toHaveProperty('fromColony');
      expect(cols).toHaveProperty('toColony');
      expect(cols).toHaveProperty('sentAtTick');
      expect(cols).toHaveProperty('deliveredAtTick');
      expect(cols).toHaveProperty('content');
      expect(cols).toHaveProperty('read');
    });
  });

  describe('events table', () => {
    it('has correct table name', () => {
      expect(getTableName(events)).toBe('events');
    });

    it('has all required columns', () => {
      const cols = getTableColumns(events);
      expect(cols).toHaveProperty('id');
      expect(cols).toHaveProperty('worldId');
      expect(cols).toHaveProperty('tick');
      expect(cols).toHaveProperty('type');
      expect(cols).toHaveProperty('public');
      expect(cols).toHaveProperty('visibility');
      expect(cols).toHaveProperty('data');
      expect(cols).toHaveProperty('publicData');
    });
  });

  describe('feedback_reports table', () => {
    it('has correct table name', () => {
      expect(getTableName(feedbackReports)).toBe('feedback_reports');
    });

    it('has all required columns', () => {
      const cols = getTableColumns(feedbackReports);
      expect(cols).toHaveProperty('id');
      expect(cols).toHaveProperty('worldId');
      expect(cols).toHaveProperty('colonyId');
      expect(cols).toHaveProperty('reporterName');
      expect(cols).toHaveProperty('type');
      expect(cols).toHaveProperty('title');
      expect(cols).toHaveProperty('description');
      expect(cols).toHaveProperty('tick');
      expect(cols).toHaveProperty('metadata');
      expect(cols).toHaveProperty('createdAt');
    });
  });

  it('all 11 tables are defined', () => {
    const tables = [worlds, starSystems, hexes, colonies, settlements, units, actions, agreements, messages, events, feedbackReports];
    expect(tables).toHaveLength(11);
    tables.forEach(t => expect(getTableName(t)).toBeTruthy());
  });
});
