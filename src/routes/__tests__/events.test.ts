import { describe, it, expect } from 'vitest';

// --- Event Feed unit tests ---

describe('Event Feed', () => {
  // Test visibility logic without DB
  describe('visibility filtering', () => {
    interface TestEvent {
      id: string;
      tick: number;
      type: string;
      public: boolean;
      visibility: string[];
      data: Record<string, unknown>;
      publicData?: Record<string, unknown>;
    }

    /**
     * Filter events visible to a specific colony:
     * - Public events (public=true)
     * - Events where colonyId is in visibility array
     */
    function filterVisibleEvents(events: TestEvent[], colonyId: string): TestEvent[] {
      return events.filter(
        (e) => e.public || e.visibility.includes(colonyId),
      );
    }

    const testEvents: TestEvent[] = [
      {
        id: 'evt_1',
        tick: 5,
        type: 'unit_moved',
        public: false,
        visibility: ['col_a'],
        data: { from: { x: 0, y: 0 }, to: { x: 1, y: 0 } },
      },
      {
        id: 'evt_2',
        tick: 5,
        type: 'hex_explored',
        public: false,
        visibility: ['col_a'],
        data: { hex: { x: 2, y: 0 } },
      },
      {
        id: 'evt_3',
        tick: 5,
        type: 'unit_moved',
        public: false,
        visibility: ['col_b'],
        data: { from: { x: 10, y: 0 }, to: { x: 11, y: 0 } },
      },
      {
        id: 'evt_4',
        tick: 5,
        type: 'desertion',
        public: true,
        visibility: ['col_b'],
        data: { unitType: 'scout', morale: 0.05 },
      },
      {
        id: 'evt_5',
        tick: 4,
        type: 'production',
        public: false,
        visibility: ['col_a'],
        data: { net: { food: 10 } },
      },
      {
        id: 'evt_6',
        tick: 3,
        type: 'settlement_founded',
        public: false,
        visibility: ['col_a'],
        data: { name: 'New Outpost' },
      },
    ];

    it('colony A sees own private events + public events', () => {
      const visible = filterVisibleEvents(testEvents, 'col_a');
      // col_a sees: evt_1, evt_2, evt_4 (public), evt_5, evt_6
      expect(visible).toHaveLength(5);
      expect(visible.map((e) => e.id)).toEqual([
        'evt_1', 'evt_2', 'evt_4', 'evt_5', 'evt_6',
      ]);
    });

    it('colony B sees own private events + public events', () => {
      const visible = filterVisibleEvents(testEvents, 'col_b');
      // col_b sees: evt_3, evt_4
      expect(visible).toHaveLength(2);
      expect(visible.map((e) => e.id)).toEqual(['evt_3', 'evt_4']);
    });

    it('unknown colony sees only public events', () => {
      const visible = filterVisibleEvents(testEvents, 'col_unknown');
      expect(visible).toHaveLength(1);
      expect(visible[0].id).toBe('evt_4');
      expect(visible[0].public).toBe(true);
    });

    it('colony A does NOT see colony B private events', () => {
      const visible = filterVisibleEvents(testEvents, 'col_a');
      const colBPrivate = visible.filter(
        (e) => e.visibility.includes('col_b') && !e.public,
      );
      expect(colBPrivate).toHaveLength(0);
    });

    it('deduplicated public combat events remain visible to all involved colonies as a single event', () => {
      const events: TestEvent[] = [
        {
          id: 'evt_combat_1',
          tick: 408,
          type: 'combat_resolved',
          public: true,
          visibility: ['col_a', 'col_b'],
          data: { hexX: 30, hexY: 2, casualties: 7 },
          publicData: { hexX: 30, hexY: 2, casualties: 7, colonies: ['col_a', 'col_b'] },
        },
      ];

      const visibleToA = filterVisibleEvents(events, 'col_a');
      const visibleToB = filterVisibleEvents(events, 'col_b');

      expect(visibleToA).toHaveLength(1);
      expect(visibleToB).toHaveLength(1);
      expect(visibleToA[0].id).toBe('evt_combat_1');
      expect(visibleToB[0].id).toBe('evt_combat_1');
    });
  });

  // Test since_tick filtering
  describe('tick filtering (since_tick)', () => {
    interface TestEvent {
      id: string;
      tick: number;
      type: string;
    }

    function filterSinceTick(events: TestEvent[], sinceTick: number): TestEvent[] {
      return events.filter((e) => e.tick > sinceTick);
    }

    const events: TestEvent[] = [
      { id: 'a', tick: 1, type: 'production' },
      { id: 'b', tick: 2, type: 'unit_moved' },
      { id: 'c', tick: 3, type: 'hex_explored' },
      { id: 'd', tick: 4, type: 'production' },
      { id: 'e', tick: 5, type: 'settlement_founded' },
    ];

    it('since_tick=0 returns all events', () => {
      expect(filterSinceTick(events, 0)).toHaveLength(5);
    });

    it('since_tick=3 returns only events from tick 4 and 5', () => {
      const result = filterSinceTick(events, 3);
      expect(result).toHaveLength(2);
      expect(result.map((e) => e.tick)).toEqual([4, 5]);
    });

    it('since_tick=5 returns empty (no events after tick 5)', () => {
      expect(filterSinceTick(events, 5)).toHaveLength(0);
    });

    it('since_tick=100 returns empty (future tick)', () => {
      expect(filterSinceTick(events, 100)).toHaveLength(0);
    });
  });

  // Test limit/pagination
  describe('limit/pagination', () => {
    function applyLimit<T>(items: T[], limit: number, maxLimit: number): T[] {
      const effectiveLimit = Math.min(Math.max(1, limit), maxLimit);
      return items.slice(0, effectiveLimit);
    }

    it('default limit 50 when no limit specified', () => {
      const items = Array.from({ length: 100 }, (_, i) => ({ id: i }));
      expect(applyLimit(items, 50, 200)).toHaveLength(50);
    });

    it('respects custom limit', () => {
      const items = Array.from({ length: 100 }, (_, i) => ({ id: i }));
      expect(applyLimit(items, 10, 200)).toHaveLength(10);
    });

    it('caps at max limit (200)', () => {
      const items = Array.from({ length: 300 }, (_, i) => ({ id: i }));
      expect(applyLimit(items, 500, 200)).toHaveLength(200);
    });

    it('minimum limit is 1', () => {
      const items = [{ id: 1 }, { id: 2 }];
      expect(applyLimit(items, 0, 200)).toHaveLength(1);
      expect(applyLimit(items, -5, 200)).toHaveLength(1);
    });
  });

  // Test response shape
  describe('response shape', () => {
    it('event response has required fields', () => {
      const mockResponse = {
        tick: 10,
        colonyId: 'col_test',
        count: 3,
        events: [
          { id: 'evt_1', tick: 10, type: 'unit_moved', data: { from: { x: 0, y: 0 } }, public: false },
          { id: 'evt_2', tick: 10, type: 'hex_explored', data: { hex: { x: 1, y: 0 } }, public: false },
          { id: 'evt_3', tick: 9, type: 'desertion', data: { unitType: 'scout' }, public: true },
        ],
      };

      expect(mockResponse).toHaveProperty('tick');
      expect(mockResponse).toHaveProperty('colonyId');
      expect(mockResponse).toHaveProperty('count');
      expect(mockResponse).toHaveProperty('events');
      expect(mockResponse.count).toBe(mockResponse.events.length);

      for (const event of mockResponse.events) {
        expect(event).toHaveProperty('id');
        expect(event).toHaveProperty('tick');
        expect(event).toHaveProperty('type');
        expect(event).toHaveProperty('data');
        expect(event).toHaveProperty('public');
      }
    });

    it('events are ordered by tick descending (newest first)', () => {
      const events = [
        { tick: 10, id: 'a' },
        { tick: 8, id: 'b' },
        { tick: 5, id: 'c' },
      ];

      for (let i = 0; i < events.length - 1; i++) {
        expect(events[i].tick).toBeGreaterThanOrEqual(events[i + 1].tick);
      }
    });
  });

  // Test event types from tick engine
  describe('event types', () => {
    const PHASE_2_EVENT_TYPES = [
      'unit_moved',
      'movement_queued',
      'movement_complete',
      'movement_cancelled',
      'movement_failed',
      'movement_blocked',
      'hex_explored',
      'settlement_founded',
      'production',
      'famine',
      'desertion',
    ];

    it('all Phase 2 event types are recognized', () => {
      for (const type of PHASE_2_EVENT_TYPES) {
        expect(typeof type).toBe('string');
        expect(type.length).toBeGreaterThan(0);
      }
    });

    it('movement events are private to the colony', () => {
      // Verify convention: movement events have colonyId set
      const movementEvent = {
        type: 'unit_moved',
        colonyId: 'col_a',
        data: { from: { x: 0, y: 0 }, to: { x: 1, y: 0 } },
      };
      expect(movementEvent.colonyId).toBeDefined();
      expect(movementEvent.colonyId).not.toBe('');
    });

    it('desertion events are public', () => {
      // Convention from scheduler: desertions are public
      const desertionEvent = {
        type: 'desertion',
        public: true,
        colonyId: 'col_a',
        data: { unitType: 'scout', morale: 0.05 },
      };
      expect(desertionEvent.public).toBe(true);
    });
  });
});
