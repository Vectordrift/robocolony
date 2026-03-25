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
  { table: 'worlds', column: 'created_at', type: 'TIMESTAMPTZ', defaultValue: 'NOW()', nullable: true },

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
];

/**
 * Run schema migration on startup.
 * Checks every expected column exists, adds missing ones with ALTER TABLE.
 */
export async function ensureSchema(db: PostgresJsDatabase<any>, logger: MigrationLogger): Promise<void> {
  logger.info('[migrate] Checking schema...');
  let added = 0;

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
}
