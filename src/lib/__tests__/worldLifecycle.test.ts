import { describe, expect, it } from 'vitest';
import {
  ACTIVE_WORLD_STATUSES,
  buildWorldSnapshot,
  canTransitionWorldStatus,
  canWorldRunScheduler,
  deriveResumeStatus,
} from '../worldLifecycle.js';

describe('world lifecycle helpers', () => {
  it('treats open, running, and full worlds as scheduler-active', () => {
    expect(ACTIVE_WORLD_STATUSES).toEqual(['open', 'running', 'full']);
    expect(canWorldRunScheduler('open')).toBe(true);
    expect(canWorldRunScheduler('running')).toBe(true);
    expect(canWorldRunScheduler('full')).toBe(true);
    expect(canWorldRunScheduler('paused')).toBe(false);
    expect(canWorldRunScheduler('archived')).toBe(false);
  });

  it('allows lifecycle transitions that preserve pause/resume safety', () => {
    expect(canTransitionWorldStatus('open', 'paused')).toBe(true);
    expect(canTransitionWorldStatus('running', 'paused')).toBe(true);
    expect(canTransitionWorldStatus('full', 'paused')).toBe(true);
    expect(canTransitionWorldStatus('paused', 'full')).toBe(true);
    expect(canTransitionWorldStatus('archived', 'running')).toBe(false);
  });

  it('derives resume status from suspended status and colony count', () => {
    expect(deriveResumeStatus('full', 8)).toBe('full');
    expect(deriveResumeStatus('running', 3)).toBe('running');
    expect(deriveResumeStatus('open', 0)).toBe('open');
    expect(deriveResumeStatus(null, 2)).toBe('running');
  });

  it('builds world snapshots with stable envelope metadata', () => {
    const snapshot = buildWorldSnapshot({
      world: { id: 'world-1' },
      starSystem: null,
      sectors: [],
      starLanes: [],
      colonies: [],
      settlements: [],
      units: [],
      hexes: [],
      actions: [],
      agreements: [],
      messages: [],
      events: [],
      feedbackReports: [],
      fleets: [],
      orbitalAssets: [],
      governanceActors: [],
      actorDelegations: [],
    });

    expect(snapshot.schemaVersion).toBe(1);
    expect(snapshot.exportedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(snapshot.world).toEqual({ id: 'world-1' });
    expect(snapshot.starSystem).toBeNull();
  });
});
