import { pgTable, text, integer, jsonb, timestamp, index } from 'drizzle-orm/pg-core';
import { worlds } from './worlds.js';
import { colonies } from './colonies.js';

export const feedbackReports = pgTable('feedback_reports', {
  id: text('id').primaryKey(),
  worldId: text('world_id').notNull().references(() => worlds.id),
  colonyId: text('colony_id').references(() => colonies.id),
  reporterName: text('reporter_name'),
  type: text('type').notNull(),
  title: text('title').notNull(),
  description: text('description').notNull(),
  tick: integer('tick'),
  metadata: jsonb('metadata').default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
}, (table) => [
  index('idx_feedback_world_created').on(table.worldId, table.createdAt),
  index('idx_feedback_type_created').on(table.type, table.createdAt),
]);
