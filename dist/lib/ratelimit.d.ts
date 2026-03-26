/**
 * Shared rate-limit stores.
 * Imported by server.ts (hooks) and worlds.ts (colony delete clears join limit).
 */
export declare const rateLimitStore: Map<string, {
    count: number;
    resetAt: number;
}>;
export declare const joinRateLimitStore: Map<string, {
    count: number;
    resetAt: number;
}>;
export declare const RATE_LIMIT_WINDOW_MS = 60000;
export declare const RATE_LIMIT_MAX = 60;
export declare const RATE_LIMIT_JOIN_MAX = 1;
export declare const RATE_LIMIT_JOIN_WINDOW_MS = 3600000;
export declare function checkRateLimit(store: Map<string, {
    count: number;
    resetAt: number;
}>, key: string, max: number, windowMs?: number): {
    allowed: boolean;
    remaining: number;
    resetAt: number;
};
/**
 * Clear the join rate limit for a specific IP key.
 */
export declare function clearJoinRateLimit(ipKey: string): void;
/**
 * Periodic cleanup of stale entries. Call from server startup.
 */
export declare function startRateLimitCleanup(): void;
//# sourceMappingURL=ratelimit.d.ts.map