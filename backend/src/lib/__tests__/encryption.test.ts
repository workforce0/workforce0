import { describe, it, expect } from 'vitest';
import { encrypt, decrypt, generateEncryptionKey, deriveKey } from '../encryption.js';

describe('encryption', () => {
  const testKey = generateEncryptionKey();

  describe('encrypt / decrypt round-trip', () => {
    it('should decrypt to the original plaintext', () => {
      const plaintext = 'sk-ant-api03-very-secret-key-1234567890';
      const encrypted = encrypt(plaintext, testKey);
      const decrypted = decrypt(encrypted, testKey);
      expect(decrypted).toBe(plaintext);
    });

    it('should handle empty string encryption', () => {
      const encrypted = encrypt('', testKey);
      const decrypted = decrypt(encrypted, testKey);
      expect(decrypted).toBe('');
    });

    it('should handle unicode / multibyte characters', () => {
      const plaintext = 'key-with-emoji-\u{1F512}-and-\u00FC\u00F1\u00EE\u00E7\u00F6de';
      const encrypted = encrypt(plaintext, testKey);
      const decrypted = decrypt(encrypted, testKey);
      expect(decrypted).toBe(plaintext);
    });

    it('should handle very long plaintext', () => {
      const plaintext = 'A'.repeat(10_000);
      const encrypted = encrypt(plaintext, testKey);
      const decrypted = decrypt(encrypted, testKey);
      expect(decrypted).toBe(plaintext);
    });
  });

  describe('IV randomness', () => {
    it('should produce different ciphertexts for the same plaintext', () => {
      const plaintext = 'same-key-twice';
      const encrypted1 = encrypt(plaintext, testKey);
      const encrypted2 = encrypt(plaintext, testKey);
      expect(encrypted1).not.toBe(encrypted2);

      // Both should still decrypt correctly
      expect(decrypt(encrypted1, testKey)).toBe(plaintext);
      expect(decrypt(encrypted2, testKey)).toBe(plaintext);
    });
  });

  describe('wrong key', () => {
    it('should throw when decrypting with a different key', () => {
      const plaintext = 'secret-value';
      const encrypted = encrypt(plaintext, testKey);
      const wrongKey = generateEncryptionKey();

      expect(() => decrypt(encrypted, wrongKey)).toThrow();
    });
  });

  describe('tampered ciphertext', () => {
    it('should throw when the ciphertext is modified', () => {
      const encrypted = encrypt('secret', testKey);
      const parts = encrypted.split(':');
      // Flip a character in the ciphertext portion
      const tampered = parts[2].length > 0
        ? parts[2][0] === 'a' ? 'b' + parts[2].slice(1) : 'a' + parts[2].slice(1)
        : parts[2];
      const tamperedString = `${parts[0]}:${parts[1]}:${tampered}`;

      expect(() => decrypt(tamperedString, testKey)).toThrow();
    });

    it('should throw when the auth tag is modified', () => {
      const encrypted = encrypt('secret', testKey);
      const parts = encrypted.split(':');
      // Flip a character in the auth tag
      const tamperedTag = parts[1][0] === 'a' ? 'b' + parts[1].slice(1) : 'a' + parts[1].slice(1);
      const tamperedString = `${parts[0]}:${tamperedTag}:${parts[2]}`;

      expect(() => decrypt(tamperedString, testKey)).toThrow();
    });

    it('should throw when the IV is modified', () => {
      const encrypted = encrypt('secret', testKey);
      const parts = encrypted.split(':');
      const tamperedIv = parts[0][0] === 'a' ? 'b' + parts[0].slice(1) : 'a' + parts[0].slice(1);
      const tamperedString = `${tamperedIv}:${parts[1]}:${parts[2]}`;

      expect(() => decrypt(tamperedString, testKey)).toThrow();
    });
  });

  describe('invalid inputs', () => {
    it('should throw on malformed encrypted string (missing parts)', () => {
      expect(() => decrypt('only-one-part', testKey)).toThrow('Invalid encrypted string format');
    });

    it('should throw on key with wrong length', () => {
      expect(() => encrypt('test', 'tooshort')).toThrow('Encryption key must be 32 bytes');
      expect(() => decrypt('aa:bb:cc', 'tooshort')).toThrow('Encryption key must be 32 bytes');
    });
  });

  describe('generateEncryptionKey', () => {
    it('should produce a 64-character hex string', () => {
      const key = generateEncryptionKey();
      expect(key).toHaveLength(64);
      expect(key).toMatch(/^[0-9a-f]{64}$/);
    });

    it('should produce different keys each time', () => {
      const key1 = generateEncryptionKey();
      const key2 = generateEncryptionKey();
      expect(key1).not.toBe(key2);
    });
  });

  describe('deriveKey', () => {
    it('should produce a 32-byte Buffer', () => {
      const key = deriveKey('my-jwt-secret-that-is-at-least-32-chars');
      expect(key).toBeInstanceOf(Buffer);
      expect(key.length).toBe(32);
    });

    it('should be deterministic for the same input', () => {
      const key1 = deriveKey('same-secret');
      const key2 = deriveKey('same-secret');
      expect(key1.toString('hex')).toBe(key2.toString('hex'));
    });

    it('should produce different keys for different inputs', () => {
      const key1 = deriveKey('secret-a');
      const key2 = deriveKey('secret-b');
      expect(key1.toString('hex')).not.toBe(key2.toString('hex'));
    });

    it('should work as an encryption key when converted to hex', () => {
      const keyHex = deriveKey('my-jwt-secret').toString('hex');
      const plaintext = 'test-api-key';
      const encrypted = encrypt(plaintext, keyHex);
      const decrypted = decrypt(encrypted, keyHex);
      expect(decrypted).toBe(plaintext);
    });
  });
});
