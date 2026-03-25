import { pgTable, text, integer, jsonb } from 'drizzle-orm/pg-core';
import { worlds } from './worlds.js';
import { colonies } from './colonies.js';
export const agreements = pgTable('agreements', {
    id: text('id').primaryKey(),
    worldId: text('world_id').notNull().references(() => worlds.id),
    type: text('type').notNull(), // non_aggression | trade | alliance
    proposedBy: text('proposed_by').notNull().references(() => colonies.id),
    proposedTo: text('proposed_to').notNull().references(() => colonies.id),
    status: text('status').notNull().default('proposed'), // proposed | active | rejected | broken
    terms: jsonb('terms').notNull().default({}),
    proposedAtTick: integer('proposed_at_tick').notNull(),
    acceptedAtTick: integer('accepted_at_tick'),
});
//# sourceMappingURL=agreements.js.map