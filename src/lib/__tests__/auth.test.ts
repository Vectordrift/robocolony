import { describe, it, expect } from 'vitest';
import {
  generateApiKey,
  hashApiKey,
  verifyApiKey,
  isValidKeyFormat,
  getKeyPrefix,
} from '../auth.js';

describe('Auth utilities', () => {
  describe('generateApiKey', () => {
    it('generates a key with rc_live_ prefix', () => {
      const key = generateApiKey();
      expect(key).toMatch(/^rc_live_/);
    });

    it('generates a key of correct length (prefix + 32 chars)', () => {
      const key = generateApiKey();
      expect(key.length).toBe('rc_live_'.length + 32);
    });

    it('generates unique keys', () => {
      const keys = new Set(Array.from({ length: 100 }, () => generateApiKey()));
      expect(keys.size).toBe(100);
    });
  });

  describe('isValidKeyFormat', () => {
    it('returns true for valid keys', () => {
      const key = generateApiKey();
      expect(isValidKeyFormat(key)).toBe(true);
    });

    it('returns false for keys without prefix', () => {
      expect(isValidKeyFormat('invalid_key_1234567890123456789012')).toBe(false);
    });

    it('returns false for empty string', () => {
      expect(isValidKeyFormat('')).toBe(false);
    });

    it('returns false for keys that are too short', () => {
      expect(isValidKeyFormat('rc_live_short')).toBe(false);
    });

    it('returns false for keys that are too long', () => {
      expect(isValidKeyFormat('rc_live_' + 'a'.repeat(64))).toBe(false);
    });
  });

  describe('getKeyPrefix', () => {
    it('extracts first 12 chars after prefix', () => {
      const key = generateApiKey();
      const prefix = getKeyPrefix(key);
      expect(prefix.length).toBe(12);
      expect(key.includes(prefix)).toBe(true);
    });

    it('throws for invalid key format', () => {
      expect(() => getKeyPrefix('invalid_key')).toThrow('Invalid API key format');
    });
  });

  describe('hashApiKey / verifyApiKey', () => {
    it('hashes and verifies a key correctly', async () => {
      const key = generateApiKey();
      const hash = await hashApiKey(key);

      expect(hash).not.toBe(key);
      expect(hash).toMatch(/^\$2[aby]\$/); // bcrypt hash format

      const isValid = await verifyApiKey(key, hash);
      expect(isValid).toBe(true);
    });

    it('rejects wrong key', async () => {
      const key = generateApiKey();
      const hash = await hashApiKey(key);

      const wrongKey = generateApiKey();
      const isValid = await verifyApiKey(wrongKey, hash);
      expect(isValid).toBe(false);
    });

    it('produces different hashes for the same key (salted)', async () => {
      const key = generateApiKey();
      const hash1 = await hashApiKey(key);
      const hash2 = await hashApiKey(key);

      expect(hash1).not.toBe(hash2);

      // Both should still verify
      expect(await verifyApiKey(key, hash1)).toBe(true);
      expect(await verifyApiKey(key, hash2)).toBe(true);
    });
  });
});
