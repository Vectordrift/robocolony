import { describe, expect, it } from 'vitest';
import { chooseStarterActions } from '../agentStarter.js';

describe('chooseStarterActions', () => {
  it('returns no actions for inactive colonies', () => {
    const actions = chooseStarterActions({
      colony: { status: 'eliminated', resources: { food: 100, timber: 100 } },
      settlements: [],
      units: [],
    });

    expect(actions).toEqual([]);
  });

  it('prefers building a farm when the colony has no existing farm', () => {
    const actions = chooseStarterActions({
      colony: { status: 'active', resources: { food: 50, timber: 25 } },
      settlements: [{
        id: 'set_1',
        name: 'Alpha',
        buildings: [],
        buildQueue: [],
      }],
      units: [],
    });

    expect(actions).toContainEqual({
      type: 'build',
      params: { settlementId: 'set_1', buildingType: 'farm' },
    });
  });

  it('does not queue a farm if one already exists or is under construction', () => {
    const builtFarm = chooseStarterActions({
      colony: { status: 'active', resources: { food: 50, timber: 25 } },
      settlements: [{
        id: 'set_1',
        name: 'Alpha',
        buildings: [{ type: 'farm', level: 1 }],
        buildQueue: [],
      }],
      units: [],
    });

    const queuedFarm = chooseStarterActions({
      colony: { status: 'active', resources: { food: 50, timber: 25 } },
      settlements: [{
        id: 'set_1',
        name: 'Alpha',
        buildings: [],
        buildQueue: [{ type: 'farm', ticksRemaining: 2 }],
      }],
      units: [],
    });

    expect(builtFarm.find((action) => action.type === 'build')).toBeUndefined();
    expect(queuedFarm.find((action) => action.type === 'build')).toBeUndefined();
  });

  it('queues explore for an idle scout', () => {
    const actions = chooseStarterActions({
      colony: { status: 'active', resources: { food: 5, timber: 0 } },
      settlements: [],
      units: [{ id: 'u1', type: 'scout', movementQueue: [] }],
    });

    expect(actions).toContainEqual({
      type: 'explore',
      params: { unitId: 'u1' },
    });
  });

  it('does not queue explore for a scout that is already moving', () => {
    const actions = chooseStarterActions({
      colony: { status: 'active', resources: { food: 5, timber: 0 } },
      settlements: [],
      units: [{ id: 'u1', type: 'scout', movementQueue: [{ x: 1, y: 0 }] }],
    });

    expect(actions.find((action) => action.type === 'explore')).toBeUndefined();
  });

  it('queues scout training while scout count is still low', () => {
    const actions = chooseStarterActions({
      colony: { status: 'active', resources: { food: 20, timber: 10 } },
      settlements: [{
        id: 'set_1',
        name: 'Alpha',
        buildings: [],
        buildQueue: [],
      }],
      units: [{ id: 'u1', type: 'scout', movementQueue: [] }],
    });

    expect(actions).toContainEqual({
      type: 'train_unit',
      params: { settlementId: 'set_1', unitType: 'scout' },
    });
  });
});
