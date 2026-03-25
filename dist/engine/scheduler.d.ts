/**
 * Tick scheduler — manages tick timing and persistence.
 *
 * Loads world state from the database, runs resolveTick, writes results back.
 * One scheduler instance per running world.
 */
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../db/schema/index.js';
export interface SchedulerOptions {
    worldId: string;
    db: PostgresJsDatabase<typeof schema>;
    onTick?: (tick: number, events: unknown[]) => void;
    onError?: (error: Error) => void;
}
export declare class TickScheduler {
    private worldId;
    private db;
    private timer;
    private running;
    private onTick?;
    private onError?;
    constructor(options: SchedulerOptions);
    /**
     * Start the tick loop for a world.
     */
    start(): Promise<void>;
    /**
     * Stop the tick loop.
     */
    stop(): void;
    /**
     * Execute a single tick. Can be called directly for testing.
     */
    executeTick(): Promise<void>;
}
//# sourceMappingURL=scheduler.d.ts.map