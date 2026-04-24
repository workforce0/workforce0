/**
 * =============================================================================
 * AES-256-GCM ENCRYPTION MODULE
 * =============================================================================
 *
 * Provides authenticated encryption/decryption for sensitive data at rest
 * (e.g., API keys stored in the database).
 *
 * Uses Node.js built-in `crypto` module — no external dependencies.
 *
 * Format: iv:authTag:ciphertext (all hex-encoded, colon-separated)
 *
 * @module lib/encryption
 */

import crypto from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16; // 128-bit IV for GCM
const KEY_LENGTH = 32; // 256-bit key
const SCRYPT_SALT = 'workforce0-encryption-key-derivation';

/**
 * Encrypt a plaintext string using AES-256-GCM.
 *
 * @param plaintext - The string to encrypt
 * @param key - A 64-character hex string (32 bytes) used as the encryption key
 * @returns A colon-separated string in the format `iv:authTag:ciphertext` (all hex)
 */
export function encrypt(plaintext: string, key: string): string {
  const keyBuffer = Buffer.from(key, 'hex');
  if (keyBuffer.length !== KEY_LENGTH) {
    throw new Error(`Encryption key must be ${KEY_LENGTH} bytes (${KEY_LENGTH * 2} hex chars), got ${keyBuffer.length} bytes`);
  }

  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, keyBuffer, iv);

  let encrypted = cipher.update(plaintext, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const tag = cipher.getAuthTag();

  return `${iv.toString('hex')}:${tag.toString('hex')}:${encrypted}`;
}

/**
 * Decrypt a string that was encrypted with `encrypt()`.
 *
 * @param encryptedString - The colon-separated `iv:authTag:ciphertext` string
 * @param key - The same 64-character hex key used for encryption
 * @returns The original plaintext
 * @throws If the key is wrong or the ciphertext has been tampered with
 */
export function decrypt(encryptedString: string, key: string): string {
  const parts = encryptedString.split(':');
  if (parts.length !== 3) {
    throw new Error('Invalid encrypted string format — expected iv:tag:ciphertext');
  }

  const [ivHex, tagHex, encrypted] = parts;
  const keyBuffer = Buffer.from(key, 'hex');
  if (keyBuffer.length !== KEY_LENGTH) {
    throw new Error(`Encryption key must be ${KEY_LENGTH} bytes (${KEY_LENGTH * 2} hex chars), got ${keyBuffer.length} bytes`);
  }

  const iv = Buffer.from(ivHex, 'hex');
  const tag = Buffer.from(tagHex, 'hex');

  const decipher = crypto.createDecipheriv(ALGORITHM, keyBuffer, iv);
  decipher.setAuthTag(tag);

  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

/**
 * Generate a random 32-byte encryption key as a hex string.
 *
 * Use this for initial setup — store the result in the ENCRYPTION_KEY env var.
 *
 * @returns A 64-character hex string suitable for use as an AES-256 key
 */
export function generateEncryptionKey(): string {
  return crypto.randomBytes(KEY_LENGTH).toString('hex');
}

/**
 * Derive a deterministic 32-byte key from an arbitrary secret string using scrypt.
 *
 * This is used as a fallback when ENCRYPTION_KEY is not explicitly set,
 * allowing derivation from JWT_SECRET so encryption works out of the box
 * in development without extra configuration.
 *
 * @param secret - An arbitrary string (e.g., JWT_SECRET)
 * @returns A 32-byte Buffer suitable for use as an AES-256 key
 */
export function deriveKey(secret: string): Buffer {
  return crypto.scryptSync(secret, SCRYPT_SALT, KEY_LENGTH);
}
