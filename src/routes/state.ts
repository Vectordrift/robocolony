/**
 * State query endpoints — authenticated colony state access.
 *
 * GET /api/worlds/:id/state — full colony state (resources, settlements, units, visible map)
 * GET /api/worlds/:id/map   — visible hexes only (fog of war applied)
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { eq, and, or, sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { worlds, hexes, colonies, settlements, units, agreements } from '../db/schema/index.js';
import { requireAuth } from '../middleware/index.js';
import { TECH_TREE, MIN_SETTLEMENT_DISTANCE, canResearchTech } from '../engine/tick.js';
import type { TechId } from '../engine/tick.js';
import { hexDistance, hexNeighbors } from '../engine/hex.js';

// --- Fog of War Helper ---

export interface VisibleHex {
  x: number;
  y: number;
  terrain: string;
  resources: Record<string, number>;
  settlementId: string | null;
  poi?: { type: string; discoveredBy?: string; discoveredAtTick?: number; surveyedBy?: string; surveyedAtTick?: number } | null;
}

export interface SettlementSiteCandidate {
  x: number;
  y: number;
  score: number;
  distanceToNearestSettlement: number | null;
  nearbyResources: {
    food: number;
    timber: number;
    stone: number;
    iron: number;
  };
  terrainDiversity: number;
  nearbyPoiCount: number;
  nearbyMountainResourceScore: number;
  reasons: string[];
}

export function analyzeSettlementSites(
  visibleHexes: VisibleHex[],
  limit = 5,
): SettlementSiteCandidate[] {
  const visibleHexMap = new Map(visibleHexes.map(hex => [`${hex.x},${hex.y}`, hex]));
  const settlementCoords = visibleHexes
    .filter(hex => hex.settlementId !== null)
    .map(hex => ({ q: hex.x, r: hex.y }));

  const candidates: SettlementSiteCandidate[] = [];

  for (const hex of visibleHexes) {
    if (hex.terrain === 'ocean') continue;
    if (hex.settlementId !== null) continue;

    const candidateCoord = { q: hex.x, r: hex.y };
    const nearestSettlementDistance = settlementCoords.length === 0
      ? null
      : Math.min(...settlementCoords.map(coord => hexDistance(candidateCoord, coord)));

    if (nearestSettlementDistance !== null && nearestSettlementDistance < MIN_SETTLEMENT_DISTANCE) {
      continue;
    }

    const neighborhood = [candidateCoord, ...hexNeighbors(candidateCoord)]
      .map(coord => visibleHexMap.get(`${coord.q},${coord.r}`))
      .filter((neighbor): neighbor is VisibleHex => Boolean(neighbor));

    const nearbyResources = neighborhood.reduce((totals, neighbor) => ({
      food: totals.food + (neighbor.resources.food ?? 0),
      timber: totals.timber + (neighbor.resources.timber ?? 0),
      stone: totals.stone + (neighbor.resources.stone ?? 0),
      iron: totals.iron + (neighbor.resources.iron ?? 0),
    }), { food: 0, timber: 0, stone: 0, iron: 0 });

    const terrainDiversity = new Set(neighborhood.map(neighbor => neighbor.terrain)).size;
    const nearbyPoiCount = visibleHexes.filter(other => {
      if (!other.poi) return false;
      return hexDistance(candidateCoord, { q: other.x, r: other.y }) <= 2;
    }).length;
    const nearbyMountainResourceScore = visibleHexes.reduce((score, other) => {
      if (other.terrain !== 'mountains') return score;
      if (hexDistance(candidateCoord, { q: other.x, r: other.y }) > 2) return score;
      return score + (other.resources.stone ?? 0) + (other.resources.iron ?? 0);
    }, 0);

    const spacingBonus = nearestSettlementDistance === null
      ? MIN_SETTLEMENT_DISTANCE + 2
      : Math.min(nearestSettlementDistance, MIN_SETTLEMENT_DISTANCE + 3);
    const score = (
      nearbyResources.food * 5 +
      nearbyResources.timber * 2 +
      nearbyResources.stone * 3 +
      nearbyResources.iron * 4 +
      terrainDiversity * 3 +
      nearbyPoiCount * 4 +
      nearbyMountainResourceScore * 2 +
      spacingBonus
    );

    const reasons = [
      `Food reach ${nearbyResources.food}`,
      `Terrain diversity ${terrainDiversity}`,
    ];
    if (nearbyResources.iron > 0 || nearbyResources.stone > 0 || nearbyMountainResourceScore > 0) {
      reasons.push(`Strong mountain access (${nearbyMountainResourceScore})`);
    }
    if (nearbyPoiCount > 0) {
      reasons.push(`${nearbyPoiCount} nearby POI${nearbyPoiCount === 1 ? '' : 's'}`);
    }
    if (nearestSettlementDistance !== null) {
      reasons.push(`Nearest known settlement ${nearestSettlementDistance} hexes away`);
    }

    candidates.push({
      x: hex.x,
      y: hex.y,
      score,
      distanceToNearestSettlement: nearestSettlementDistance,
      nearbyResources,
      terrainDiversity,
      nearbyPoiCount,
      nearbyMountainResourceScore,
      reasons,
    });
  }

  return candidates
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      if ((b.distanceToNearestSettlement ?? -1) !== (a.distanceToNearestSettlement ?? -1)) {
        return (b.distanceToNearestSettlement ?? -1) - (a.distanceToNearestSettlement ?? -1);
      }
      if (a.x !== b.x) return a.x - b.x;
      return a.y - b.y;
    })
    .slice(0, limit);
}

/**
 * Get all hexes visible to a colony (fog of war applied).
 * A hex is visible if the colony ID is in its explored_by array.
 * Alliance shared vision: if the colony has active alliance agreements,
 * hexes explored by allied colonies are also visible.
 */
export async function getVisibleHexes(worldId: string, colonyId: string): Promise<VisibleHex[]> {
  // Find alliance partners (active alliance agreements)
  const activeAlliances = await db
    .select()
    .from(agreements)
    .where(
      and(
        eq(agreements.worldId, worldId),
        sql`${agreements.type} = 'alliance'`,
        sql`${agreements.status} = 'active'`,
        or(
          eq(agreements.proposedBy, colonyId),
          eq(agreements.proposedTo, colonyId),
        ),
      ),
    );

  // Collect all colony IDs whose vision we share (self + alliance partners)
  const visibleColonyIds = [colonyId];
  for (const alliance of activeAlliances) {
    const partnerId = alliance.proposedBy === colonyId ? alliance.proposedTo : alliance.proposedBy;
    visibleColonyIds.push(partnerId);
  }

  // Query hexes visible to any of the allied colonies
  const rows = await db
    .select({
      x: hexes.x,
      y: hexes.y,
      terrain: hexes.terrain,
      resources: hexes.resources,
      settlementId: hexes.settlementId,
      poi: hexes.poi,
    })
    .from(hexes)
    .where(
      and(
        eq(hexes.worldId, worldId),
        sql`explored_by && ARRAY[${sql.join(visibleColonyIds.map(id => sql`${id}`), sql`, `)}]::text[]`,
      ),
    );

  return rows.map((h) => ({
    x: h.x,
    y: h.y,
    terrain: h.terrain,
    resources: h.resources as Record<string, number>,
    settlementId: h.settlementId,
    ...(h.poi ? { poi: h.poi as VisibleHex['poi'] } : {}),
  }));
}

// --- Routes ---

interface WorldParams {
  Params: { id: string };
}

export async function stateRoutes(app: FastifyInstance) {
  // Full colony state
  app.get<WorldParams>('/api/worlds/:id/state', {
    preHandler: requireAuth,
  }, async (request, reply) => {
    const colony = request.colony!;
    const worldId = colony.worldId;

    // Get world info (for current tick)
    const world = await db
      .select({ currentTick: worlds.currentTick, status: worlds.status })
      .from(worlds)
      .where(eq(worlds.id, worldId))
      .limit(1);

    if (world.length === 0) {
      return reply.code(404).send({ error: 'not_found', message: 'World not found' });
    }

    // Get colony resources
    const colonyData = await db
      .select()
      .from(colonies)
      .where(eq(colonies.id, colony.id))
      .limit(1);

    // Get settlements
    const colonySettlements = await db
      .select()
      .from(settlements)
      .where(eq(settlements.colonyId, colony.id));

    // Get units — select only API-visible columns (excludes internal fields like idleTicks)
    const colonyUnits = await db
      .select({
        id: units.id,
        colonyId: units.colonyId,
        type: units.type,
        hexX: units.hexX,
        hexY: units.hexY,
        health: units.health,
        morale: units.morale,
        movementQueue: units.movementQueue,
      })
      .from(units)
      .where(eq(units.colonyId, colony.id));

    // Get visible map (fog of war)
    const visibleMap = await getVisibleHexes(worldId, colony.id);

    // Get world radius for map size hint
    const worldMeta = await db
      .select({ mapRadius: worlds.mapRadius })
      .from(worlds)
      .where(eq(worlds.id, worldId))
      .limit(1);

    // Find enemy units and settlements on visible hexes
    const visibleCoords = visibleMap.map(h => ({ x: h.x, y: h.y }));
    let enemyUnitsOnMap: Array<{ id: string; colonyId: string; type: string; hex: { x: number; y: number }; health: number }> = [];
    let enemySettlementsOnMap: Array<{ id: string; colonyId: string; name: string; hex: { x: number; y: number }; tier: string }> = [];

    if (visibleCoords.length > 0) {
      // Get all enemy units on hexes visible to this colony
      const allVisibleUnits = await db
        .select({
          id: units.id,
          colonyId: units.colonyId,
          type: units.type,
          hexX: units.hexX,
          hexY: units.hexY,
          health: units.health,
        })
        .from(units)
        .where(
          and(
            eq(units.worldId, worldId),
            sql`${units.colonyId} != ${colony.id}`,
          ),
        );

      // Filter to only units on visible hexes
      const visibleSet = new Set(visibleCoords.map(c => `${c.x},${c.y}`));
      enemyUnitsOnMap = allVisibleUnits
        .filter(u => u.health > 0 && visibleSet.has(`${u.hexX},${u.hexY}`))
        .map(u => ({
          id: u.id,
          colonyId: u.colonyId,
          type: u.type,
          hex: { x: u.hexX, y: u.hexY },
          health: u.health,
        }));

      // Get enemy settlements on visible hexes
      const visibleSettlementIds = visibleMap
        .filter(h => h.settlementId !== null)
        .map(h => h.settlementId!);

      if (visibleSettlementIds.length > 0) {
        const allSettlements = await db
          .select({
            id: settlements.id,
            colonyId: settlements.colonyId,
            name: settlements.name,
            hexX: settlements.hexX,
            hexY: settlements.hexY,
            tier: settlements.tier,
          })
          .from(settlements)
          .where(
            and(
              eq(settlements.worldId, worldId),
              sql`${settlements.colonyId} != ${colony.id}`,
            ),
          );

        enemySettlementsOnMap = allSettlements
          .filter(s => visibleSet.has(`${s.hexX},${s.hexY}`))
          .map(s => ({
            id: s.id,
            colonyId: s.colonyId,
            name: s.name,
            hex: { x: s.hexX, y: s.hexY },
            tier: s.tier,
          }));
      }
    }

    // Get colony names for enemy reference
    const enemyColonyIds = new Set([
      ...enemyUnitsOnMap.map(u => u.colonyId),
      ...enemySettlementsOnMap.map(s => s.colonyId),
    ]);
    let knownColonies: Record<string, string> = {};
    if (enemyColonyIds.size > 0) {
      const colRows = await db
        .select({ id: colonies.id, name: colonies.name })
        .from(colonies)
        .where(eq(colonies.worldId, worldId));
      knownColonies = Object.fromEntries(
        colRows.filter(c => enemyColonyIds.has(c.id)).map(c => [c.id, c.name]),
      );
    }

    // Load agreements involving this colony
    const colonyAgreements = await db
      .select()
      .from(agreements)
      .where(
        and(
          eq(agreements.worldId, worldId),
          or(
            eq(agreements.proposedBy, colony.id),
            eq(agreements.proposedTo, colony.id),
          ),
        ),
      );

    // Gather partner IDs for name lookup
    const agreementPartnerIds = new Set<string>();
    for (const a of colonyAgreements) {
      agreementPartnerIds.add(a.proposedBy === colony.id ? a.proposedTo : a.proposedBy);
    }
    // Ensure we have names for agreement partners
    if (agreementPartnerIds.size > 0) {
      const missingIds = [...agreementPartnerIds].filter(id => !knownColonies[id]);
      if (missingIds.length > 0) {
        const partnerRows = await db
          .select({ id: colonies.id, name: colonies.name })
          .from(colonies)
          .where(eq(colonies.worldId, worldId));
        for (const c of partnerRows) {
          if (missingIds.includes(c.id)) {
            knownColonies[c.id] = c.name;
          }
        }
      }
    }

    // Filter to active/proposed only for state view
    const visibleAgreements = colonyAgreements
      .filter(a => a.status === 'active' || a.status === 'proposed')
      .map(a => {
        const partnerId = a.proposedBy === colony.id ? a.proposedTo : a.proposedBy;
        return {
          id: a.id,
          type: a.type,
          status: a.status,
          partnerColonyId: partnerId,
          partnerName: knownColonies[partnerId] ?? 'Unknown',
          terms: a.terms,
          proposedAtTick: a.proposedAtTick,
          acceptedAtTick: a.acceptedAtTick,
          direction: a.proposedBy === colony.id ? 'outgoing' : 'incoming',
        };
      });

    return {
      tick: world[0].currentTick,
      worldStatus: world[0].status,
      mapRadius: worldMeta[0]?.mapRadius ?? null,
      colony: {
        id: colony.id,
        name: colony.name,
        status: colonyData[0]?.status ?? 'active',
        resources: colonyData[0]?.resources ?? {},
        legacyScore: colonyData[0]?.legacyScore ?? 0,
        newcomerProtectionUntilTick: (colonyData[0] as any)?.newcomerProtectionUntilTick ?? 0,
        ...((colonyData[0] as any)?.diedAtTick ? {
          diedAtTick: (colonyData[0] as any).diedAtTick,
          deathReason: (colonyData[0] as any).deathReason,
        } : {}),
      },
      research: {
        researched: (colonyData[0] as any)?.researchedTechs ?? [],
        queue: (colonyData[0] as any)?.researchQueue ?? [],
      },
      agreements: visibleAgreements,
      settlements: colonySettlements.map((s) => ({
        id: s.id,
        name: s.name,
        hex: { x: s.hexX, y: s.hexY },
        tier: s.tier,
        buildings: s.buildings,
        buildQueue: s.buildQueue,
        loyalty: s.loyalty,
        population: s.population,
      })),
      units: colonyUnits.map((u) => ({
        id: u.id,
        type: u.type,
        hex: { x: u.hexX, y: u.hexY },
        health: u.health,
        morale: u.morale,
        movementQueue: u.movementQueue,
      })),
      intel: {
        enemyUnits: enemyUnitsOnMap,
        enemySettlements: enemySettlementsOnMap,
        knownColonies,
      },
      map: visibleMap,
    };
  });

  // Map only (fog of war)
  app.get<WorldParams>('/api/worlds/:id/map', {
    preHandler: requireAuth,
  }, async (request, reply) => {
    const colony = request.colony!;

    const world = await db
      .select({ currentTick: worlds.currentTick })
      .from(worlds)
      .where(eq(worlds.id, colony.worldId))
      .limit(1);

    if (world.length === 0) {
      return reply.code(404).send({ error: 'not_found', message: 'World not found' });
    }

    const visibleMap = await getVisibleHexes(colony.worldId, colony.id);

    return {
      tick: world[0].currentTick,
      colonyId: colony.id,
      hexCount: visibleMap.length,
      hexes: visibleMap,
    };
  });

  app.get<WorldParams & { Querystring: { limit?: string } }>('/api/worlds/:id/analysis/settlement-sites', {
    preHandler: requireAuth,
  }, async (request, reply) => {
    const colony = request.colony!;
    const rawLimit = Number.parseInt(request.query.limit ?? '5', 10);
    const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(rawLimit, 1), 10) : 5;

    const world = await db
      .select({ currentTick: worlds.currentTick })
      .from(worlds)
      .where(eq(worlds.id, colony.worldId))
      .limit(1);

    if (world.length === 0) {
      return reply.code(404).send({ error: 'not_found', message: 'World not found' });
    }

    const visibleMap = await getVisibleHexes(colony.worldId, colony.id);
    const candidates = analyzeSettlementSites(visibleMap, limit);

    return {
      tick: world[0].currentTick,
      colonyId: colony.id,
      count: candidates.length,
      candidates,
    };
  });

  // Tech tree (authenticated — shows what's available + what you've researched)
  app.get<WorldParams>('/api/worlds/:id/tech', {
    preHandler: requireAuth,
  }, async (request, reply) => {
    const colony = request.colony!;

    const colonyData = await db
      .select()
      .from(colonies)
      .where(eq(colonies.id, colony.id))
      .limit(1);

    const researched: string[] = (colonyData[0] as any)?.researchedTechs ?? [];
    const queue: Array<{ techId: string; ticksRemaining: number }> = (colonyData[0] as any)?.researchQueue ?? [];

    const techs = Object.values(TECH_TREE).map(tech => ({
      id: tech.id,
      name: tech.name,
      description: tech.description,
      cost: tech.cost,
      ticks: tech.ticks,
      tier: tech.tier,
      requires: tech.requires ?? [],
      status: researched.includes(tech.id)
        ? 'researched'
        : queue.some(q => q.techId === tech.id)
          ? 'in_progress'
          : canResearchTech(tech.id, researched).ok
            ? 'available'
            : 'locked',
      ticksRemaining: queue.find(q => q.techId === tech.id)?.ticksRemaining ?? null,
    }));

    return {
      colonyId: colony.id,
      researched,
      queue,
      techs,
    };
  });
}
