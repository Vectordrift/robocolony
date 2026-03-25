import { pgTable, text, integer, boolean } from 'drizzle-orm/pg-core';
import { worlds } from './worlds.js';
import { colonies } from './colonies.js';
export const messages = pgTable('messages', {
    id: text('id').primaryKey(),
    worldId: text('world_id').notNull().references(() => worlds.id),
    fromColony: text('from_colony').notNull().references(() => colonies.id),
    toColony: text('to_colony').notNull().references(() => colonies.id),
    sentAtTick: integer('sent_at_tick').notNull(),
    deliveredAtTick: integer('delivered_at_tick').notNull(),
    content: text('content').notNull(),
    read: boolean('read').notNull().default(false),
});
//# sourceMappingURL=messages.js.map