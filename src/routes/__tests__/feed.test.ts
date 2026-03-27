import { describe, expect, it } from 'vitest';
import { buildSpectatorRecap, type SpectatorFeedEvent } from '../feed.js';

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
