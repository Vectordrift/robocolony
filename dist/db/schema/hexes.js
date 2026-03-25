import { pgTable, text, integer, jsonb, primaryKey } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { worlds } from './worlds.js';
export const hexes = pgTable('hexes', {
    worldId: text('world_id').notNull().references(() => worlds.id),
    x: integer('x').notNull(),
    y: integer('y').notNull(),
    terrain: text('terrain').notNull(), // plains | forest | mountains | coast | desert | tundra | ocean
    resources: jsonb('resources').notNull().default({}),
    settlementId: text('settlement_id'),
    exploredBy: text('explored_by').array().default(sql `'{}'`),
}, (table) => [
    primaryKey({ columns: [table.worldId, table.x, table.y] }),
]);
//# sourceMappingURL=hexes.js.map