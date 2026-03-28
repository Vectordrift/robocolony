/**
 * SQL-based schema migration.
 * Runs on startup to ensure all expected columns exist.
 * This replaces drizzle-kit push which cannot run in the deploy environment.
 */

import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { sql } from 'drizzle-orm';

interface MigrationLogger {
  info: (msg: string) => void;
  error: (msg: string) => void;
}

interface ColumnDef {
  table: string;
  column: string;
  type: string;
  defaultValue?: string;
  nullable?: boolean;
}

const CREATE_TABLE_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS sectors (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'open',
    strategic_value INTEGER NOT NULL DEFAULT 0,
    simulation_mode TEXT NOT NULL DEFAULT 'detailed',
    heat_score INTEGER NOT NULL DEFAULT 0,
    last_evaluated_tick INTEGER NOT NULL DEFAULT 0,
    position_x INTEGER,
    position_y INTEGER,
    aggregate_state JSONB NOT NULL DEFAULT '{}'::jsonb,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT NOW()
  )`,
  `CREATE TABLE IF NOT EXISTS star_systems (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    sector_id TEXT,
    status TEXT NOT NULL DEFAULT 'surveyed',
    importance INTEGER NOT NULL DEFAULT 0,
    simulation_mode TEXT NOT NULL DEFAULT 'detailed',
    heat_score INTEGER NOT NULL DEFAULT 0,
    last_active_tick INTEGER NOT NULL DEFAULT 0,
    position_x INTEGER,
    position_y INTEGER,
    claimants JSONB NOT NULL DEFAULT '[]'::jsonb,
    neighbor_system_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
    aggregate_state JSONB NOT NULL DEFAULT '{}'::jsonb,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT NOW()
  )`,
  `CREATE TABLE IF NOT EXISTS star_lanes (
    id TEXT PRIMARY KEY,
    from_system_id TEXT NOT NULL,
    to_system_id TEXT NOT NULL,
    lane_class TEXT NOT NULL DEFAULT 'standard',
    travel_cost INTEGER NOT NULL DEFAULT 1,
    travel_ticks INTEGER NOT NULL DEFAULT 1,
    chokepoint BOOLEAN NOT NULL DEFAULT false,
    visibility TEXT NOT NULL DEFAULT 'public',
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT NOW()
  )`,
  `CREATE TABLE IF NOT EXISTS fleets (
    id TEXT PRIMARY KEY,
    colony_id TEXT NOT NULL,
    star_system_id TEXT NOT NULL,
    home_system_id TEXT,
    current_lane_id TEXT,
    type TEXT NOT NULL DEFAULT 'task_force',
    status TEXT NOT NULL DEFAULT 'idle',
    mission_type TEXT NOT NULL DEFAULT 'hold',
    mission_target_type TEXT,
    mission_target_id TEXT,
    strength INTEGER NOT NULL DEFAULT 0,
    morale INTEGER NOT NULL DEFAULT 100,
    supply INTEGER NOT NULL DEFAULT 100,
    eta_tick INTEGER,
    visibility TEXT NOT NULL DEFAULT 'private',
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT NOW()
  )`,
  `CREATE TABLE IF NOT EXISTS orbital_assets (
    id TEXT PRIMARY KEY,
    colony_id TEXT,
    star_system_id TEXT NOT NULL,
    world_id TEXT,
    type TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'operational',
    orbital_slot INTEGER,
    control_level INTEGER NOT NULL DEFAULT 0,
    capacity INTEGER NOT NULL DEFAULT 0,
    visibility TEXT NOT NULL DEFAULT 'public',
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT NOW()
  )`,
  `CREATE TABLE IF NOT EXISTS feedback_reports (
    id TEXT PRIMARY KEY,
    world_id TEXT NOT NULL REFERENCES worlds(id),
    colony_id TEXT REFERENCES colonies(id),
    reporter_name TEXT,
    type TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    tick INTEGER,
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT NOW()
  )`,
  `CREATE INDEX IF NOT EXISTS idx_feedback_world_created ON feedback_reports(world_id, created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_feedback_type_created ON feedback_reports(type, created_at)`,
];

/**
 * Expected schema — every column in every table.
 * When adding a new column to a schema file, add it here too.
 * The migration will ADD COLUMN IF NOT EXISTS for any missing ones.
 */
const EXPECTED_COLUMNS: ColumnDef[] = [
  // worlds
  { table: 'worlds', column: 'id', type: 'TEXT' },
  { table: 'worlds', column: 'name', type: 'TEXT' },
  { table: 'worlds', column: 'tick_rate', type: 'INTEGER', defaultValue: '300000' },
  { table: 'worlds', column: 'current_tick', type: 'INTEGER', defaultValue: '0' },
  { table: 'worlds', column: 'map_seed', type: 'INTEGER' },
  { table: 'worlds', column: 'status', type: 'TEXT', defaultValue: "'open'" },
  { table: 'worlds', column: 'map_radius', type: 'INTEGER', defaultValue: '50' },
  { table: 'worlds', column: 'max_colonies', type: 'INTEGER', defaultValue: '8' },
  { table: 'worlds', column: 'star_system_id', type: 'TEXT', nullable: true },
  { table: 'worlds', column: 'theater_type', type: 'TEXT', defaultValue: "'surface'" },
  { table: 'worlds', column: 'orbital_slot', type: 'INTEGER', nullable: true },
  { table: 'worlds', column: 'created_at', type: 'TIMESTAMPTZ', defaultValue: 'NOW()', nullable: true },

  // star_systems
  { table: 'star_systems', column: 'id', type: 'TEXT' },
  { table: 'star_systems', column: 'name', type: 'TEXT' },
  { table: 'star_systems', column: 'sector_id', type: 'TEXT', nullable: true },
  { table: 'star_systems', column: 'status', type: 'TEXT', defaultValue: "'surveyed'" },
  { table: 'star_systems', column: 'importance', type: 'INTEGER', defaultValue: '0' },
  { table: 'star_systems', column: 'simulation_mode', type: 'TEXT', defaultValue: "'detailed'" },
  { table: 'star_systems', column: 'heat_score', type: 'INTEGER', defaultValue: '0' },
  { table: 'star_systems', column: 'last_active_tick', type: 'INTEGER', defaultValue: '0' },
  { table: 'star_systems', column: 'position_x', type: 'INTEGER', nullable: true },
  { table: 'star_systems', column: 'position_y', type: 'INTEGER', nullable: true },
  { table: 'star_systems', column: 'claimants', type: 'JSONB', defaultValue: "'[]'::jsonb" },
  { table: 'star_systems', column: 'neighbor_system_ids', type: 'JSONB', defaultValue: "'[]'::jsonb" },
  { table: 'star_systems', column: 'aggregate_state', type: 'JSONB', defaultValue: "'{}'::jsonb" },
  { table: 'star_systems', column: 'metadata', type: 'JSONB', defaultValue: "'{}'::jsonb" },
  { table: 'star_systems', column: 'created_at', type: 'TIMESTAMPTZ', defaultValue: 'NOW()', nullable: true },

  // sectors
  { table: 'sectors', column: 'id', type: 'TEXT' },
  { table: 'sectors', column: 'name', type: 'TEXT' },
  { table: 'sectors', column: 'status', type: 'TEXT', defaultValue: "'open'" },
  { table: 'sectors', column: 'strategic_value', type: 'INTEGER', defaultValue: '0' },
  { table: 'sectors', column: 'simulation_mode', type: 'TEXT', defaultValue: "'detailed'" },
  { table: 'sectors', column: 'heat_score', type: 'INTEGER', defaultValue: '0' },
  { table: 'sectors', column: 'last_evaluated_tick', type: 'INTEGER', defaultValue: '0' },
  { table: 'sectors', column: 'position_x', type: 'INTEGER', nullable: true },
  { table: 'sectors', column: 'position_y', type: 'INTEGER', nullable: true },
  { table: 'sectors', column: 'aggregate_state', type: 'JSONB', defaultValue: "'{}'::jsonb" },
  { table: 'sectors', column: 'metadata', type: 'JSONB', defaultValue: "'{}'::jsonb" },
  { table: 'sectors', column: 'created_at', type: 'TIMESTAMPTZ', defaultValue: 'NOW()', nullable: true },

  // star_lanes
  { table: 'star_lanes', column: 'id', type: 'TEXT' },
  { table: 'star_lanes', column: 'from_system_id', type: 'TEXT' },
  { table: 'star_lanes', column: 'to_system_id', type: 'TEXT' },
  { table: 'star_lanes', column: 'lane_class', type: 'TEXT', defaultValue: "'standard'" },
  { table: 'star_lanes', column: 'travel_cost', type: 'INTEGER', defaultValue: '1' },
  { table: 'star_lanes', column: 'travel_ticks', type: 'INTEGER', defaultValue: '1' },
  { table: 'star_lanes', column: 'chokepoint', type: 'BOOLEAN', defaultValue: 'false' },
  { table: 'star_lanes', column: 'visibility', type: 'TEXT', defaultValue: "'public'" },
  { table: 'star_lanes', column: 'metadata', type: 'JSONB', defaultValue: "'{}'::jsonb" },
  { table: 'star_lanes', column: 'created_at', type: 'TIMESTAMPTZ', defaultValue: 'NOW()', nullable: true },

  // fleets
  { table: 'fleets', column: 'id', type: 'TEXT' },
  { table: 'fleets', column: 'colony_id', type: 'TEXT' },
  { table: 'fleets', column: 'star_system_id', type: 'TEXT' },
  { table: 'fleets', column: 'home_system_id', type: 'TEXT', nullable: true },
  { table: 'fleets', column: 'current_lane_id', type: 'TEXT', nullable: true },
  { table: 'fleets', column: 'type', type: 'TEXT', defaultValue: "'task_force'" },
  { table: 'fleets', column: 'status', type: 'TEXT', defaultValue: "'idle'" },
  { table: 'fleets', column: 'mission_type', type: 'TEXT', defaultValue: "'hold'" },
  { table: 'fleets', column: 'mission_target_type', type: 'TEXT', nullable: true },
  { table: 'fleets', column: 'mission_target_id', type: 'TEXT', nullable: true },
  { table: 'fleets', column: 'strength', type: 'INTEGER', defaultValue: '0' },
  { table: 'fleets', column: 'morale', type: 'INTEGER', defaultValue: '100' },
  { table: 'fleets', column: 'supply', type: 'INTEGER', defaultValue: '100' },
  { table: 'fleets', column: 'eta_tick', type: 'INTEGER', nullable: true },
  { table: 'fleets', column: 'visibility', type: 'TEXT', defaultValue: "'private'" },
  { table: 'fleets', column: 'metadata', type: 'JSONB', defaultValue: "'{}'::jsonb" },
  { table: 'fleets', column: 'created_at', type: 'TIMESTAMPTZ', defaultValue: 'NOW()', nullable: true },

  // orbital_assets
  { table: 'orbital_assets', column: 'id', type: 'TEXT' },
  { table: 'orbital_assets', column: 'colony_id', type: 'TEXT', nullable: true },
  { table: 'orbital_assets', column: 'star_system_id', type: 'TEXT' },
  { table: 'orbital_assets', column: 'world_id', type: 'TEXT', nullable: true },
  { table: 'orbital_assets', column: 'type', type: 'TEXT' },
  { table: 'orbital_assets', column: 'status', type: 'TEXT', defaultValue: "'operational'" },
  { table: 'orbital_assets', column: 'orbital_slot', type: 'INTEGER', nullable: true },
  { table: 'orbital_assets', column: 'control_level', type: 'INTEGER', defaultValue: '0' },
  { table: 'orbital_assets', column: 'capacity', type: 'INTEGER', defaultValue: '0' },
  { table: 'orbital_assets', column: 'visibility', type: 'TEXT', defaultValue: "'public'" },
  { table: 'orbital_assets', column: 'metadata', type: 'JSONB', defaultValue: "'{}'::jsonb" },
  { table: 'orbital_assets', column: 'created_at', type: 'TIMESTAMPTZ', defaultValue: 'NOW()', nullable: true },

  // colonies
  { table: 'colonies', column: 'id', type: 'TEXT' },
  { table: 'colonies', column: 'world_id', type: 'TEXT' },
  { table: 'colonies', column: 'name', type: 'TEXT' },
  { table: 'colonies', column: 'api_key_hash', type: 'TEXT' },
  { table: 'colonies', column: 'resources', type: 'JSONB' },
  { table: 'colonies', column: 'legacy_score', type: 'INTEGER', defaultValue: '0' },
  { table: 'colonies', column: 'researched_techs', type: 'JSONB', defaultValue: "'[]'", nullable: true },
  { table: 'colonies', column: 'research_queue', type: 'JSONB', defaultValue: "'[]'", nullable: true },
  { table: 'colonies', column: 'status', type: 'TEXT', defaultValue: "'active'" },
  { table: 'colonies', column: 'created_at', type: 'TIMESTAMPTZ', defaultValue: 'NOW()', nullable: true },
  { table: 'colonies', column: 'newcomer_protection_until_tick', type: 'INTEGER', defaultValue: '0' },

  // units
  { table: 'units', column: 'id', type: 'TEXT' },
  { table: 'units', column: 'colony_id', type: 'TEXT' },
  { table: 'units', column: 'world_id', type: 'TEXT' },
  { table: 'units', column: 'type', type: 'TEXT' },
  { table: 'units', column: 'hex_x', type: 'INTEGER' },
  { table: 'units', column: 'hex_y', type: 'INTEGER' },
  { table: 'units', column: 'health', type: 'INTEGER', defaultValue: '100' },
  { table: 'units', column: 'morale', type: 'REAL', defaultValue: '1.0' },
  { table: 'units', column: 'movement_queue', type: 'JSONB', defaultValue: "'[]'" },
  { table: 'units', column: 'idle_ticks', type: 'INTEGER', defaultValue: '0' },
  { table: 'colonies', column: 'last_action_tick', type: 'INTEGER', defaultValue: '0' },
  { table: 'colonies', column: 'died_at_tick', type: 'INTEGER', nullable: true },
  { table: 'colonies', column: 'death_reason', type: 'TEXT', nullable: true },

  // settlements
  { table: 'settlements', column: 'id', type: 'TEXT' },
  { table: 'settlements', column: 'colony_id', type: 'TEXT' },
  { table: 'settlements', column: 'world_id', type: 'TEXT' },
  { table: 'settlements', column: 'name', type: 'TEXT' },
  { table: 'settlements', column: 'hex_x', type: 'INTEGER' },
  { table: 'settlements', column: 'hex_y', type: 'INTEGER' },
  { table: 'settlements', column: 'tier', type: 'TEXT', defaultValue: "'outpost'" },
  { table: 'settlements', column: 'buildings', type: 'JSONB', defaultValue: "'[]'" },
  { table: 'settlements', column: 'build_queue', type: 'JSONB', defaultValue: "'[]'" },
  { table: 'settlements', column: 'loyalty', type: 'INTEGER', defaultValue: '100' },
  { table: 'settlements', column: 'population', type: 'INTEGER', defaultValue: '10' },

  // hexes
  { table: 'hexes', column: 'world_id', type: 'TEXT' },
  { table: 'hexes', column: 'x', type: 'INTEGER' },
  { table: 'hexes', column: 'y', type: 'INTEGER' },
  { table: 'hexes', column: 'terrain', type: 'TEXT' },
  { table: 'hexes', column: 'resources', type: 'JSONB', defaultValue: "'{}'" },
  { table: 'hexes', column: 'settlement_id', type: 'TEXT', nullable: true },
  { table: 'hexes', column: 'explored_by', type: 'TEXT[]', defaultValue: "ARRAY[]::TEXT[]", nullable: true },
  { table: 'hexes', column: 'poi', type: 'JSONB', nullable: true },
  { table: 'events', column: 'created_at', type: 'TIMESTAMPTZ', defaultValue: 'NOW()', nullable: true },

  // actions
  { table: 'actions', column: 'id', type: 'TEXT' },
  { table: 'actions', column: 'world_id', type: 'TEXT' },
  { table: 'actions', column: 'colony_id', type: 'TEXT' },
  { table: 'actions', column: 'tick', type: 'INTEGER' },
  { table: 'actions', column: 'type', type: 'TEXT' },
  { table: 'actions', column: 'params', type: 'JSONB' },
  { table: 'actions', column: 'status', type: 'TEXT', defaultValue: "'queued'" },
  { table: 'actions', column: 'result', type: 'TEXT', nullable: true },
  { table: 'actions', column: 'created_at', type: 'TIMESTAMPTZ', defaultValue: 'NOW()', nullable: true },

  // events
  { table: 'events', column: 'id', type: 'TEXT' },
  { table: 'events', column: 'world_id', type: 'TEXT' },
  { table: 'events', column: 'tick', type: 'INTEGER' },
  { table: 'events', column: 'type', type: 'TEXT' },
  { table: 'events', column: 'public', type: 'BOOLEAN', defaultValue: 'false' },
  { table: 'events', column: 'visibility', type: 'TEXT[]', defaultValue: "ARRAY[]::TEXT[]", nullable: true },
  { table: 'events', column: 'data', type: 'JSONB' },
  { table: 'events', column: 'public_data', type: 'JSONB', nullable: true },

  // agreements
  { table: 'agreements', column: 'id', type: 'TEXT' },
  { table: 'agreements', column: 'world_id', type: 'TEXT' },
  { table: 'agreements', column: 'type', type: 'TEXT' },
  { table: 'agreements', column: 'proposed_by', type: 'TEXT' },
  { table: 'agreements', column: 'proposed_to', type: 'TEXT' },
  { table: 'agreements', column: 'status', type: 'TEXT', defaultValue: "'proposed'" },
  { table: 'agreements', column: 'terms', type: 'JSONB', defaultValue: "'{}'" },
  { table: 'agreements', column: 'proposed_at_tick', type: 'INTEGER' },
  { table: 'agreements', column: 'accepted_at_tick', type: 'INTEGER', nullable: true },

  // messages
  { table: 'messages', column: 'id', type: 'TEXT' },
  { table: 'messages', column: 'world_id', type: 'TEXT' },
  { table: 'messages', column: 'from_colony', type: 'TEXT' },
  { table: 'messages', column: 'to_colony', type: 'TEXT' },
  { table: 'messages', column: 'sent_at_tick', type: 'INTEGER' },
  { table: 'messages', column: 'delivered_at_tick', type: 'INTEGER' },
  { table: 'messages', column: 'content', type: 'TEXT' },
  { table: 'messages', column: 'read', type: 'BOOLEAN', defaultValue: 'false' },

  // feedback_reports
  { table: 'feedback_reports', column: 'id', type: 'TEXT' },
  { table: 'feedback_reports', column: 'world_id', type: 'TEXT' },
  { table: 'feedback_reports', column: 'colony_id', type: 'TEXT', nullable: true },
  { table: 'feedback_reports', column: 'reporter_name', type: 'TEXT', nullable: true },
  { table: 'feedback_reports', column: 'type', type: 'TEXT' },
  { table: 'feedback_reports', column: 'title', type: 'TEXT' },
  { table: 'feedback_reports', column: 'description', type: 'TEXT' },
  { table: 'feedback_reports', column: 'tick', type: 'INTEGER', nullable: true },
  { table: 'feedback_reports', column: 'metadata', type: 'JSONB', defaultValue: "'{}'::jsonb", nullable: true },
  { table: 'feedback_reports', column: 'created_at', type: 'TIMESTAMPTZ', defaultValue: 'NOW()', nullable: true },
];

/**
 * Run schema migration on startup.
 * Checks every expected column exists, adds missing ones with ALTER TABLE.
 */
export async function ensureSchema(db: PostgresJsDatabase<any>, logger: MigrationLogger): Promise<void> {
  logger.info('[migrate] Checking schema...');
  let added = 0;

  for (const stmt of CREATE_TABLE_STATEMENTS) {
    await db.execute(sql.raw(stmt));
  }

  // Get all existing columns in one query
  const existing = await db.execute(sql`
    SELECT table_name, column_name 
    FROM information_schema.columns 
    WHERE table_schema = 'public'
  `);

  const existingSet = new Set(
    (existing as any[]).map((r: any) => `${r.table_name}.${r.column_name}`)
  );

  for (const col of EXPECTED_COLUMNS) {
    const key = `${col.table}.${col.column}`;
    if (!existingSet.has(key)) {
      const notNull = col.nullable ? '' : ' NOT NULL';
      const def = col.defaultValue ? ` DEFAULT ${col.defaultValue}` : '';
      const stmt = `ALTER TABLE ${col.table} ADD COLUMN IF NOT EXISTS ${col.column} ${col.type}${notNull}${def}`;
      
      logger.info(`[migrate] Adding missing column: ${key}`);
      await db.execute(sql.raw(stmt));
      added++;
    }
  }

  if (added > 0) {
    logger.info(`[migrate] Added ${added} missing column(s)`);
  } else {
    logger.info('[migrate] Schema up to date');
  }

  // --- POI migration: seed POIs for existing worlds that don't have any ---
  await seedPoisForExistingWorlds(db, logger);
}

/**
 * Simple hash function for deterministic POI placement on existing worlds.
 * Uses the world ID string as seed material.
 */
function simpleHash(str: string): number {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) - h + str.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

function createSeededRng(seed: number): () => number {
  let state = seed | 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface PoiPlacement {
  type: string;
  weight: number;
  terrains: string[];
}

const POI_TYPES: PoiPlacement[] = [
  { type: 'mineral_deposit', weight: 15, terrains: ['mountains', 'desert', 'tundra'] },
  { type: 'fertile_valley',  weight: 15, terrains: ['plains', 'forest'] },
  { type: 'ancient_forest',  weight: 12, terrains: ['forest'] },
  { type: 'ancient_ruins',   weight: 12, terrains: ['plains', 'desert', 'tundra', 'mountains'] },
  { type: 'abandoned_cache', weight: 15, terrains: ['plains', 'forest', 'desert', 'tundra'] },
  { type: 'crystal_cavern',  weight: 8,  terrains: ['mountains'] },
  { type: 'watchtower',      weight: 10, terrains: ['mountains', 'plains', 'tundra'] },
  { type: 'sacred_grove',    weight: 8,  terrains: ['forest', 'plains'] },
];

function pickPoi(rng: () => number, terrain: string): string | null {
  const eligible = POI_TYPES.filter(p => p.terrains.includes(terrain));
  if (eligible.length === 0) return null;
  const total = eligible.reduce((s, p) => s + p.weight, 0);
  let roll = rng() * total;
  for (const p of eligible) {
    roll -= p.weight;
    if (roll <= 0) return p.type;
  }
  return eligible[eligible.length - 1].type;
}

function hexDist(x1: number, y1: number, x2: number, y2: number): number {
  return (Math.abs(x1 - x2) + Math.abs(y1 - y2) + Math.abs(x1 + y1 - x2 - y2)) / 2;
}

/**
 * Seed POIs for worlds that have hexes but no POIs yet.
 * Idempotent — skips worlds that already have POIs.
 */
async function seedPoisForExistingWorlds(db: PostgresJsDatabase<any>, logger: MigrationLogger): Promise<void> {
  // Check if any hex already has a POI
  const poiCheck = await db.execute(sql`SELECT COUNT(*) as cnt FROM hexes WHERE poi IS NOT NULL LIMIT 1`);
  const poiCount = Number((poiCheck as any)[0]?.cnt ?? 0);
  if (poiCount > 0) {
    logger.info('[migrate] POIs already seeded, skipping');
    return;
  }

  // Get all worlds
  const worldRows = await db.execute(sql`SELECT id FROM worlds`);
  if (!worldRows || (worldRows as any[]).length === 0) return;

  for (const world of worldRows as any[]) {
    const worldId = world.id;
    logger.info(`[migrate] Seeding POIs for world ${worldId}...`);

    // Get all land hexes (excluding ocean, coast) — parameterized query
    const allHexes = await db.execute(
      sql`SELECT x, y, terrain, settlement_id FROM hexes WHERE world_id = ${worldId} AND terrain NOT IN ('ocean', 'coast') ORDER BY x, y`
    );

    // Get settlement positions to avoid placing POIs too close
    const settlementRows = await db.execute(
      sql`SELECT hex_x, hex_y FROM settlements WHERE world_id = ${worldId}`
    );
    const settlementCoords = (settlementRows as any[]).map((s: any) => ({ x: s.hex_x, y: s.hex_y }));

    const seed = simpleHash(worldId);
    const rng = createSeededRng(seed + 80000);

    // Shuffle hexes deterministically
    const shuffled = (allHexes as any[]).map((h: any) => ({ ...h, sort: rng() }));
    shuffled.sort((a: any, b: any) => a.sort - b.sort);

    const targetCount = Math.max(5, Math.floor(shuffled.length * 0.04));
    const placedCoords: Array<{ x: number; y: number }> = [];
    let placed = 0;

    const POI_MIN_SPACING = 4;
    const POI_SETTLEMENT_CLEARANCE = 3;

    for (const hex of shuffled) {
      if (placed >= targetCount) break;

      // Don't place near settlements
      const tooCloseToSettlement = settlementCoords.some(
        (s: any) => hexDist(hex.x, hex.y, s.x, s.y) < POI_SETTLEMENT_CLEARANCE
      );
      if (tooCloseToSettlement) continue;

      // Don't place near other POIs
      const tooCloseToOther = placedCoords.some(
        (p) => hexDist(hex.x, hex.y, p.x, p.y) < POI_MIN_SPACING
      );
      if (tooCloseToOther) continue;

      const poiType = pickPoi(rng, hex.terrain);
      if (!poiType) continue;

      // Parameterized POI update — no string interpolation
      const poiData = { type: poiType };
      await db.execute(
        sql`UPDATE hexes SET poi = ${JSON.stringify(poiData)}::jsonb WHERE world_id = ${worldId} AND x = ${hex.x} AND y = ${hex.y}`
      );

      placedCoords.push({ x: hex.x, y: hex.y });
      placed++;
    }

    logger.info(`[migrate] Placed ${placed} POIs in world ${worldId}`);
  }
}
