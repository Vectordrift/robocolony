import { pgTable, text, integer, jsonb, timestamp } from 'drizzle-orm/pg-core';
import { worlds } from './worlds.js';

export const colonies = pgTable('colonies', {
  id: text('id').primaryKey(),
  worldId: text('world_id').notNull().references(() => worlds.id),
  name: text('name').notNull(),
  apiKeyHash: text('api_key_hash').notNull(),
  resources: jsonb('resources').notNull().default({
    food: 100,
    timber: 50,
    stone: 30,
    iron: 10,
    influence: 50,
  }),
  legacyScore: integer('legacy_score').notNull().default(0),
  researchedTechs: jsonb('researched_techs').default([]),
  researchQueue: jsonb('research_queue').default([]),
  status: text('status').notNull().default('active'), // active | at_war | eliminated
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
});
