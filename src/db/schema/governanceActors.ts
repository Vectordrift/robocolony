import { pgTable, text, timestamp, jsonb } from 'drizzle-orm/pg-core';

export const governanceActors = pgTable('governance_actors', {
  id: text('id').primaryKey(),
  type: text('type').notNull(),
  name: text('name').notNull(),
  parentActorId: text('parent_actor_id'),
  colonyId: text('colony_id'),
  starSystemId: text('star_system_id'),
  sectorId: text('sector_id'),
  polityId: text('polity_id'),
  authorityScope: jsonb('authority_scope').$type<string[]>().notNull().default([]),
  visibilityScope: jsonb('visibility_scope').$type<string[]>().notNull().default([]),
  metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
});
