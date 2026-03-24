/**
 * Tick scheduler — manages tick timing and persistence.
 *
 * Loads world state from the database, runs resolveTick, writes results back.
 * One scheduler instance per running world.
 */

import { eq, and } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../db/schema/index.js';
import { resolveTick } from './tick.js';
import type { Colony, Settlement, Unit, HexTileState, Resources, Building, QueuedAction } from './tick.js';
import { nanoid } from 'nanoid';

export interface SchedulerOptions {
  worldId: string;
  db: PostgresJsDatabase<typeof schema>;
  onTick?: (tick: number, events: unknown[]) => void;
  onError?: (error: Error) => void;
}

export class TickScheduler {
  private worldId: string;
  private db: PostgresJsDatabase<typeof schema>;
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;
  private onTick?: (tick: number, events: unknown[]) => void;
  private onError?: (error: Error) => void;

  constructor(options: SchedulerOptions) {
    this.worldId = options.worldId;
    this.db = options.db;
    this.onTick = options.onTick;
    this.onError = options.onError;
  }

  /**
   * Start the tick loop for a world.
   */
  async start(): Promise<void> {
    const [world] = await this.db
      .select()
      .from(schema.worlds)
      .where(eq(schema.worlds.id, this.worldId));

    if (!world) throw new Error(`World ${this.worldId} not found`);
    if (world.status !== 'running') throw new Error(`World ${this.worldId} is not running (status: ${world.status})`);

    this.timer = setInterval(() => {
      this.executeTick().catch((err) => {
        this.onError?.(err instanceof Error ? err : new Error(String(err)));
      });
    }, world.tickRate);
  }

  /**
   * Stop the tick loop.
   */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /**
   * Execute a single tick. Can be called directly for testing.
   */
  async executeTick(): Promise<void> {
    if (this.running) return; // skip if previous tick still processing
    this.running = true;

    try {
      // Load current state
      const [world] = await this.db
        .select()
        .from(schema.worlds)
        .where(eq(schema.worlds.id, this.worldId));

      if (!world || world.status !== 'running') {
        this.stop();
        return;
      }

      const newTick = world.currentTick + 1;

      const dbColonies = await this.db
        .select()
        .from(schema.colonies)
        .where(eq(schema.colonies.worldId, this.worldId));

      const dbSettlements = await this.db
        .select()
        .from(schema.settlements)
        .where(eq(schema.settlements.worldId, this.worldId));

      const dbUnits = await this.db
        .select()
        .from(schema.units)
        .where(eq(schema.units.worldId, this.worldId));

      const dbHexes = await this.db
        .select()
        .from(schema.hexes)
        .where(eq(schema.hexes.worldId, this.worldId));

      // Load queued actions for this tick
      const dbActions = await this.db
        .select()
        .from(schema.actions)
        .where(
          and(
            eq(schema.actions.worldId, this.worldId),
            eq(schema.actions.tick, newTick),
            eq(schema.actions.status, 'queued'),
          ),
        );

      // Map DB rows to tick engine types
      const colonies: Colony[] = dbColonies.map(c => ({
        id: c.id,
        worldId: c.worldId,
        name: c.name,
        resources: c.resources as Resources,
        status: c.status,
      }));

      const settlements: Settlement[] = dbSettlements.map(s => ({
        id: s.id,
        colonyId: s.colonyId,
        worldId: s.worldId,
        name: s.name,
        hexX: s.hexX,
        hexY: s.hexY,
        tier: s.tier as 'outpost' | 'town' | 'city',
        buildings: (s.buildings ?? []) as Building[],
        loyalty: s.loyalty,
        population: s.population,
      }));

      const units: Unit[] = dbUnits.map(u => ({
        id: u.id,
        colonyId: u.colonyId,
        worldId: u.worldId,
        type: u.type as Unit['type'],
        hexX: u.hexX,
        hexY: u.hexY,
        health: u.health,
        morale: u.morale,
        movementQueue: (u.movementQueue ?? []) as Unit['movementQueue'],
      }));

      const hexes: HexTileState[] = dbHexes.map(h => ({
        x: h.x,
        y: h.y,
        terrain: h.terrain,
        resources: (h.resources ?? { food: 0, timber: 0, stone: 0, iron: 0 }) as HexTileState['resources'],
        settlementId: h.settlementId,
      }));

      const queuedActions: QueuedAction[] = dbActions.map(a => ({
        id: a.id,
        colonyId: a.colonyId,
        type: a.type,
        params: a.params as Record<string, unknown>,
      }));

      // Resolve tick
      const result = resolveTick(colonies, settlements, units, hexes, queuedActions);

      // Persist results
      await this.db.transaction(async (tx) => {
        // Update world tick
        await tx
          .update(schema.worlds)
          .set({ currentTick: newTick })
          .where(eq(schema.worlds.id, this.worldId));

        // Update colony resources
        for (const colony of result.colonies) {
          await tx
            .update(schema.colonies)
            .set({ resources: colony.resources })
            .where(eq(schema.colonies.id, colony.id));
        }

        // Update units (morale, position, movementQueue)
        for (const unit of result.units) {
          await tx
            .update(schema.units)
            .set({
              morale: unit.morale,
              hexX: unit.hexX,
              hexY: unit.hexY,
              movementQueue: unit.movementQueue ?? [],
            })
            .where(eq(schema.units.id, unit.id));
        }

        // Delete deserted units
        for (const unitId of result.desertedUnitIds) {
          await tx
            .delete(schema.units)
            .where(eq(schema.units.id, unitId));
        }

        // Update action statuses
        for (const ar of result.actionResults) {
          await tx
            .update(schema.actions)
            .set({ status: ar.status, result: ar.result ?? null })
            .where(eq(schema.actions.id, ar.actionId));
        }

        // Mark any remaining queued actions as resolved (non-movement actions not yet handled)
        // This prevents them from being re-processed next tick
        const processedIds = new Set(result.actionResults.map(ar => ar.actionId));
        for (const action of dbActions) {
          if (!processedIds.has(action.id)) {
            await tx
              .update(schema.actions)
              .set({ status: 'resolved', result: 'Action type not yet implemented' })
              .where(eq(schema.actions.id, action.id));
          }
        }

        // Insert events
        for (const event of result.events) {
          await tx.insert(schema.events).values({
            id: nanoid(),
            worldId: this.worldId,
            tick: newTick,
            type: event.type,
            public: event.type === 'desertion', // desertions are visible to all
            visibility: event.colonyId ? [event.colonyId] : [],
            data: event.data,
          });
        }
      });

      this.onTick?.(newTick, result.events);
    } finally {
      this.running = false;
    }
  }
}
