import { describe, expect, it } from 'vitest';
import { buildPublicData, findRemovedUnitIds } from '../scheduler.js';

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
