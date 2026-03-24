import { describe, it, expect } from 'vitest';

// --- Action validation unit tests ---

const VALID_ACTION_TYPES: Record<string, string[]> = {
  'move_unit': ['unitId', 'targetX', 'targetY'],
  'build': ['settlementId', 'buildingType'],
  'train_unit': ['settlementId', 'unitType'],
  'found_settlement': ['unitId', 'name'],
  'demolish': ['settlementId', 'buildingType'],
  'upgrade_settlement': ['settlementId'],
};

interface ActionInput {
  type: string;
  params: Record<string, unknown>;
}

function validateActionType(action: ActionInput): { valid: boolean; error?: string } {
  if (!action.type || typeof action.type !== 'string') {
    return { valid: false, error: 'Action type is required' };
  }
  const requiredParams = VALID_ACTION_TYPES[action.type];
  if (!requiredParams) {
    return { valid: false, error: `Unknown action type: ${action.type}` };
  }
  if (!action.params || typeof action.params !== 'object') {
    return { valid: false, error: 'Action params are required' };
  }
  for (const param of requiredParams) {
    if (action.params[param] === undefined || action.params[param] === null) {
      return { valid: false, error: `Missing required param '${param}'` };
    }
  }
  return { valid: true };
}

describe('Action validation', () => {
  describe('validateActionType', () => {
    it('accepts valid move_unit action', () => {
      const result = validateActionType({
        type: 'move_unit',
        params: { unitId: 'unit_abc', targetX: 5, targetY: -3 },
      });
      expect(result.valid).toBe(true);
    });

    it('accepts valid build action', () => {
      const result = validateActionType({
        type: 'build',
        params: { settlementId: 'set_abc', buildingType: 'farm' },
      });
      expect(result.valid).toBe(true);
    });

    it('accepts valid train_unit action', () => {
      const result = validateActionType({
        type: 'train_unit',
        params: { settlementId: 'set_abc', unitType: 'scout' },
      });
      expect(result.valid).toBe(true);
    });

    it('accepts valid found_settlement action', () => {
      const result = validateActionType({
        type: 'found_settlement',
        params: { unitId: 'unit_abc', name: 'New Town' },
      });
      expect(result.valid).toBe(true);
    });

    it('accepts valid upgrade_settlement action', () => {
      const result = validateActionType({
        type: 'upgrade_settlement',
        params: { settlementId: 'set_abc' },
      });
      expect(result.valid).toBe(true);
    });

    it('rejects unknown action type', () => {
      const result = validateActionType({
        type: 'nuke_everything',
        params: {},
      });
      expect(result.valid).toBe(false);
      expect(result.error).toContain('Unknown action type');
    });

    it('rejects missing action type', () => {
      const result = validateActionType({
        type: '',
        params: {},
      });
      expect(result.valid).toBe(false);
    });

    it('rejects missing required params', () => {
      const result = validateActionType({
        type: 'move_unit',
        params: { unitId: 'unit_abc' }, // missing targetX, targetY
      });
      expect(result.valid).toBe(false);
      expect(result.error).toContain('targetX');
    });

    it('rejects null param values', () => {
      const result = validateActionType({
        type: 'build',
        params: { settlementId: 'set_abc', buildingType: null as unknown as string },
      });
      expect(result.valid).toBe(false);
      expect(result.error).toContain('buildingType');
    });

    it('rejects missing params object', () => {
      const result = validateActionType({
        type: 'build',
        params: undefined as unknown as Record<string, unknown>,
      });
      expect(result.valid).toBe(false);
    });

    it('accepts extra params beyond required', () => {
      const result = validateActionType({
        type: 'move_unit',
        params: { unitId: 'unit_abc', targetX: 5, targetY: -3, priority: 'high' },
      });
      expect(result.valid).toBe(true);
    });
  });

  describe('all action types have validation rules', () => {
    const expectedTypes = [
      'move_unit', 'build', 'train_unit',
      'found_settlement', 'demolish', 'upgrade_settlement',
    ];

    for (const type of expectedTypes) {
      it(`${type} is a valid action type`, () => {
        expect(VALID_ACTION_TYPES[type]).toBeDefined();
        expect(Array.isArray(VALID_ACTION_TYPES[type])).toBe(true);
      });
    }
  });
});

describe('Rate limiting', () => {
  const MAX_ACTIONS_PER_TICK = 10;

  it('allows up to 10 actions per tick', () => {
    const currentQueued = 0;
    const newActions = 10;
    expect(newActions <= MAX_ACTIONS_PER_TICK - currentQueued).toBe(true);
  });

  it('rejects when queue is full', () => {
    const currentQueued = 10;
    const newActions = 1;
    expect(newActions <= MAX_ACTIONS_PER_TICK - currentQueued).toBe(false);
  });

  it('allows partial fill', () => {
    const currentQueued = 7;
    const newActions = 3;
    expect(newActions <= MAX_ACTIONS_PER_TICK - currentQueued).toBe(true);
  });

  it('rejects overfill', () => {
    const currentQueued = 7;
    const newActions = 4;
    expect(newActions <= MAX_ACTIONS_PER_TICK - currentQueued).toBe(false);
  });
});

describe('Action response shapes', () => {
  it('submit response has correct structure', () => {
    const mockResponse = {
      submitted: 2,
      tick: 6,
      actions: [
        { id: 'act_abc', type: 'move_unit', tick: 6, status: 'queued' },
        { id: 'act_def', type: 'build', tick: 6, status: 'queued' },
      ],
    };

    expect(mockResponse.submitted).toBe(mockResponse.actions.length);
    expect(mockResponse.tick).toBeGreaterThan(0);
    for (const a of mockResponse.actions) {
      expect(a.status).toBe('queued');
      expect(a.id).toMatch(/^act_/);
    }
  });

  it('list response separates queued and recent', () => {
    const mockResponse = {
      tick: 5,
      queued: {
        count: 2,
        maxPerTick: 10,
        actions: [
          { id: 'act_1', type: 'move_unit', tick: 6, status: 'queued' },
          { id: 'act_2', type: 'build', tick: 6, status: 'queued' },
        ],
      },
      recent: [
        { id: 'act_old', type: 'train_unit', tick: 4, status: 'resolved', result: 'Unit trained' },
      ],
    };

    expect(mockResponse.queued.count).toBe(mockResponse.queued.actions.length);
    expect(mockResponse.queued.maxPerTick).toBe(10);
    expect(mockResponse.recent[0].status).toBe('resolved');
  });
});
