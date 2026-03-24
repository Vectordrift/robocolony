import { pgTable, text, integer, real, jsonb, index } from 'drizzle-orm/pg-core';
import { colonies } from './colonies.js';
import { worlds } from './worlds.js';

export const units = pgTable('units', {
  id: text('id').primaryKey(),
  colonyId: text('colony_id').notNull().references(() => colonies.id),
  worldId: text('world_id').notNull().references(() => worlds.id),
  type: text('type').notNull(), // scout | militia | soldier | siege | settler
  hexX: integer('hex_x').notNull(),
  hexY: integer('hex_y').notNull(),
  health: integer('health').notNull().default(100),
  morale: real('morale').notNull().default(1.0),
  movementQueue: jsonb('movement_queue').notNull().default([]),
}, (table) => [
  index('idx_units_world_colony').on(table.worldId, table.colonyId),
]);
