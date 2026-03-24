import { pgTable, text, integer, boolean, jsonb, index } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { worlds } from './worlds.js';

export const events = pgTable('events', {
  id: text('id').primaryKey(),
  worldId: text('world_id').notNull().references(() => worlds.id),
  tick: integer('tick').notNull(),
  type: text('type').notNull(),
  public: boolean('public').notNull().default(false),
  visibility: text('visibility').array().default(sql`'{}'`),
  data: jsonb('data').notNull(),
  publicData: jsonb('public_data'),
}, (table) => [
  index('idx_events_world_tick').on(table.worldId, table.tick),
  index('idx_events_public').on(table.worldId, table.public, table.tick),
]);
