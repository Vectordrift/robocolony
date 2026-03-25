/**
 * Generate a new API key with the rc_live_ prefix.
 * Returns the plaintext key (shown to user once, never stored).
 */
export declare function generateApiKey(): string;
/**
 * Extract the prefix portion used for quick lookups.
 * First 12 chars after the prefix (enough for uniqueness without full scan).
 */
export declare function getKeyPrefix(key: string): string;
/**
 * Hash an API key for storage using bcrypt.
 */
export declare function hashApiKey(key: string): Promise<string>;
/**
 * Verify a plaintext API key against a bcrypt hash.
 */
export declare function verifyApiKey(key: string, hash: string): Promise<boolean>;
/**
 * Validate that a string looks like a valid API key format.
 */
export declare function isValidKeyFormat(key: string): boolean;
//# sourceMappingURL=auth.d.ts.map