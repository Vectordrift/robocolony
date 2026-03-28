import { pgTable, text, integer, timestamp, boolean, jsonb } from 'drizzle-orm/pg-core';

export const starLanes = pgTable('star_lanes', {
  id: text('id').primaryKey(),
  fromSystemId: text('from_system_id').notNull(),
  toSystemId: text('to_system_id').notNull(),
  laneClass: text('lane_class').notNull().default('standard'),
  travelCost: integer('travel_cost').notNull().default(1),
  travelTicks: integer('travel_ticks').notNull().default(1),
  chokepoint: boolean('chokepoint').notNull().default(false),
  visibility: text('visibility').notNull().default('public'),
  metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
});
