import { pgTable, text, integer, jsonb } from 'drizzle-orm/pg-core';
import { colonies } from './colonies.js';
import { worlds } from './worlds.js';

export const settlements = pgTable('settlements', {
  id: text('id').primaryKey(),
  colonyId: text('colony_id').notNull().references(() => colonies.id),
  worldId: text('world_id').notNull().references(() => worlds.id),
  name: text('name').notNull(),
  hexX: integer('hex_x').notNull(),
  hexY: integer('hex_y').notNull(),
  tier: text('tier').notNull().default('outpost'), // outpost | town | city
  buildings: jsonb('buildings').notNull().default([]),
  buildQueue: jsonb('build_queue').notNull().default([]),
  loyalty: integer('loyalty').notNull().default(100),
  population: integer('population').notNull().default(10),
});
