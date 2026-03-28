/**
 * Tick scheduler — manages tick timing and persistence.
 *
 * Loads world state from the database, runs resolveTick, writes results back.
 * One scheduler instance per running world.
 */

import { eq, and, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../db/schema/index.js';
import { resolveTick } from './tick.js';
import type { Colony, Settlement, Unit, HexTileState, Resources, Building, BuildQueueEntry, QueuedAction, MessageRecord, ResearchQueueEntry, Agreement, AgreementMutation } from './tick.js';
import { hexDistance } from './hex.js';
import { nanoid } from 'nanoid';

/** How often (in ticks) to send compass signal events */
const COMPASS_SIGNAL_INTERVAL = 25;

/** Minimum ticks before first compass signal (let colonies establish first) */
const COMPASS_SIGNAL_START = 25;

/** Maximum time (ms) for a single tick to complete before being killed */
const TICK_TIMEOUT_MS = 60_000;

/** Event types visible on the public feed (spectator view) */
const PUBLIC_EVENT_TYPES = new Set([
  'settlement_founded',
  'build_complete',
  'unit_trained',
  'famine',
  'desertion',
  'settlement_upgraded',
  'combat_resolved',
  'unit_destroyed',
  'shortage',
  'research_complete',
  'agreement_accepted',
  'agreement_broken',
  'nap_blocked_combat',
  'poi_surveyed',
]);

/**
 * Build public-safe data for spectator feed.
 * Strips private info (exact resource amounts) but keeps the interesting bits.
 */
export function buildPublicData(event: { type: string; colonyId?: string; data: Record<string, unknown> }): Record<string, unknown> | null {
  switch (event.type) {
    case 'settlement_founded':
      return {
        name: event.data.name,
        tier: event.data.tier,
      };
    case 'settlement_upgraded':
      return {
        name: event.data.name,
        previousTier: event.data.previousTier,
        newTier: event.data.newTier,
      };
    case 'build_complete':
      return {
        buildingType: event.data.buildingType,
        level: event.data.level,
      };
    case 'unit_trained':
      return {
        unitType: event.data.unitType,
      };
    case 'famine':
      return {
        netFood: event.data.netFood,
        severity: event.data.severity,
      };
    case 'desertion':
      return {
        count: event.data.count,
        summary: event.data.summary,
      };
    case 'shortage':
      return {
        resource: event.data.resource,
        deficit: event.data.deficit,
      };
    case 'combat_resolved': {
      const participants = event.data.participants as Array<{ colonyId: string; destroyed: boolean }> | undefined;
      const colonyIds = participants ? [...new Set(participants.map(p => p.colonyId))] : [];
      return {
        hexX: event.data.hexX,
        hexY: event.data.hexY,
        colonies: colonyIds,
        casualties: event.data.casualties,
      };
    }
    case 'unit_destroyed':
      return {
        unitType: event.data.unitType,
        hexX: event.data.hexX,
        hexY: event.data.hexY,
        cause: event.data.cause || 'combat',
      };
    case 'research_complete':
      return {
        techName: event.data.techName,
        description: event.data.description,
      };
    case 'agreement_accepted':
      return {
        agreementType: event.data.agreementType,
      };
    case 'agreement_broken':
      return {
        agreementType: event.data.agreementType,
        brokenByName: event.data.brokenByName,
      };
    case 'nap_blocked_combat':
      return {
        hexX: event.data.hexX,
        hexY: event.data.hexY,
        reason: event.data.reason,
      };
    case 'poi_surveyed':
      return {
        poiType: event.data.poiType,
        x: event.data.x,
        y: event.data.y,
        summary: event.data.summary,
      };
    default:
      return null;
  }
}

function eventDedupKey(event: { type: string; data: Record<string, unknown> }): string | null {
  switch (event.type) {
    case 'combat_resolved':
      return JSON.stringify({
        type: event.type,
        hexX: event.data.hexX,
        hexY: event.data.hexY,
        casualties: event.data.casualties,
        winnerColony: event.data.winnerColony,
      });
    default:
      return null;
  }
}

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
  private tickStartedAt = 0;
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
    console.log(`[SCHEDULER] start() called for world ${this.worldId}`);
    const [world] = await this.db
      .select()
      .from(schema.worlds)
      .where(eq(schema.worlds.id, this.worldId));

    if (!world) throw new Error(`World ${this.worldId} not found`);
    if (world.status !== 'running' && world.status !== 'open') throw new Error(`World ${this.worldId} is not running (status: ${world.status})`);

    console.log(`[SCHEDULER] World found: ${world.name}, status=${world.status}, tickRate=${world.tickRate}ms, currentTick=${world.currentTick}`);

    // Fire first tick immediately, then schedule interval
    this.executeTick().catch((err) => {
      console.error(`[SCHEDULER] Initial tick error:`, err);
      this.onError?.(err instanceof Error ? err : new Error(String(err)));
    });

    this.timer = setInterval(() => {
      console.log(`[SCHEDULER] setInterval fired at ${new Date().toISOString()}`);
      this.executeTick().catch((err) => {
        console.error(`[SCHEDULER] Tick error in setInterval:`, err);
        this.onError?.(err instanceof Error ? err : new Error(String(err)));
      });
    }, world.tickRate);
    console.log(`[SCHEDULER] setInterval created with ${world.tickRate}ms interval`);
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
    console.log(`[TICK] executeTick() called at ${new Date().toISOString()}, running=${this.running}`);
    if (this.running) {
      // If a tick has been running for more than TICK_TIMEOUT_MS, force-reset
      const elapsed = Date.now() - this.tickStartedAt;
      if (elapsed > TICK_TIMEOUT_MS) {
        console.error(`[TICK] Force-resetting: stuck for ${elapsed}ms`);
        this.onError?.(new Error(`Tick stuck for ${elapsed}ms — force-resetting scheduler`));
        this.running = false;
      } else {
        console.log(`[TICK] Skipped: previous tick still running (${elapsed}ms)`);
        return; // previous tick still processing normally
      }
    }
    this.running = true;
    this.tickStartedAt = Date.now();

    try {
      // Load current state
      console.log(`[TICK] Loading world state...`);
      const [world] = await this.db
        .select()
        .from(schema.worlds)
        .where(eq(schema.worlds.id, this.worldId));

      if (!world || (world.status !== 'running' && world.status !== 'open')) {
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

      // Auto-expire stale queued actions from ticks that have already passed
      // This prevents phantom action counts and stale action buildup (#164, #168)
      await this.db
        .update(schema.actions)
        .set({ status: 'failed', result: 'Auto-expired: action was queued for a tick that has already passed' })
        .where(
          and(
            eq(schema.actions.worldId, this.worldId),
            eq(schema.actions.status, 'queued'),
            sql`${schema.actions.tick} <= ${world.currentTick}`,
          ),
        );

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
      const colonies: Colony[] = dbColonies.map(c => {
        const col: any = {
          id: c.id,
          worldId: c.worldId,
          name: c.name,
          resources: c.resources as Resources,
          legacyScore: (c as any).legacyScore ?? 0,
          status: c.status,
          researchedTechs: ((c as any).researchedTechs ?? []) as string[],
          researchQueue: ((c as any).researchQueue ?? []) as ResearchQueueEntry[],
          lastActionTick: (c as any).lastActionTick ?? 0,
          newcomerProtectionUntilTick: (c as any).newcomerProtectionUntilTick ?? 0,
        };
        return col as Colony;
      });

      const settlements: Settlement[] = dbSettlements.map(s => ({
        id: s.id,
        colonyId: s.colonyId,
        worldId: s.worldId,
        name: s.name,
        hexX: s.hexX,
        hexY: s.hexY,
        tier: s.tier as 'outpost' | 'town' | 'city',
        buildings: (s.buildings ?? []) as Building[],
        buildQueue: (s.buildQueue ?? []) as BuildQueueEntry[],
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
        idleTicks: u.idleTicks ?? 0,
      }));

      const hexes: HexTileState[] = dbHexes.map(h => ({
        x: h.x,
        y: h.y,
        terrain: h.terrain,
        resources: (h.resources ?? { food: 0, timber: 0, stone: 0, iron: 0 }) as HexTileState['resources'],
        settlementId: h.settlementId,
        exploredBy: (h.exploredBy ?? []) as string[],
        poi: (h as any).poi ?? null,
      }));

      const queuedActions: QueuedAction[] = dbActions.map(a => ({
        id: a.id,
        colonyId: a.colonyId,
        type: a.type,
        params: a.params as Record<string, unknown>,
      }));

      // Load active/proposed agreements for this world
      const dbAgreements = await this.db
        .select()
        .from(schema.agreements)
        .where(
          and(
            eq(schema.agreements.worldId, this.worldId),
            // Load proposed + active agreements (needed for accept/break/trade transfers)
          ),
        );

      const currentAgreements: Agreement[] = dbAgreements
        .filter(a => a.status === 'proposed' || a.status === 'active')
        .map(a => ({
          id: a.id,
          worldId: a.worldId,
          type: a.type as Agreement['type'],
          proposedBy: a.proposedBy,
          proposedTo: a.proposedTo,
          status: a.status as Agreement['status'],
          terms: (a.terms ?? {}) as Agreement['terms'],
          proposedAtTick: a.proposedAtTick,
          acceptedAtTick: a.acceptedAtTick ?? null,
        }));

      // Resolve tick
      console.log(`[TICK] Running resolveTick for tick ${newTick}...`);
      const result = resolveTick(colonies, settlements, units, hexes, queuedActions, undefined, this.worldId, newTick, currentAgreements);
      console.log(`[TICK] resolveTick complete. colonies=${result.colonies.length}, units=${result.units.length}, events=${result.events.length}`);

      // Persist results
      console.log(`[TICK] Starting DB transaction...`);
      await this.db.transaction(async (tx) => {
        // Update world tick
        await tx
          .update(schema.worlds)
          .set({ currentTick: newTick })
          .where(eq(schema.worlds.id, this.worldId));

        // Update colony resources + status
        for (const colony of result.colonies) {
          await tx
            .update(schema.colonies)
            .set({
              resources: colony.resources,
              legacyScore: colony.legacyScore ?? 0,
              status: colony.status,
              ...((colony as any).researchedTechs !== undefined ? { researchedTechs: (colony as any).researchedTechs } : {}),
              ...((colony as any).researchQueue !== undefined ? { researchQueue: (colony as any).researchQueue } : {}),
              ...(colony.lastActionTick !== undefined ? { lastActionTick: colony.lastActionTick } : {}),
              ...(colony.newcomerProtectionUntilTick !== undefined ? { newcomerProtectionUntilTick: colony.newcomerProtectionUntilTick } : {}),
              ...(colony.diedAtTick !== undefined ? { diedAtTick: colony.diedAtTick } : {}),
              ...(colony.deathReason !== undefined ? { deathReason: colony.deathReason } : {}),
            } as any)
            .where(eq(schema.colonies.id, colony.id));
        }

        // Update existing settlements and insert newly founded ones
        // NOTE: This MUST run BEFORE dead colony cleanup so that captured
        // settlements have their colonyId transferred to the new owner before
        // we delete settlements belonging to dead colonies. Otherwise,
        // captured settlements still have the old colonyId in the DB and
        // get incorrectly deleted during dead colony cleanup (#161, #162).
        const existingSettlementIds = new Set(dbSettlements.map(s => s.id));
        for (const settlement of result.settlements) {
          if (existingSettlementIds.has(settlement.id)) {
            await tx
              .update(schema.settlements)
              .set({
                colonyId: settlement.colonyId,
                buildings: settlement.buildings,
                tier: settlement.tier,
                population: settlement.population,
                buildQueue: settlement.buildQueue,
                loyalty: settlement.loyalty,
              })
              .where(eq(schema.settlements.id, settlement.id));
          } else {
            // Insert newly founded settlement
            await tx.insert(schema.settlements).values({
              id: settlement.id,
              colonyId: settlement.colonyId,
              worldId: settlement.worldId,
              name: settlement.name,
              hexX: settlement.hexX,
              hexY: settlement.hexY,
              tier: settlement.tier,
              buildings: settlement.buildings,
              buildQueue: settlement.buildQueue,
              loyalty: settlement.loyalty,
              population: settlement.population,
            });
            // Link the hex to the new settlement
            await tx.update(schema.hexes)
              .set({ settlementId: settlement.id } as any)
              .where(
                and(
                  eq(schema.hexes.worldId, settlement.worldId),
                  eq(schema.hexes.x, settlement.hexX),
                  eq(schema.hexes.y, settlement.hexY),
                ),
              );
          }
        }

        // Handle dead colonies — clean up their settlements and units
        // Runs AFTER settlement updates so captured settlements already
        // belong to their new owner and won't be incorrectly deleted.
        if (result.deadColonyIds && result.deadColonyIds.length > 0) {
          for (const deadId of result.deadColonyIds) {
            // Delete units belonging to dead colony
            await tx.delete(schema.units).where(eq(schema.units.colonyId, deadId));
            // Delete settlements and free hexes
            const deadSettlements = await tx.select({ id: schema.settlements.id, hexX: schema.settlements.hexX, hexY: schema.settlements.hexY })
              .from(schema.settlements)
              .where(eq(schema.settlements.colonyId, deadId));
            for (const s of deadSettlements) {
              await tx.update(schema.hexes).set({ settlementId: null } as any)
                .where(and(eq(schema.hexes.worldId, world.id), eq(schema.hexes.x, s.hexX), eq(schema.hexes.y, s.hexY)));
            }
            await tx.delete(schema.settlements).where(eq(schema.settlements.colonyId, deadId));
            // Remove colony from explored_by arrays (fog cleanup)
            await tx.execute(sql`UPDATE hexes SET explored_by = array_remove(explored_by, ${deadId}) WHERE world_id = ${world.id} AND ${deadId} = ANY(explored_by)`);
          }
        }

        // Update existing units and insert newly trained units
        const existingUnitIds = new Set(dbUnits.map(u => u.id));
        for (const unit of result.units) {
          if (existingUnitIds.has(unit.id)) {
            // Update existing unit
            await tx
              .update(schema.units)
              .set({
                health: Math.round(unit.health),
                morale: unit.morale,
                hexX: unit.hexX,
                hexY: unit.hexY,
                movementQueue: unit.movementQueue ?? [],
                idleTicks: unit.idleTicks ?? 0,
              })
              .where(eq(schema.units.id, unit.id));
          } else {
            // Insert newly trained unit
            await tx.insert(schema.units).values({
              id: unit.id,
              colonyId: unit.colonyId,
              worldId: unit.worldId,
              type: unit.type,
              hexX: unit.hexX,
              hexY: unit.hexY,
              health: Math.round(unit.health),
              morale: unit.morale,
              movementQueue: unit.movementQueue ?? [],
              idleTicks: unit.idleTicks ?? 0,
            });
          }
        }

        // Delete deserted units
        for (const unitId of result.desertedUnitIds) {
          await tx
            .delete(schema.units)
            .where(eq(schema.units.id, unitId));
        }

        // Delete disbanded units
        for (const unitId of result.disbandedUnitIds) {
          await tx
            .delete(schema.units)
            .where(eq(schema.units.id, unitId));
        }

        // --- Persist fog reveals (update explored_by arrays) ---
        if (result.fogReveals && result.fogReveals.length > 0) {
          // Group reveals by colony for batch updates
          const revealsByColony = new Map<string, Array<{ q: number; r: number }>>();
          for (const reveal of result.fogReveals) {
            const list = revealsByColony.get(reveal.colonyId) ?? [];
            list.push(reveal.hex);
            revealsByColony.set(reveal.colonyId, list);
          }
          for (const [colonyId, revealedHexes] of revealsByColony.entries()) {
            for (const hex of revealedHexes) {
              await tx.execute(
                sql`UPDATE hexes SET explored_by = array_append(explored_by, ${colonyId})
                    WHERE world_id = ${world.id} AND x = ${hex.q} AND y = ${hex.r}
                    AND NOT (${colonyId} = ANY(COALESCE(explored_by, ARRAY[]::TEXT[])))`
              );
            }
          }
        }

        // --- Persist POI discovery state ---
        // The tick engine marks POIs as discovered in-place on hex objects.
        // We need to write those changes back to the DB.
        for (const hex of hexes) {
          if (hex.poi && hex.poi.discoveredBy) {
            // Check if this was newly discovered this tick
            if (hex.poi.discoveredAtTick === newTick) {
              await tx.execute(
                sql`UPDATE hexes SET poi = ${JSON.stringify(hex.poi)}::jsonb
                    WHERE world_id = ${world.id} AND x = ${hex.x} AND y = ${hex.y}`
              );
            }
          }
        }

        // Update action statuses + emit action outcome events
        const actionColonyMap = new Map(dbActions.map(a => [a.id, a.colonyId]));
        for (const ar of result.actionResults) {
          await tx
            .update(schema.actions)
            .set({ status: ar.status, result: ar.result ?? null })
            .where(eq(schema.actions.id, ar.actionId));

          // Emit action outcome event (private to colony)
          const colonyId = actionColonyMap.get(ar.actionId);
          const actionMeta = dbActions.find(a => a.id === ar.actionId);
          result.events.push({
            type: ar.status === 'failed' ? 'action_failed' : 'action_resolved',
            colonyId: colonyId ?? undefined,
            data: {
              actionId: ar.actionId,
              actionType: actionMeta?.type ?? 'unknown',
              result: ar.result ?? null,
            },
          });
        }

        // Mark any remaining queued actions as resolved (action types not yet handled)
        // This prevents them from being re-processed next tick
        const processedIds = new Set(result.actionResults.map(ar => ar.actionId));
        for (const action of dbActions) {
          if (!processedIds.has(action.id)) {
            await tx
              .update(schema.actions)
              .set({ status: 'resolved', result: 'Action type not yet implemented' })
              .where(eq(schema.actions.id, action.id));

            result.events.push({
              type: 'action_failed',
              colonyId: action.colonyId,
              data: {
                actionId: action.id,
                actionType: action.type,
                result: 'Action type not yet implemented',
              },
            });
          }
        }

        // --- Compass Signal: periodic directional hint toward nearest undiscovered colony ---
        if (newTick >= COMPASS_SIGNAL_START && newTick % COMPASS_SIGNAL_INTERVAL === 0) {
          // Get all colony home settlements
          const allSettlements = await tx
            .select({ id: schema.settlements.id, colonyId: schema.settlements.colonyId, hexX: schema.settlements.hexX, hexY: schema.settlements.hexY })
            .from(schema.settlements)
            .where(eq(schema.settlements.worldId, this.worldId));

          // Group settlements by colony, using their first settlement as "home"
          const colonyHomes = new Map<string, { q: number; r: number }>();
          for (const s of allSettlements) {
            if (!colonyHomes.has(s.colonyId)) {
              colonyHomes.set(s.colonyId, { q: s.hexX, r: s.hexY });
            }
          }

          // Get explored_by data for each hex to know which colonies are known
          // A colony "knows" another colony if it has explored a hex with that colony's settlement
          const settHexes = allSettlements.map(s => `(${s.hexX},${s.hexY})`);

          for (const colony of result.colonies) {
            if (colony.status !== 'active') continue;

            const myHome = colonyHomes.get(colony.id);
            if (!myHome) continue;

            // Find nearest colony that this colony hasn't discovered yet
            // Check which colonies this colony has seen (via fog reveals)
            const knownColonyIds = new Set<string>();
            knownColonyIds.add(colony.id); // Always know yourself

            // Check all hexes explored by this colony for enemy settlements
            for (const s of allSettlements) {
              if (s.colonyId === colony.id) continue;
              // Check if the hex containing this settlement is explored by us
              const hexRow = dbHexes.find(h => h.x === s.hexX && h.y === s.hexY);
              if (hexRow && Array.isArray(hexRow.exploredBy) && hexRow.exploredBy.includes(colony.id)) {
                knownColonyIds.add(s.colonyId);
              }
            }

            // Find nearest UNKNOWN colony
            let nearestDist = Infinity;
            let nearestHome: { q: number; r: number } | null = null;

            for (const [otherId, otherHome] of colonyHomes.entries()) {
              if (knownColonyIds.has(otherId)) continue;
              const dist = hexDistance(myHome, otherHome);
              if (dist < nearestDist) {
                nearestDist = dist;
                nearestHome = otherHome;
              }
            }

            if (nearestHome) {
              // Calculate direction (8-point compass)
              const dq = nearestHome.q - myHome.q;
              const dr = nearestHome.r - myHome.r;
              // Convert axial to approximate angle
              // In axial coords: q increases to the right, r increases down-right
              const x = dq + dr * 0.5; // approximate cartesian x
              const y = dr * 0.866;     // approximate cartesian y (sqrt(3)/2)
              const angle = Math.atan2(y, x) * (180 / Math.PI);

              let direction: string;
              if (angle >= -22.5 && angle < 22.5) direction = 'east';
              else if (angle >= 22.5 && angle < 67.5) direction = 'southeast';
              else if (angle >= 67.5 && angle < 112.5) direction = 'south';
              else if (angle >= 112.5 && angle < 157.5) direction = 'southwest';
              else if (angle >= 157.5 || angle < -157.5) direction = 'west';
              else if (angle >= -157.5 && angle < -112.5) direction = 'northwest';
              else if (angle >= -112.5 && angle < -67.5) direction = 'north';
              else direction = 'northeast';

              // Distance band (vague)
              let distanceBand: string;
              if (nearestDist <= 15) distanceBand = 'nearby';
              else if (nearestDist <= 30) distanceBand = 'moderate';
              else distanceBand = 'distant';

              result.events.push({
                type: 'compass_signal',
                colonyId: colony.id,
                data: {
                  direction,
                  distanceBand,
                  message: `Scouts detect signs of activity to the ${direction}. The source appears ${distanceBand}.`,
                },
              });
            }
          }
        }

        // Insert messages from send_message actions
        if (result.newMessages && result.newMessages.length > 0) {
          for (const msg of result.newMessages) {
            await tx.insert(schema.messages).values({
              id: msg.id,
              worldId: msg.worldId,
              fromColony: msg.fromColony,
              toColony: msg.toColony,
              sentAtTick: msg.sentAtTick,
              deliveredAtTick: msg.deliveredAtTick,
              content: msg.content,
              read: false,
            });
          }
        }

        // Persist agreement mutations (create / update)
        if (result.agreementMutations && result.agreementMutations.length > 0) {
          for (const mutation of result.agreementMutations) {
            if (mutation.type === 'create') {
              await tx.insert(schema.agreements).values({
                id: mutation.agreement.id,
                worldId: mutation.agreement.worldId,
                type: mutation.agreement.type,
                proposedBy: mutation.agreement.proposedBy,
                proposedTo: mutation.agreement.proposedTo,
                status: mutation.agreement.status,
                terms: mutation.agreement.terms as any,
                proposedAtTick: mutation.agreement.proposedAtTick,
                acceptedAtTick: mutation.agreement.acceptedAtTick,
              });
            } else if (mutation.type === 'update') {
              await tx
                .update(schema.agreements)
                .set({
                  status: mutation.agreement.status,
                  acceptedAtTick: mutation.agreement.acceptedAtTick,
                })
                .where(eq(schema.agreements.id, mutation.agreement.id));
            }
          }
        }

        // Insert events, collapsing duplicated public combat events emitted once per involved colony.
        const persistedEvents = new Map<string, {
          type: string;
          public: boolean;
          visibility: string[];
          data: Record<string, unknown>;
          publicData?: Record<string, unknown>;
        }>();

        for (const event of result.events) {
          const isPublic = PUBLIC_EVENT_TYPES.has(event.type);
          const publicData = isPublic ? buildPublicData(event) : null;
          const dedupKey = isPublic ? eventDedupKey(event) : null;

          if (dedupKey) {
            const existing = persistedEvents.get(dedupKey);
            if (existing) {
              if (event.colonyId && !existing.visibility.includes(event.colonyId)) {
                existing.visibility.push(event.colonyId);
              }
              continue;
            }
          }

          const persistedEvent = {
            type: event.type,
            public: isPublic,
            visibility: event.colonyId ? [event.colonyId] : [],
            data: event.data,
            ...(publicData ? { publicData } : {}),
          };

          persistedEvents.set(dedupKey ?? nanoid(), persistedEvent);
        }

        for (const event of persistedEvents.values()) {
          await tx.insert(schema.events).values({
            id: nanoid(),
            worldId: this.worldId,
            tick: newTick,
            type: event.type,
            public: event.public,
            visibility: event.visibility,
            data: event.data,
            ...(event.publicData ? { publicData: event.publicData } : {}),
          });
        }
      });

      console.log(`[TICK] Tick ${newTick} persisted successfully. Calling onTick...`);
      this.onTick?.(newTick, result.events);
    } catch (tickErr) {
      console.error(`[TICK] ERROR in executeTick:`, tickErr);
      throw tickErr;
    } finally {
      console.log(`[TICK] executeTick finished, setting running=false`);
      this.running = false;
    }
  }
}




