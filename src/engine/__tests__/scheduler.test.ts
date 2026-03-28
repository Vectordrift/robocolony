import { describe, expect, it } from 'vitest';
import { buildPublicData, eventVisibility } from '../scheduler.js';

describe('eventVisibility', () => {
  it('includes both agreement parties for private diplomacy events', () => {
    const visibility = eventVisibility({
      colonyId: 'colony-1',
      data: {
        agreementType: 'non_aggression',
        visibility: ['colony-1', 'colony-2'],
      },
    });

    expect(new Set(visibility)).toEqual(new Set(['colony-1', 'colony-2']));
  });
});

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
