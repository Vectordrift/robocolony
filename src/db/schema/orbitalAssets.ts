import { pgTable, text, integer, timestamp, jsonb } from 'drizzle-orm/pg-core';

export const orbitalAssets = pgTable('orbital_assets', {
  id: text('id').primaryKey(),
  colonyId: text('colony_id'),
  starSystemId: text('star_system_id').notNull(),
  worldId: text('world_id'),
  type: text('type').notNull(),
  status: text('status').notNull().default('operational'),
  orbitalSlot: integer('orbital_slot'),
  controlLevel: integer('control_level').notNull().default(0),
  capacity: integer('capacity').notNull().default(0),
  visibility: text('visibility').notNull().default('public'),
  metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
});
