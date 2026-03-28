import { pgTable, text, integer, timestamp, jsonb } from 'drizzle-orm/pg-core';

export const sectors = pgTable('sectors', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  status: text('status').notNull().default('open'),
  strategicValue: integer('strategic_value').notNull().default(0),
  positionX: integer('position_x'),
  positionY: integer('position_y'),
  metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
});
