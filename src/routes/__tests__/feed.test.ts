import { describe, expect, it } from 'vitest';
import { aggregateFeedEvents, buildSpectatorRecap, type SpectatorFeedEvent } from '../feed.js';

describe('buildSpectatorRecap', () => {
  it('summarizes a mixed public event window into a recap', () => {
    const events: SpectatorFeedEvent[] = [
      {
        id: 'evt-1',
        tick: 42,
        type: 'combat_resolved',
        colonyId: 'col_a',
        data: { hexX: 3, hexY: -1, casualties: 6, colonies: ['col_a', 'col_b'] },
      },
      {
        id: 'evt-2',
        tick: 41,
        type: 'settlement_founded',
        colonyId: 'col_b',
        data: { name: 'Northwatch', tier: 'outpost' },
      },
      {
        id: 'evt-3',
        tick: 40,
        type: 'research_complete',
        colonyId: 'col_a',
        data: { techName: 'Trade Routes' },
      },
      {
        id: 'evt-4',
        tick: 39,
        type: 'agreement_accepted',
        colonyId: 'col_b',
        data: { agreementType: 'ceasefire' },
      },
      {
        id: 'evt-5',
        tick: 38,
        type: 'poi_surveyed',
        colonyId: 'col_a',
        data: { poiType: 'watchtower', summary: 'Surveyed a watchtower.' },
      },
    ];

    const recap = buildSpectatorRecap(events, {
      col_a: 'Aurora',
      col_b: 'Bastion',
    });

    expect(recap.startTick).toBe(38);
    expect(recap.endTick).toBe(42);
    expect(recap.eventCount).toBe(5);
    expect(recap.summary).toContain('Ticks 38-42');
    expect(recap.highlights.length).toBeGreaterThan(0);
    expect(recap.highlights.join(' ')).toContain('Northwatch');
    expect(recap.highlights.join(' ')).toContain('Aurora');
  });

  it('returns a quiet recap when no public events exist', () => {
    const recap = buildSpectatorRecap([], {});

    expect(recap.startTick).toBeNull();
    expect(recap.endTick).toBeNull();
    expect(recap.eventCount).toBe(0);
    expect(recap.summary).toContain('Quiet frontier');
  });
});

describe('aggregateFeedEvents', () => {
  it('collapses repeated training events in the same tick and colony', () => {
    const events: SpectatorFeedEvent[] = [
      {
        id: 'evt-1',
        tick: 90,
        type: 'unit_trained',
        colonyId: 'col_a',
        data: { unitType: 'soldier' },
      },
      {
        id: 'evt-2',
        tick: 90,
        type: 'unit_trained',
        colonyId: 'col_a',
        data: { unitType: 'soldier' },
      },
      {
        id: 'evt-3',
        tick: 90,
        type: 'unit_trained',
        colonyId: 'col_a',
        data: { unitType: 'militia' },
      },
    ];

    const aggregated = aggregateFeedEvents(events);

    expect(aggregated).toHaveLength(2);
    expect(aggregated[0].groupedCount).toBe(2);
    expect(aggregated[0].summary).toContain('trained 2 soldiers');
    expect(aggregated[1].summary).toContain('trained 1 militia');
  });

  it('collapses zero-casualty combat spam on the same frontier location', () => {
    const events: SpectatorFeedEvent[] = [
      {
        id: 'evt-1',
        tick: 91,
        type: 'combat_resolved',
        colonyId: 'col_a',
        data: { hexX: 4, hexY: -2, attackerLosses: 0, defenderLosses: 0 },
      },
      {
        id: 'evt-2',
        tick: 91,
        type: 'combat_resolved',
        colonyId: 'col_a',
        data: { hexX: 4, hexY: -2, attackerLosses: 0, defenderLosses: 0 },
      },
      {
        id: 'evt-3',
        tick: 91,
        type: 'combat_resolved',
        colonyId: 'col_a',
        data: { hexX: 6, hexY: -2, attackerLosses: 1, defenderLosses: 0 },
      },
    ];

    const aggregated = aggregateFeedEvents(events);

    expect(aggregated).toHaveLength(2);
    expect(aggregated[0].importance).toBe('high');
    expect(aggregated[1].groupedCount).toBe(2);
    expect(aggregated[1].summary).toContain('2 clashes, no losses');
  });

  it('rolls lower-signal same-tick colony activity into a single summary row', () => {
    const events: SpectatorFeedEvent[] = [
      {
        id: 'evt-1',
        tick: 92,
        type: 'build_complete',
        colonyId: 'col_a',
        data: { buildingType: 'farm', level: 1 },
      },
      {
        id: 'evt-2',
        tick: 92,
        type: 'build_started',
        colonyId: 'col_a',
        data: { buildingType: 'lumber_mill', ticksRemaining: 3 },
      },
    ];

    const aggregated = aggregateFeedEvents(events);

    expect(aggregated).toHaveLength(1);
    expect(aggregated[0].type).toBe('tick_summary');
    expect(aggregated[0].groupedCount).toBe(2);
    expect(aggregated[0].summary).toContain('activity update');
    expect(aggregated[0].groupedTypes).toEqual(expect.arrayContaining(['build_complete', 'build_started']));
  });
});
