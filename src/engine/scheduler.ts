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
import type { Colony, Settlement, Unit, HexTileState, Resources, Building, BuildQueueEntry, QueuedAction, MessageRecord, AgreementRecord } from './tick.js';
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
  'settlement_captured',
  'agreement_signed',
  'agreement_broken',
]);

/**
 * Build public-safe data for spectator feed.
 * Strips private info (exact resource amounts) but keeps the interesting bits.
 */
function buildPublicData(event: { type: string; colonyId?: string; data: Record<string, unknown> }): Record<string, unknown> | null {
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
    case 'combat_resolved':
      return {
        attackerColonyId: event.data.attackerColonyId,
        defenderColonyId: event.data.defenderColonyId,
        attackerLosses: event.data.attackerLosses,
        defenderLosses: event.data.defenderLosses,
      };
    case 'unit_destroyed':
      return {
        unitType: event.data.unitType,
        cause: event.data.cause || 'combat',
      };
    case 'settlement_captured':
      return {
        name: event.data.name,
        previousTier: event.data.previousTier,
        newTier: event.data.newTier,
      };
    case 'agreement_signed':
      return {
        agreementType: event.data.agreementType,
        withColonyId: event.data.withColonyId,
        withColonyName: event.data.withColonyName,
      };
    case 'agreement_broken':
      return {
        agreementType: event.data.agreementType,
        brokenByName: event.data.brokenByName,
        otherPartyName: event.data.otherPartyName,
      };
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
    if (this.running) {
      // If a tick has been running for more than TICK_TIMEOUT_MS, force-reset
      const elapsed = Date.now() - this.tickStartedAt;
      if (elapsed > TICK_TIMEOUT_MS) {
        this.onError?.(new Error(`Tick stuck for ${elapsed}ms — force-resetting scheduler`));
        this.running = false;
      } else {
        return; // previous tick still processing normally
      }
    }
    this.running = true;
    this.tickStartedAt = Date.now();

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
      // Load agreements for this world
      const dbAgreements = await this.db
        .select()
        .from(schema.agreements)
        .where(and(
          eq(schema.agreements.worldId, this.worldId),
          sql`status IN ('proposed', 'active')`
        ));

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
        legacyScore: (c as any).legacyScore ?? 0,
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
      }));

      const queuedActions: QueuedAction[] = dbActions.map(a => ({
        id: a.id,
        colonyId: a.colonyId,
        type: a.type,
        params: a.params as Record<string, unknown>,
      }));

      const existingAgreements: AgreementRecord[] = dbAgreements.map(a => ({
        id: a.id,
        worldId: a.worldId,
        type: a.type as AgreementRecord['type'],
        proposedBy: a.proposedBy,
        proposedTo: a.proposedTo,
        status: a.status as AgreementRecord['status'],
        terms: (a.terms ?? {}) as Record<string, unknown>,
        proposedAtTick: a.proposedAtTick,
        acceptedAtTick: a.acceptedAtTick ?? null,
      }));

      // Resolve tick
      const result = resolveTick(colonies, settlements, units, hexes, queuedActions, undefined, this.worldId, newTick, existingAgreements);

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
            .set({ resources: colony.resources, legacyScore: colony.legacyScore ?? 0 })
            .where(eq(schema.colonies.id, colony.id));
        }

        // Update existing settlements and insert newly founded ones
        const existingSettlementIds = new Set(dbSettlements.map(s => s.id));
        for (const settlement of result.settlements) {
          if (existingSettlementIds.has(settlement.id)) {
            await tx
              .update(schema.settlements)
              .set({
                buildings: settlement.buildings,
                tier: settlement.tier,
                population: settlement.population,
                buildQueue: settlement.buildQueue,
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
              health: unit.health,
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

        // Insert new agreements
        if (result.newAgreements && result.newAgreements.length > 0) {
          for (const agr of result.newAgreements) {
            await tx.insert(schema.agreements).values({
              id: agr.id,
              worldId: agr.worldId,
              type: agr.type,
              proposedBy: agr.proposedBy,
              proposedTo: agr.proposedTo,
              status: agr.status,
              terms: agr.terms,
              proposedAtTick: agr.proposedAtTick,
              acceptedAtTick: agr.acceptedAtTick,
            });
          }
        }

        // Update existing agreements (status changes)
        if (result.updatedAgreements && result.updatedAgreements.length > 0) {
          for (const agr of result.updatedAgreements) {
            await tx
              .update(schema.agreements)
              .set({
                status: agr.status,
                acceptedAtTick: agr.acceptedAtTick,
              })
              .where(eq(schema.agreements.id, agr.id));
          }
        }

        // Insert events
        for (const event of result.events) {
          const isPublic = PUBLIC_EVENT_TYPES.has(event.type);
          const publicData = isPublic ? buildPublicData(event) : null;

          await tx.insert(schema.events).values({
            id: nanoid(),
            worldId: this.worldId,
            tick: newTick,
            type: event.type,
            public: isPublic,
            visibility: event.colonyId ? [event.colonyId] : [],
            data: event.data,
            ...(publicData ? { publicData } : {}),
          });
        }
      });

      this.onTick?.(newTick, result.events);
    } finally {
      this.running = false;
    }
  }
}




