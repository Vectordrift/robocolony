import { pgTable, text, integer, jsonb, timestamp, index } from 'drizzle-orm/pg-core';
import { worlds } from './worlds.js';
import { colonies } from './colonies.js';

export const actions = pgTable('actions', {
  id: text('id').primaryKey(),
  worldId: text('world_id').notNull().references(() => worlds.id),
  colonyId: text('colony_id').notNull().references(() => colonies.id),
  tick: integer('tick').notNull(),
  type: text('type').notNull(),
  params: jsonb('params').notNull(),
  status: text('status').notNull().default('queued'), // queued | resolved | failed
  result: text('result'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
}, (table) => [
  index('idx_actions_world_tick').on(table.worldId, table.tick, table.status),
]);
