import { pgTable, text, integer, timestamp, jsonb } from 'drizzle-orm/pg-core';

export const fleets = pgTable('fleets', {
  id: text('id').primaryKey(),
  colonyId: text('colony_id').notNull(),
  starSystemId: text('star_system_id').notNull(),
  homeSystemId: text('home_system_id'),
  currentLaneId: text('current_lane_id'),
  type: text('type').notNull().default('task_force'),
  status: text('status').notNull().default('idle'),
  missionType: text('mission_type').notNull().default('hold'),
  missionTargetType: text('mission_target_type'),
  missionTargetId: text('mission_target_id'),
  strength: integer('strength').notNull().default(0),
  morale: integer('morale').notNull().default(100),
  supply: integer('supply').notNull().default(100),
  etaTick: integer('eta_tick'),
  visibility: text('visibility').notNull().default('private'),
  metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
});
