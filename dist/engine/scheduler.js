/**
 * Tick scheduler — manages tick timing and persistence.
 *
 * Loads world state from the database, runs resolveTick, writes results back.
 * One scheduler instance per running world.
 */
import { eq, and } from 'drizzle-orm';
import * as schema from '../db/schema/index.js';
import { resolveTick } from './tick.js';
import { hexDistance } from './hex.js';
import { nanoid } from 'nanoid';
/** How often (in ticks) to send compass signal events */
const COMPASS_SIGNAL_INTERVAL = 25;
/** Minimum ticks before first compass signal (let colonies establish first) */
const COMPASS_SIGNAL_START = 25;
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
]);
/**
 * Build public-safe data for spectator feed.
 * Strips private info (exact resource amounts) but keeps the interesting bits.
 */
function buildPublicData(event) {
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
        default:
            return null;
    }
}
export class TickScheduler {
    worldId;
    db;
    timer = null;
    running = false;
    onTick;
    onError;
    constructor(options) {
        this.worldId = options.worldId;
        this.db = options.db;
        this.onTick = options.onTick;
        this.onError = options.onError;
    }
    /**
     * Start the tick loop for a world.
     */
    async start() {
        const [world] = await this.db
            .select()
            .from(schema.worlds)
            .where(eq(schema.worlds.id, this.worldId));
        if (!world)
            throw new Error(`World ${this.worldId} not found`);
        if (world.status !== 'running')
            throw new Error(`World ${this.worldId} is not running (status: ${world.status})`);
        this.timer = setInterval(() => {
            this.executeTick().catch((err) => {
                this.onError?.(err instanceof Error ? err : new Error(String(err)));
            });
        }, world.tickRate);
    }
    /**
     * Stop the tick loop.
     */
    stop() {
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = null;
        }
    }
    /**
     * Execute a single tick. Can be called directly for testing.
     */
    async executeTick() {
        if (this.running)
            return; // skip if previous tick still processing
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
                .where(and(eq(schema.actions.worldId, this.worldId), eq(schema.actions.tick, newTick), eq(schema.actions.status, 'queued')));
            // Map DB rows to tick engine types
            const colonies = dbColonies.map(c => ({
                id: c.id,
                worldId: c.worldId,
                name: c.name,
                resources: c.resources,
                status: c.status,
            }));
            const settlements = dbSettlements.map(s => ({
                id: s.id,
                colonyId: s.colonyId,
                worldId: s.worldId,
                name: s.name,
                hexX: s.hexX,
                hexY: s.hexY,
                tier: s.tier,
                buildings: (s.buildings ?? []),
                buildQueue: (s.buildQueue ?? []),
                loyalty: s.loyalty,
                population: s.population,
            }));
            const units = dbUnits.map(u => ({
                id: u.id,
                colonyId: u.colonyId,
                worldId: u.worldId,
                type: u.type,
                hexX: u.hexX,
                hexY: u.hexY,
                health: u.health,
                morale: u.morale,
                movementQueue: (u.movementQueue ?? []),
                idleTicks: u.idleTicks ?? 0,
            }));
            const hexes = dbHexes.map(h => ({
                x: h.x,
                y: h.y,
                terrain: h.terrain,
                resources: (h.resources ?? { food: 0, timber: 0, stone: 0, iron: 0 }),
                settlementId: h.settlementId,
            }));
            const queuedActions = dbActions.map(a => ({
                id: a.id,
                colonyId: a.colonyId,
                type: a.type,
                params: a.params,
            }));
            // Resolve tick
            const result = resolveTick(colonies, settlements, units, hexes, queuedActions, undefined, this.worldId, newTick);
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
                    }
                    else {
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
                    }
                    else {
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
                    const colonyHomes = new Map();
                    for (const s of allSettlements) {
                        if (!colonyHomes.has(s.colonyId)) {
                            colonyHomes.set(s.colonyId, { q: s.hexX, r: s.hexY });
                        }
                    }
                    // Get explored_by data for each hex to know which colonies are known
                    // A colony "knows" another colony if it has explored a hex with that colony's settlement
                    const settHexes = allSettlements.map(s => `(${s.hexX},${s.hexY})`);
                    for (const colony of result.colonies) {
                        if (colony.status !== 'active')
                            continue;
                        const myHome = colonyHomes.get(colony.id);
                        if (!myHome)
                            continue;
                        // Find nearest colony that this colony hasn't discovered yet
                        // Check which colonies this colony has seen (via fog reveals)
                        const knownColonyIds = new Set();
                        knownColonyIds.add(colony.id); // Always know yourself
                        // Check all hexes explored by this colony for enemy settlements
                        for (const s of allSettlements) {
                            if (s.colonyId === colony.id)
                                continue;
                            // Check if the hex containing this settlement is explored by us
                            const hexRow = dbHexes.find(h => h.x === s.hexX && h.y === s.hexY);
                            if (hexRow && Array.isArray(hexRow.exploredBy) && hexRow.exploredBy.includes(colony.id)) {
                                knownColonyIds.add(s.colonyId);
                            }
                        }
                        // Find nearest UNKNOWN colony
                        let nearestDist = Infinity;
                        let nearestHome = null;
                        for (const [otherId, otherHome] of colonyHomes.entries()) {
                            if (knownColonyIds.has(otherId))
                                continue;
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
                            const y = dr * 0.866; // approximate cartesian y (sqrt(3)/2)
                            const angle = Math.atan2(y, x) * (180 / Math.PI);
                            let direction;
                            if (angle >= -22.5 && angle < 22.5)
                                direction = 'east';
                            else if (angle >= 22.5 && angle < 67.5)
                                direction = 'southeast';
                            else if (angle >= 67.5 && angle < 112.5)
                                direction = 'south';
                            else if (angle >= 112.5 && angle < 157.5)
                                direction = 'southwest';
                            else if (angle >= 157.5 || angle < -157.5)
                                direction = 'west';
                            else if (angle >= -157.5 && angle < -112.5)
                                direction = 'northwest';
                            else if (angle >= -112.5 && angle < -67.5)
                                direction = 'north';
                            else
                                direction = 'northeast';
                            // Distance band (vague)
                            let distanceBand;
                            if (nearestDist <= 15)
                                distanceBand = 'nearby';
                            else if (nearestDist <= 30)
                                distanceBand = 'moderate';
                            else
                                distanceBand = 'distant';
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
        }
        finally {
            this.running = false;
        }
    }
}
