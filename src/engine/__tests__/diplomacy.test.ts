import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CEASEFIRE_DURATION_TICKS,
  normalizeAgreementTerms,
  resolveAgreementActions,
  resolveCombat,
  resolveTradeTransfers,
  type Agreement,
  type Colony,
  type QueuedAction,
  type Unit,
} from '../tick.js';

function makeColony(overrides: Partial<Colony> = {}): Colony {
  return {
    id: 'colony-1',
    worldId: 'world-1',
    name: 'Test Colony',
    resources: { food: 100, timber: 100, stone: 100, iron: 100, influence: 100 },
    legacyScore: 0,
    status: 'active',
    ...overrides,
  };
}

function makeAction(overrides: Partial<QueuedAction> = {}): QueuedAction {
  return {
    id: 'action-1',
    colonyId: 'colony-1',
    type: 'propose_agreement',
    params: {
      targetColonyId: 'colony-2',
      agreementType: 'trade',
      terms: { gives: { food: 10 }, receives: { iron: 5 } },
    },
    ...overrides,
  };
}

function makeAgreement(overrides: Partial<Agreement> = {}): Agreement {
  return {
    id: 'agr-1',
    worldId: 'world-1',
    type: 'trade',
    proposedBy: 'colony-1',
    proposedTo: 'colony-2',
    status: 'active',
    terms: { gives: { food: 10 }, receives: { iron: 5 } },
    proposedAtTick: 1,
    acceptedAtTick: 2,
    ...overrides,
  };
}

function makeUnit(overrides: Partial<Unit> = {}): Unit {
  return {
    id: 'unit-1',
    colonyId: 'colony-1',
    worldId: 'world-1',
    type: 'militia',
    hexX: 0,
    hexY: 0,
    health: 100,
    morale: 1,
    movementQueue: [],
    ...overrides,
  };
}

describe('normalizeAgreementTerms', () => {
  it('normalizes ceasefire terms with a default duration', () => {
    const result = normalizeAgreementTerms('ceasefire', {});
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.terms).toEqual({ durationTicks: DEFAULT_CEASEFIRE_DURATION_TICKS });
    }
  });

  it('rejects malformed trade terms', () => {
    const result = normalizeAgreementTerms('trade', { gives: {}, receives: { iron: 5 } });
    expect(result.valid).toBe(false);
  });
});

describe('resolveAgreementActions', () => {
  it('creates a ceasefire agreement with normalized duration terms', () => {
    const colonies = [makeColony(), makeColony({ id: 'colony-2', name: 'Rival Colony' })];
    const action = makeAction({
      type: 'propose_agreement',
      params: { targetColonyId: 'colony-2', agreementType: 'ceasefire', terms: { durationTicks: 12 } },
    });

    const result = resolveAgreementActions(colonies, [], [action], 20, 'world-1');

    expect(result.actionResults[0]).toMatchObject({ status: 'resolved' });
    expect(result.mutations[0]?.agreement.type).toBe('ceasefire');
    expect(result.mutations[0]?.agreement.terms).toEqual({ durationTicks: 12 });
  });

  it('rejects invalid trade terms before creating an agreement', () => {
    const colonies = [makeColony(), makeColony({ id: 'colony-2', name: 'Rival Colony' })];
    const action = makeAction({
      params: {
        targetColonyId: 'colony-2',
        agreementType: 'trade',
        terms: { gives: { food: -5 }, receives: { iron: 5 } },
      },
    });

    const result = resolveAgreementActions(colonies, [], [action], 20, 'world-1');

    expect(result.actionResults[0]).toMatchObject({ status: 'failed' });
    expect(result.mutations).toHaveLength(0);
  });

  it('expires active ceasefires when their duration elapses', () => {
    const colonies = [makeColony(), makeColony({ id: 'colony-2', name: 'Rival Colony' })];
    const agreements = [
      makeAgreement({
        type: 'ceasefire',
        terms: { durationTicks: 5 },
        proposedBy: 'colony-1',
        proposedTo: 'colony-2',
      }),
    ];

    const result = resolveAgreementActions(colonies, agreements, [], 7, 'world-1');

    expect(result.mutations).toHaveLength(1);
    expect(result.mutations[0]?.agreement.status).toBe('broken');
    expect(result.events[0]?.type).toBe('agreement_broken');
  });
});

describe('resolveTradeTransfers', () => {
  it('honors trade interval terms', () => {
    const colonies = [
      makeColony({ id: 'colony-1', resources: { food: 100, timber: 0, stone: 0, iron: 0, influence: 0 } }),
      makeColony({ id: 'colony-2', resources: { food: 0, timber: 0, stone: 0, iron: 100, influence: 0 } }),
    ];
    const agreement = makeAgreement({
      terms: { gives: { food: 10 }, receives: { iron: 5 }, intervalTicks: 3 },
    });

    resolveTradeTransfers(colonies, [agreement], 4);
    expect(colonies[0].resources.food).toBe(100);
    expect(colonies[1].resources.iron).toBe(100);

    resolveTradeTransfers(colonies, [agreement], 6);
    expect(colonies[0].resources.food).toBe(90);
    expect(colonies[0].resources.iron).toBe(5);
    expect(colonies[1].resources.food).toBe(10);
    expect(colonies[1].resources.iron).toBe(95);
  });
});

describe('resolveCombat', () => {
  it('blocks combat for colonies with an active ceasefire', () => {
    const units = [
      makeUnit({ id: 'u1', colonyId: 'colony-1' }),
      makeUnit({ id: 'u2', colonyId: 'colony-2' }),
    ];
    const activeAgreements = [
      makeAgreement({
        type: 'ceasefire',
        proposedBy: 'colony-1',
        proposedTo: 'colony-2',
        terms: { durationTicks: 10 },
      }),
    ];

    const result = resolveCombat(units, [], undefined, activeAgreements);

    expect(result.events.some((event) => event.type === 'nap_blocked_combat')).toBe(true);
    expect(result.destroyedUnitIds).toHaveLength(0);
    expect(result.units.every((unit) => unit.health === 100)).toBe(true);
  });
});
