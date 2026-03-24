import bcrypt from 'bcryptjs';
import { nanoid } from 'nanoid';

const KEY_PREFIX = 'rc_live_';
const KEY_LENGTH = 32;
const SALT_ROUNDS = 10;

/**
 * Generate a new API key with the rc_live_ prefix.
 * Returns the plaintext key (shown to user once, never stored).
 */
export function generateApiKey(): string {
  return `${KEY_PREFIX}${nanoid(KEY_LENGTH)}`;
}

/**
 * Extract the prefix portion used for quick lookups.
 * First 12 chars after the prefix (enough for uniqueness without full scan).
 */
export function getKeyPrefix(key: string): string {
  if (!key.startsWith(KEY_PREFIX)) {
    throw new Error('Invalid API key format');
  }
  return key.slice(KEY_PREFIX.length, KEY_PREFIX.length + 12);
}

/**
 * Hash an API key for storage using bcrypt.
 */
export async function hashApiKey(key: string): Promise<string> {
  return bcrypt.hash(key, SALT_ROUNDS);
}

/**
 * Verify a plaintext API key against a bcrypt hash.
 */
export async function verifyApiKey(key: string, hash: string): Promise<boolean> {
  return bcrypt.compare(key, hash);
}

/**
 * Validate that a string looks like a valid API key format.
 */
export function isValidKeyFormat(key: string): boolean {
  return key.startsWith(KEY_PREFIX) && key.length === KEY_PREFIX.length + KEY_LENGTH;
}
