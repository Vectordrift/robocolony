/**
 * Public feed endpoint — world activity visible to spectators.
 *
 * GET /api/worlds/:id/feed — public events + colony summary (no auth required)
 *   Query params:
 *     since_tick — only events after this tick (exclusive)
 *     limit      — max events to return (default 50, max 200)
 */

import type { FastifyInstance } from 'fastify';
import { eq, and, gt, desc } from 'drizzle-orm';
import { db } from '../db/index.js';
import { worlds, events, colonies, settlements, units } from '../db/schema/index.js';

// --- Types ---

interface FeedQueryParams {
  Params: { id: string };
  Querystring: {
    since_tick?: string;
    limit?: string;
  };
}

export interface SpectatorFeedEvent {
  id: string;
  tick: number;
  type: string;
  colonyId: string | null;
  data: Record<string, unknown>;
  createdAt?: string;
  summary?: string;
  importance?: 'high' | 'normal' | 'low';
  groupedCount?: number;
  groupedTypes?: string[];
}

export interface SpectatorRecap {
  startTick: number | null;
  endTick: number | null;
  eventCount: number;
  summary: string;
  highlights: string[];
}

interface PublicColonySummaryInput {
  id: string;
  name: string;
  status: string;
  legacyScore: number | null;
}

interface PublicSettlementRow {
  colonyId: string;
  tier: string;
}

interface PublicUnitRow {
  colonyId: string;
  type?: string;
}

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

function pluralize(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

function isLiveColonyStatus(status: string): boolean {
  return status === 'active' || status === 'full';
}

export function buildPublicColonySummary(
  colony: PublicColonySummaryInput,
  settlementRows: PublicSettlementRow[],
  unitRows: PublicUnitRow[],
) {
  const live = isLiveColonyStatus(colony.status);
  const mySettlements = live ? settlementRows.filter((s) => s.colonyId === colony.id) : [];
  const myUnits = live ? unitRows.filter((u) => u.colonyId === colony.id) : [];

  return {
    id: colony.id,
    name: colony.name,
    status: colony.status,
    legacyScore: colony.legacyScore ?? 0,
    settlements: mySettlements.length,
    settlementTiers: {
      outpost: mySettlements.filter((s) => s.tier === 'outpost').length,
      town: mySettlements.filter((s) => s.tier === 'town').length,
      city: mySettlements.filter((s) => s.tier === 'city').length,
    },
    units: myUnits.length,
    unitTypes: {
      scout: myUnits.filter((u) => u.type === 'scout').length,
      militia: myUnits.filter((u) => u.type === 'militia').length,
      soldier: myUnits.filter((u) => u.type === 'soldier').length,
      siege: myUnits.filter((u) => u.type === 'siege').length,
      settler: myUnits.filter((u) => u.type === 'settler').length,
    },
  };
}

function getEventImportance(event: SpectatorFeedEvent): 'high' | 'normal' | 'low' {
  switch (event.type) {
    case 'settlement_founded':
    case 'settlement_upgraded':
    case 'settlement_captured':
    case 'settlement_lost':
    case 'research_complete':
    case 'agreement_accepted':
    case 'agreement_broken':
    case 'colony_eliminated':
      return 'high';
    case 'unit_trained':
    case 'build_complete':
    case 'build_started':
      return 'low';
    case 'combat_resolved': {
      const attackerLosses = Number(event.data.attackerLosses ?? 0);
      const defenderLosses = Number(event.data.defenderLosses ?? 0);
      return attackerLosses + defenderLosses > 0 ? 'high' : 'low';
    }
    default:
      return 'normal';
  }
}

function describeFeedEvent(event: SpectatorFeedEvent): string {
  const data = event.data ?? {};
  switch (event.type) {
    case 'settlement_founded':
      return typeof data.name === 'string' ? `founded ${data.name}` : 'founded a settlement';
    case 'settlement_upgraded':
      return typeof data.name === 'string'
        ? `upgraded ${data.name} to ${String(data.tier ?? 'a higher tier')}`
        : 'upgraded a settlement';
    case 'research_complete':
      return typeof data.techName === 'string' ? `completed ${data.techName} research` : 'completed research';
    case 'unit_trained':
      return typeof data.unitType === 'string' ? `trained ${data.unitType}` : 'trained a unit';
    case 'build_complete':
      return typeof data.buildingType === 'string' ? `completed ${data.buildingType}` : 'completed construction';
    case 'combat_resolved': {
      const attackerLosses = Number(data.attackerLosses ?? 0);
      const defenderLosses = Number(data.defenderLosses ?? 0);
      if (attackerLosses + defenderLosses === 0) {
        return 'frontier skirmish with no losses';
      }
      return `combat with ${attackerLosses + defenderLosses} total losses`;
    }
    default:
      return event.type.replace(/_/g, ' ');
  }
}

function getCombatLocationKey(event: SpectatorFeedEvent): string {
  const x = Number(event.data.hexX ?? NaN);
  const y = Number(event.data.hexY ?? NaN);
  return Number.isFinite(x) && Number.isFinite(y) ? `${x},${y}` : 'unknown';
}

export function aggregateFeedEvents(events: SpectatorFeedEvent[]): SpectatorFeedEvent[] {
  const aggregated: SpectatorFeedEvent[] = [];

  for (const event of events) {
    const enriched: SpectatorFeedEvent = {
      ...event,
      importance: getEventImportance(event),
    };

    if (event.type === 'unit_trained') {
      const unitType = typeof event.data.unitType === 'string' ? event.data.unitType : 'unit';
      const existing = aggregated.find((candidate) =>
        candidate.type === 'unit_trained'
        && candidate.tick === event.tick
        && candidate.colonyId === event.colonyId
        && candidate.data.unitType === unitType,
      );

      if (existing) {
        existing.groupedCount = (existing.groupedCount ?? 1) + 1;
        existing.summary = `raised forces: trained ${existing.groupedCount} ${unitType}${existing.groupedCount === 1 ? '' : 's'}`;
        continue;
      }

      enriched.groupedCount = 1;
      enriched.summary = `raised forces: trained 1 ${unitType}`;
      aggregated.push(enriched);
      continue;
    }

    if (event.type === 'combat_resolved') {
      const attackerLosses = Number(event.data.attackerLosses ?? 0);
      const defenderLosses = Number(event.data.defenderLosses ?? 0);

      if (attackerLosses + defenderLosses === 0) {
        const locationKey = getCombatLocationKey(event);
        const existing = aggregated.find((candidate) =>
          candidate.type === 'combat_resolved'
          && candidate.tick === event.tick
          && candidate.colonyId === event.colonyId
          && candidate.data.attackerLosses === 0
          && candidate.data.defenderLosses === 0
          && getCombatLocationKey(candidate) === locationKey,
        );

        if (existing) {
          existing.groupedCount = (existing.groupedCount ?? 1) + 1;
          existing.summary = `frontier skirmishing continued (${existing.groupedCount} clashes, no losses)`;
          continue;
        }

        enriched.groupedCount = 1;
        enriched.summary = 'frontier skirmish with no losses';
        aggregated.push(enriched);
        continue;
      }
    }

    const existingTickSummary = aggregated.find((candidate) =>
      candidate.type === 'tick_summary'
      && candidate.tick === event.tick
      && candidate.colonyId === event.colonyId
      && candidate.importance === 'low'
      && enriched.importance === 'low',
    );

    if (existingTickSummary) {
      const existingSummaries = Array.isArray(existingTickSummary.data.summaries)
        ? (existingTickSummary.data.summaries as string[])
        : [];
      const nextSummaries = [...existingSummaries, describeFeedEvent(enriched)];
      existingTickSummary.data.summaries = nextSummaries;
      existingTickSummary.data.groupedEvents = [...((existingTickSummary.data.groupedEvents as string[]) ?? []), enriched.type];
      existingTickSummary.groupedCount = (existingTickSummary.groupedCount ?? 1) + 1;
      existingTickSummary.groupedTypes = [...new Set((existingTickSummary.groupedTypes ?? []).concat(enriched.type))];
      existingTickSummary.summary = `activity update: ${nextSummaries.slice(0, 3).join(', ')}${nextSummaries.length > 3 ? `, +${nextSummaries.length - 3} more` : ''}`;
      continue;
    }

    if (enriched.importance === 'low' && event.type !== 'unit_trained' && event.type !== 'combat_resolved') {
      aggregated.push({
        ...enriched,
        type: 'tick_summary',
        id: `${event.id}:summary`,
        groupedCount: 1,
        groupedTypes: [event.type],
        summary: `activity update: ${describeFeedEvent(enriched)}`,
        data: {
          summaries: [describeFeedEvent(enriched)],
          groupedEvents: [event.type],
        },
      });
      continue;
    }

    aggregated.push({
      ...enriched,
      summary: enriched.summary ?? describeFeedEvent(enriched),
    });
  }

  return aggregated.sort((a, b) => {
    if (b.tick !== a.tick) return b.tick - a.tick;
    const priority = { high: 0, normal: 1, low: 2 } as const;
    return priority[a.importance ?? 'normal'] - priority[b.importance ?? 'normal'];
  });
}

export function buildSpectatorRecap(
  events: SpectatorFeedEvent[],
  colonyNames: Record<string, string>,
): SpectatorRecap {
  if (events.length === 0) {
    return {
      startTick: null,
      endTick: null,
      eventCount: 0,
      summary: 'Quiet frontier. No public events were recorded in this window.',
      highlights: ['No colony actions have surfaced on the public feed for this recap window yet.'],
    };
  }

  const ticks = events.map((event) => event.tick);
  const startTick = Math.min(...ticks);
  const endTick = Math.max(...ticks);

  const founded = events.filter((event) => event.type === 'settlement_founded');
  const upgraded = events.filter((event) => event.type === 'settlement_upgraded');
  const researched = events.filter((event) => event.type === 'research_complete');
  const treaties = events.filter((event) => event.type === 'agreement_accepted' || event.type === 'agreement_broken');
  const poiSurveys = events.filter((event) => event.type === 'poi_surveyed');
  const combats = events.filter((event) => event.type === 'combat_resolved');

  const summaryParts: string[] = [];
  if (combats.length > 0) summaryParts.push(pluralize(combats.length, 'battle'));
  if (founded.length > 0) summaryParts.push(pluralize(founded.length, 'settlement') + ' founded');
  if (researched.length > 0) summaryParts.push(pluralize(researched.length, 'research milestone'));
  if (treaties.length > 0) summaryParts.push(pluralize(treaties.length, 'treaty shift'));
  if (poiSurveys.length > 0) summaryParts.push(pluralize(poiSurveys.length, 'frontier survey'));
  if (summaryParts.length === 0) summaryParts.push(pluralize(events.length, 'public event'));

  const highlights: string[] = [];

  if (combats.length > 0) {
    const hotspotByHex = new Map<string, { count: number; casualties: number; x: number; y: number }>();
    for (const combat of combats) {
      const x = Number(combat.data.hexX ?? 0);
      const y = Number(combat.data.hexY ?? 0);
      const key = `${x},${y}`;
      const current = hotspotByHex.get(key) ?? { count: 0, casualties: 0, x, y };
      current.count += 1;
      current.casualties += Number(combat.data.casualties ?? 0);
      hotspotByHex.set(key, current);
    }
    const topHotspot = [...hotspotByHex.values()].sort((a, b) => b.casualties - a.casualties || b.count - a.count)[0];
    highlights.push(`Battles centered on (${topHotspot.x}, ${topHotspot.y}), with ${topHotspot.casualties} reported casualties across ${pluralize(topHotspot.count, 'engagement')}.`);
  }

  if (founded.length > 0) {
    const foundedNames = founded
      .map((event) => event.data.name)
      .filter((name): name is string => typeof name === 'string')
      .slice(0, 3);
    const foundedText = foundedNames.length > 0
      ? foundedNames.map((name) => `"${name}"`).join(', ')
      : pluralize(founded.length, 'settlement');
    highlights.push(`New footholds appeared on the map: ${foundedText}.`);
  }

  if (researched.length > 0) {
    const latestResearch = researched[0];
    const colonyName = latestResearch.colonyId ? (colonyNames[latestResearch.colonyId] ?? latestResearch.colonyId) : 'A colony';
    const techName = typeof latestResearch.data.techName === 'string' ? latestResearch.data.techName : 'new technology';
    highlights.push(`${colonyName} reached a new research milestone with ${techName}.`);
  }

  if (treaties.length > 0) {
    const accepted = treaties.filter((event) => event.type === 'agreement_accepted').length;
    const broken = treaties.filter((event) => event.type === 'agreement_broken').length;
    const treatyParts: string[] = [];
    if (accepted > 0) treatyParts.push(`${pluralize(accepted, 'agreement')} signed`);
    if (broken > 0) treatyParts.push(`${pluralize(broken, 'agreement')} broken`);
    highlights.push(`Diplomacy shifted as ${treatyParts.join(' and ')}.`);
  }

  if (poiSurveys.length > 0) {
    const byType = new Map<string, number>();
    for (const survey of poiSurveys) {
      const poiType = typeof survey.data.poiType === 'string' ? survey.data.poiType : 'poi';
      byType.set(poiType, (byType.get(poiType) ?? 0) + 1);
    }
    const topType = [...byType.entries()].sort((a, b) => b[1] - a[1])[0];
    highlights.push(`Scouts turned exploration into stories, surveying ${pluralize(topType[1], topType[0].replace(/_/g, ' '))}.`);
  }

  if (upgraded.length > 0 && highlights.length < 4) {
    highlights.push(`${pluralize(upgraded.length, 'settlement upgrade')} pushed the frontier toward more durable holdings.`);
  }

  return {
    startTick,
    endTick,
    eventCount: events.length,
    summary: `Ticks ${startTick}-${endTick}: ${summaryParts.join(', ')}.`,
    highlights: highlights.slice(0, 4),
  };
}

// --- Routes ---

export async function feedRoutes(app: FastifyInstance) {
  // Public event feed (no auth)
  app.get<FeedQueryParams>('/api/worlds/:id/feed', async (request, reply) => {
    const worldId = request.params.id;

    // Get world
    const worldRows = await db
      .select()
      .from(worlds)
      .where(eq(worlds.id, worldId))
      .limit(1);

    if (worldRows.length === 0) {
      return reply.code(404).send({ error: 'not_found', message: 'World not found' });
    }

    const world = worldRows[0];

    // Parse query params
    const sinceTick = request.query.since_tick
      ? parseInt(request.query.since_tick, 10)
      : undefined;

    let limit = request.query.limit
      ? parseInt(request.query.limit, 10)
      : DEFAULT_LIMIT;

    if (isNaN(limit) || limit < 1) limit = DEFAULT_LIMIT;
    if (limit > MAX_LIMIT) limit = MAX_LIMIT;

    // Query public events only
    const conditions = [
      eq(events.worldId, worldId),
      eq(events.public, true),
    ];

    if (sinceTick !== undefined && !isNaN(sinceTick)) {
      conditions.push(gt(events.tick, sinceTick));
    }

    const eventRows = await db
      .select({
        id: events.id,
        tick: events.tick,
        type: events.type,
        data: events.data,
        publicData: events.publicData,
        visibility: events.visibility,
        createdAt: events.createdAt,
      })
      .from(events)
      .where(and(...conditions))
      .orderBy(desc(events.tick))
      .limit(limit);

    // Map events: always prefer publicData for spectator view; never fall back to full data
    const feedEvents = aggregateFeedEvents(eventRows.map((row) => ({
      id: row.id,
      tick: row.tick,
      type: row.type,
      colonyId: (row.visibility as string[] | null)?.[0] ?? null,
      data: (row.publicData ?? {}) as Record<string, unknown>,
      ...(row.createdAt ? { createdAt: row.createdAt.toISOString() } : {}),
    })));

    // Get colony summaries (public info only)
    const colonyRows = await db
      .select({
        id: colonies.id,
        name: colonies.name,
        status: colonies.status,
        legacyScore: colonies.legacyScore,
      })
      .from(colonies)
      .where(eq(colonies.worldId, worldId));

    // Get settlement counts per colony
    const settlementRows = await db
      .select({
        colonyId: settlements.colonyId,
        tier: settlements.tier,
      })
      .from(settlements)
      .where(eq(settlements.worldId, worldId));

    // Get unit counts per colony
    const unitRows = await db
      .select({
        colonyId: units.colonyId,
        type: units.type,
      })
      .from(units)
      .where(eq(units.worldId, worldId));

    // Build colony summaries
    const colonySummaries = colonyRows.map((c) => buildPublicColonySummary(c, settlementRows, unitRows));

    return {
      world: {
        id: world.id,
        name: world.name,
        status: world.status,
        currentTick: world.currentTick,
        tickRate: world.tickRate,
        colonyCount: colonyRows.length,
      },
      colonies: colonySummaries,
      events: feedEvents,
    };
  });

  app.get<FeedQueryParams>('/api/worlds/:id/recap', async (request, reply) => {
    const worldId = request.params.id;

    const worldRows = await db
      .select()
      .from(worlds)
      .where(eq(worlds.id, worldId))
      .limit(1);

    if (worldRows.length === 0) {
      return reply.code(404).send({ error: 'not_found', message: 'World not found' });
    }

    const world = worldRows[0];
    const sinceTick = request.query.since_tick ? parseInt(request.query.since_tick, 10) : undefined;
    let limit = request.query.limit ? parseInt(request.query.limit, 10) : DEFAULT_LIMIT;
    if (isNaN(limit) || limit < 1) limit = DEFAULT_LIMIT;
    if (limit > MAX_LIMIT) limit = MAX_LIMIT;

    const conditions = [
      eq(events.worldId, worldId),
      eq(events.public, true),
    ];
    if (sinceTick !== undefined && !isNaN(sinceTick)) {
      conditions.push(gt(events.tick, sinceTick));
    }

    const eventRows = await db
      .select({
        id: events.id,
        tick: events.tick,
        type: events.type,
        publicData: events.publicData,
        visibility: events.visibility,
        createdAt: events.createdAt,
      })
      .from(events)
      .where(and(...conditions))
      .orderBy(desc(events.tick))
      .limit(limit);

    const recapEvents: SpectatorFeedEvent[] = eventRows.map((row) => ({
      id: row.id,
      tick: row.tick,
      type: row.type,
      colonyId: (row.visibility as string[] | null)?.[0] ?? null,
      data: (row.publicData ?? {}) as Record<string, unknown>,
      ...(row.createdAt ? { createdAt: row.createdAt.toISOString() } : {}),
    }));

    const colonyRows = await db
      .select({ id: colonies.id, name: colonies.name })
      .from(colonies)
      .where(eq(colonies.worldId, worldId));

    const colonyNames = Object.fromEntries(colonyRows.map((colony) => [colony.id, colony.name]));

    return {
      world: {
        id: world.id,
        name: world.name,
        status: world.status,
        currentTick: world.currentTick,
      },
      recap: buildSpectatorRecap(recapEvents, colonyNames),
    };
  });

  // --- Public leaderboard endpoint (50-tick delay for strategic safety) ---
  app.get<{ Params: { id: string } }>('/api/worlds/:id/leaderboard', async (request, reply) => {
    const worldId = request.params.id;
    const LEADERBOARD_DELAY_TICKS = 50;

    const worldRows = await db
      .select()
      .from(worlds)
      .where(eq(worlds.id, worldId))
      .limit(1);

    if (worldRows.length === 0) {
      return reply.code(404).send({ error: 'not_found', message: 'World not found' });
    }

    const world = worldRows[0];
    const displayTick = Math.max(0, (world.currentTick ?? 0) - LEADERBOARD_DELAY_TICKS);

    const colonyRows = await db
      .select({
        id: colonies.id,
        name: colonies.name,
        status: colonies.status,
        legacyScore: colonies.legacyScore,
        createdAt: colonies.createdAt,
      })
      .from(colonies)
      .where(eq(colonies.worldId, worldId));

    const settlementRows = await db
      .select({
        colonyId: settlements.colonyId,
        tier: settlements.tier,
      })
      .from(settlements)
      .where(eq(settlements.worldId, worldId));

    const unitRows = await db
      .select({
        colonyId: units.colonyId,
      })
      .from(units)
      .where(eq(units.worldId, worldId));

    const ranked = colonyRows.map((c) => {
      const summary = buildPublicColonySummary(c, settlementRows, unitRows);
      return {
        name: summary.name,
        status: summary.status,
        legacyScore: summary.legacyScore,
        settlements: summary.settlements,
        units: summary.units,
        founded: c.createdAt,
      };
    })
    .sort((a, b) => b.legacyScore - a.legacyScore)
    .map((c, i) => ({ rank: i + 1, ...c }));

    return {
      worldId: world.id,
      worldName: world.name,
      currentTick: world.currentTick,
      asOfTick: displayTick,
      delayedTicks: LEADERBOARD_DELAY_TICKS,
      colonies: ranked,
    };
  });
}
