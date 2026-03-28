import { nanoid } from 'nanoid';
import { eq, and } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../db/schema/index.js';
import { generateWorld, recommendedRadius } from '../engine/mapgen.js';

export type WorldStatus = 'open' | 'running' | 'full' | 'paused' | 'ended' | 'archived';

export const ACTIVE_WORLD_STATUSES: WorldStatus[] = ['open', 'running', 'full'];

export function canWorldRunScheduler(status: string): boolean {
  return ACTIVE_WORLD_STATUSES.includes(status as WorldStatus);
}

export function canTransitionWorldStatus(from: WorldStatus, to: WorldStatus): boolean {
  const allowed: Record<WorldStatus, WorldStatus[]> = {
    open: ['running', 'paused', 'archived', 'ended'],
    running: ['full', 'paused', 'ended', 'archived'],
    full: ['paused', 'ended', 'archived'],
    paused: ['open', 'running', 'full', 'archived', 'ended'],
    ended: ['archived'],
    archived: [],
  };

  return allowed[from].includes(to);
}

export function deriveResumeStatus(suspendedStatus: string | null, colonyCount: number): WorldStatus {
  if (suspendedStatus === 'full') return 'full';
  if (suspendedStatus === 'running') return 'running';
  if (suspendedStatus === 'open') return colonyCount > 0 ? 'running' : 'open';
  return colonyCount > 0 ? 'running' : 'open';
}

export interface LifecycleLogger {
  info: (msg: string) => void;
  error: (msg: string) => void;
}

export interface CreateWorldOptions {
  id?: string;
  name: string;
  mapSeed: number;
  mapRadius?: number;
  maxColonies?: number;
  tickRate?: number;
  status?: Extract<WorldStatus, 'open' | 'paused'>;
}

export interface WorldSnapshot {
  schemaVersion: 1;
  exportedAt: string;
  world: unknown;
  starSystem: unknown | null;
  sectors: unknown[];
  starLanes: unknown[];
  colonies: unknown[];
  settlements: unknown[];
  units: unknown[];
  hexes: unknown[];
  actions: unknown[];
  agreements: unknown[];
  messages: unknown[];
  events: unknown[];
  feedbackReports: unknown[];
  fleets: unknown[];
  orbitalAssets: unknown[];
  governanceActors: unknown[];
  actorDelegations: unknown[];
}

export function buildWorldSnapshot(payload: Omit<WorldSnapshot, 'schemaVersion' | 'exportedAt'>): WorldSnapshot {
  return {
    schemaVersion: 1,
    exportedAt: new Date().toISOString(),
    ...payload,
  };
}

export async function createWorldWithMap(
  db: PostgresJsDatabase<typeof schema>,
  options: CreateWorldOptions,
): Promise<{ id: string; hexCount: number }> {
  const worldId = options.id ?? `world_${nanoid(10)}`;
  const maxColonies = options.maxColonies ?? 8;
  const mapRadius = options.mapRadius ?? recommendedRadius(maxColonies);
  const tickRate = options.tickRate ?? 300000;
  const status = options.status ?? 'open';

  const worldMap = generateWorld(options.mapSeed, mapRadius, maxColonies);

  await db.transaction(async (tx) => {
    await tx.insert(schema.worlds).values({
      id: worldId,
      name: options.name,
      mapSeed: options.mapSeed,
      mapRadius,
      maxColonies,
      tickRate,
      status,
      currentTick: 0,
    });

    await tx.insert(schema.hexes).values(
      worldMap.hexes.map((hex) => ({
        worldId,
        x: hex.q,
        y: hex.r,
        terrain: hex.terrain,
        resources: hex.resources,
        poi: hex.poi ?? null,
      })),
    );
  });

  return { id: worldId, hexCount: worldMap.hexes.length };
}

export async function pauseWorld(
  db: PostgresJsDatabase<typeof schema>,
  worldId: string,
): Promise<{ previousStatus: string; nextStatus: WorldStatus }> {
  const [world] = await db.select().from(schema.worlds).where(eq(schema.worlds.id, worldId)).limit(1);
  if (!world) throw new Error(`World ${worldId} not found`);
  const currentStatus = world.status as WorldStatus;
  if (!canTransitionWorldStatus(currentStatus, 'paused')) {
    throw new Error(`Cannot pause world from status ${currentStatus}`);
  }

  await db.update(schema.worlds)
    .set({ status: 'paused', suspendedStatus: currentStatus })
    .where(eq(schema.worlds.id, worldId));

  return { previousStatus: currentStatus, nextStatus: 'paused' };
}

export async function resumeWorld(
  db: PostgresJsDatabase<typeof schema>,
  worldId: string,
): Promise<{ previousStatus: WorldStatus; nextStatus: WorldStatus }> {
  const [world] = await db.select().from(schema.worlds).where(eq(schema.worlds.id, worldId)).limit(1);
  if (!world) throw new Error(`World ${worldId} not found`);
  const currentStatus = world.status as WorldStatus;
  if (currentStatus !== 'paused') {
    throw new Error(`Cannot resume world from status ${currentStatus}`);
  }

  const colonyCountRows = await db
    .select()
    .from(schema.colonies)
    .where(eq(schema.colonies.worldId, worldId));

  const nextStatus = deriveResumeStatus(world.suspendedStatus ?? null, colonyCountRows.length);
  await db.update(schema.worlds)
    .set({ status: nextStatus, suspendedStatus: null })
    .where(eq(schema.worlds.id, worldId));

  return { previousStatus: 'paused', nextStatus };
}

export async function archiveWorld(
  db: PostgresJsDatabase<typeof schema>,
  worldId: string,
): Promise<void> {
  const [world] = await db.select().from(schema.worlds).where(eq(schema.worlds.id, worldId)).limit(1);
  if (!world) throw new Error(`World ${worldId} not found`);

  await db.update(schema.worlds)
    .set({ status: 'archived', suspendedStatus: null })
    .where(eq(schema.worlds.id, worldId));
}

export async function resetWorld(
  db: PostgresJsDatabase<typeof schema>,
  worldId: string,
): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.delete(schema.actions).where(eq(schema.actions.worldId, worldId));
    await tx.delete(schema.messages).where(eq(schema.messages.worldId, worldId));
    await tx.delete(schema.agreements).where(eq(schema.agreements.worldId, worldId));
    await tx.delete(schema.events).where(eq(schema.events.worldId, worldId));
    await tx.delete(schema.feedbackReports).where(eq(schema.feedbackReports.worldId, worldId));
    await tx.delete(schema.units).where(eq(schema.units.worldId, worldId));
    await tx.delete(schema.settlements).where(eq(schema.settlements.worldId, worldId));
    await tx.delete(schema.colonies).where(eq(schema.colonies.worldId, worldId));

    await tx.update(schema.hexes)
      .set({ settlementId: null, exploredBy: [] })
      .where(eq(schema.hexes.worldId, worldId));

    await tx.update(schema.worlds)
      .set({
        currentTick: 0,
        status: 'open',
        suspendedStatus: null,
      })
      .where(eq(schema.worlds.id, worldId));
  });
}

export async function exportWorldSnapshot(
  db: PostgresJsDatabase<typeof schema>,
  worldId: string,
): Promise<WorldSnapshot> {
  const [world] = await db.select().from(schema.worlds).where(eq(schema.worlds.id, worldId)).limit(1);
  if (!world) throw new Error(`World ${worldId} not found`);

  const [starSystem] = world.starSystemId
    ? await db.select().from(schema.starSystems).where(eq(schema.starSystems.id, world.starSystemId)).limit(1)
    : [null];

  const sectors = starSystem?.sectorId
    ? await db.select().from(schema.sectors).where(eq(schema.sectors.id, starSystem.sectorId))
    : [];

  const starLanes = starSystem
    ? await db.select().from(schema.starLanes)
        .where(and(
          eq(schema.starLanes.fromSystemId, starSystem.id),
        ))
    : [];

  const colonies = await db.select().from(schema.colonies).where(eq(schema.colonies.worldId, worldId));
  const settlements = await db.select().from(schema.settlements).where(eq(schema.settlements.worldId, worldId));
  const units = await db.select().from(schema.units).where(eq(schema.units.worldId, worldId));
  const hexes = await db.select().from(schema.hexes).where(eq(schema.hexes.worldId, worldId));
  const actions = await db.select().from(schema.actions).where(eq(schema.actions.worldId, worldId));
  const agreements = await db.select().from(schema.agreements).where(eq(schema.agreements.worldId, worldId));
  const messages = await db.select().from(schema.messages).where(eq(schema.messages.worldId, worldId));
  const events = await db.select().from(schema.events).where(eq(schema.events.worldId, worldId));
  const feedbackReports = await db.select().from(schema.feedbackReports).where(eq(schema.feedbackReports.worldId, worldId));

  const colonyIds = colonies.map((colony) => colony.id);
  const fleets = starSystem
    ? await db.select().from(schema.fleets).where(eq(schema.fleets.starSystemId, starSystem.id))
    : [];
  const orbitalAssets = starSystem
    ? await db.select().from(schema.orbitalAssets).where(eq(schema.orbitalAssets.starSystemId, starSystem.id))
    : [];

  const governanceActors = colonyIds.length > 0
    ? await db.select().from(schema.governanceActors)
    : [];
  const actorDelegations = governanceActors.length > 0
    ? await db.select().from(schema.actorDelegations)
    : [];

  return buildWorldSnapshot({
    world,
    starSystem: starSystem ?? null,
    sectors,
    starLanes,
    colonies,
    settlements,
    units,
    hexes,
    actions,
    agreements,
    messages,
    events,
    feedbackReports,
    fleets,
    orbitalAssets,
    governanceActors,
    actorDelegations,
  });
}
