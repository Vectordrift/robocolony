/**
 * Shared rate-limit stores.
 * Imported by server.ts (hooks) and worlds.ts (colony delete clears join limit).
 */
export const rateLimitStore = new Map();
export const joinRateLimitStore = new Map();
export const RATE_LIMIT_WINDOW_MS = 60_000; // 1 minute
export const RATE_LIMIT_MAX = 60; // 60 requests per minute per IP
export const RATE_LIMIT_JOIN_MAX = 1; // 1 join per hour per IP
export const RATE_LIMIT_JOIN_WINDOW_MS = 3_600_000; // 1 hour
export function checkRateLimit(store, key, max, windowMs = RATE_LIMIT_WINDOW_MS) {
    const now = Date.now();
    let entry = store.get(key);
    if (!entry || now >= entry.resetAt) {
        entry = { count: 0, resetAt: now + windowMs };
    }
    entry.count++;
    store.set(key, entry);
    return {
        allowed: entry.count <= max,
        remaining: Math.max(0, max - entry.count),
        resetAt: entry.resetAt,
    };
}
/**
 * Clear the join rate limit for a specific IP key.
 */
export function clearJoinRateLimit(ipKey) {
    joinRateLimitStore.delete(ipKey);
}
/**
 * Periodic cleanup of stale entries. Call from server startup.
 */
export function startRateLimitCleanup() {
    setInterval(() => {
        const now = Date.now();
        for (const [key, entry] of rateLimitStore) {
            if (now >= entry.resetAt)
                rateLimitStore.delete(key);
        }
        for (const [key, entry] of joinRateLimitStore) {
            if (now >= entry.resetAt)
                joinRateLimitStore.delete(key);
        }
    }, 300_000);
}
//# sourceMappingURL=ratelimit.js.map