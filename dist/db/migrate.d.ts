/**
 * SQL-based schema migration.
 * Runs on startup to ensure all expected columns exist.
 * This replaces drizzle-kit push which cannot run in the deploy environment.
 */
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
interface MigrationLogger {
    info: (msg: string) => void;
    error: (msg: string) => void;
}
/**
 * Run schema migration on startup.
 * Checks every expected column exists, adds missing ones with ALTER TABLE.
 */
export declare function ensureSchema(db: PostgresJsDatabase<any>, logger: MigrationLogger): Promise<void>;
export {};
//# sourceMappingURL=migrate.d.ts.map