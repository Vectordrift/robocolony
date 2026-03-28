import { pgTable, text, timestamp, jsonb } from 'drizzle-orm/pg-core';

export const actorDelegations = pgTable('actor_delegations', {
  id: text('id').primaryKey(),
  fromActorId: text('from_actor_id').notNull(),
  toActorId: text('to_actor_id').notNull(),
  status: text('status').notNull().default('active'),
  authorityScope: jsonb('authority_scope').$type<string[]>().notNull().default([]),
  controlSurface: text('control_surface').notNull(),
  visibilityRules: jsonb('visibility_rules').$type<Record<string, unknown>>().notNull().default({}),
  metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
});
