import { describe, expect, it } from 'vitest';
import { buildPublicData } from '../scheduler.js';

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
