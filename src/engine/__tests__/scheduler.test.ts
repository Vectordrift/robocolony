import { describe, expect, it } from 'vitest';
import { buildPublicData, eventDedupKey, findRemovedUnitIds } from '../scheduler.js';

describe('buildPublicData', () => {
  it('keeps hex coordinates for public unit_destroyed events', () => {
    const data = buildPublicData({
      type: 'unit_destroyed',
      colonyId: 'colony-1',
      data: {
        unitType: 'soldier',
        hexX: 7,
        hexY: -2,
        cause: 'combat',
      },
    });

    expect(data).toEqual({
      unitType: 'soldier',
      hexX: 7,
      hexY: -2,
      cause: 'combat',
    });
  });
});

describe('findRemovedUnitIds', () => {
  it('returns units that no longer exist in the final tick result', () => {
    const removed = findRemovedUnitIds(
      [
        { id: 'unit-a' },
        { id: 'unit-b' },
        { id: 'unit-c' },
      ],
      [
        { id: 'unit-a' },
        { id: 'unit-c' },
        { id: 'unit-d' },
      ],
    );

    expect(removed).toEqual(['unit-b']);
  });
});

describe('eventDedupKey', () => {
  it('deduplicates identical stockpile decay events for the same colony/resource', () => {
    const event = {
      type: 'stockpile_decay',
      colonyId: 'colony-1',
      data: {
        resource: 'timber',
        decayed: 55.5,
        clamped: 38.5,
        cap: 3400,
        hardCeiling: 6800,
        remaining: 6783,
      },
    };

    const first = eventDedupKey(event, false);
    const second = eventDedupKey({ ...event, data: { ...event.data } }, false);

    expect(first).toBe(second);
  });

  it('does not deduplicate private combat events', () => {
    const event = {
      type: 'combat_resolved',
      colonyId: 'colony-1',
      data: {
        hexX: 7,
        hexY: -2,
        casualties: 3,
        winnerColony: 'colony-1',
      },
    };

    expect(eventDedupKey(event, false)).toBeNull();
    expect(eventDedupKey(event, true)).not.toBeNull();
  });

  it('deduplicates movement_blocked events by colony, hex, and reason', () => {
    const event = {
      type: 'movement_blocked',
      colonyId: 'colony-1',
      data: {
        hexX: 35,
        hexY: -20,
        reason: 'hex_full',
      },
    };

    const first = eventDedupKey(event, false);
    const second = eventDedupKey({ ...event, unitId: 'unit-2' } as typeof event & { unitId: string }, false);

    expect(first).toBe(second);
  });
});
