import { pgTable, text, integer, timestamp, jsonb } from 'drizzle-orm/pg-core';

export const starSystems = pgTable('star_systems', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  status: text('status').notNull().default('surveyed'),
  importance: integer('importance').notNull().default(0),
  positionX: integer('position_x'),
  positionY: integer('position_y'),
  claimants: jsonb('claimants').$type<string[]>().notNull().default([]),
  neighborSystemIds: jsonb('neighbor_system_ids').$type<string[]>().notNull().default([]),
  metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
});
