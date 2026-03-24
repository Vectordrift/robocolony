import { pgTable, text, integer, timestamp } from 'drizzle-orm/pg-core';

export const worlds = pgTable('worlds', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  tickRate: integer('tick_rate').notNull().default(300000), // 5 min in ms
  currentTick: integer('current_tick').notNull().default(0),
  mapSeed: integer('map_seed').notNull(),
  status: text('status').notNull().default('open'), // open | running | full | ended
  mapRadius: integer('map_radius').notNull().default(50),
  maxColonies: integer('max_colonies').notNull().default(8),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
});
