import { pgTable, text, integer, timestamp, jsonb } from 'drizzle-orm/pg-core';

export const sectors = pgTable('sectors', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  status: text('status').notNull().default('open'),
  strategicValue: integer('strategic_value').notNull().default(0),
  simulationMode: text('simulation_mode').notNull().default('detailed'),
  heatScore: integer('heat_score').notNull().default(0),
  lastEvaluatedTick: integer('last_evaluated_tick').notNull().default(0),
  positionX: integer('position_x'),
  positionY: integer('position_y'),
  aggregateState: jsonb('aggregate_state').$type<Record<string, unknown>>().notNull().default({}),
  metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
});
