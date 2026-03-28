import { describe, expect, it } from 'vitest';
import { eventVisibility } from '../scheduler.js';

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
