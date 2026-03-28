import { pgTable, text, integer, timestamp, jsonb } from 'drizzle-orm/pg-core';

export const starSystems = pgTable('star_systems', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  sectorId: text('sector_id'),
  status: text('status').notNull().default('surveyed'),
  importance: integer('importance').notNull().default(0),
  simulationMode: text('simulation_mode').notNull().default('detailed'),
  heatScore: integer('heat_score').notNull().default(0),
  lastActiveTick: integer('last_active_tick').notNull().default(0),
  positionX: integer('position_x'),
  positionY: integer('position_y'),
  claimants: jsonb('claimants').$type<string[]>().notNull().default([]),
  neighborSystemIds: jsonb('neighbor_system_ids').$type<string[]>().notNull().default([]),
  aggregateState: jsonb('aggregate_state').$type<Record<string, unknown>>().notNull().default({}),
  metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
});
