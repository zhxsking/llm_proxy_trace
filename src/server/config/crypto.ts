// ============================================================
// API Key Encryption / Decryption (AES-256-GCM)
// ============================================================

import crypto from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const TAG_LENGTH = 16;
// Fixed salt — unique to this application, provides domain separation.
// Key also incorporates machine identity so ciphertext is not portable
// between machines (reduces risk if config file is leaked).
const APP_SALT = 'lpt-proxy-trace-v1';

/**
 * Derive a 32-byte key using HKDF from machine identity.
 * Even if hostname/username both fall back to defaults, the fixed
 * APP_SALT ensures the key is domain-separated from other apps.
 */
function deriveKey(): Buffer {
  const hostname = process.env.COMPUTERNAME || process.env.HOSTNAME || 'localhost';
  const username = process.env.USERNAME || process.env.USER || 'default';
  const ikm = Buffer.from(`${hostname}:${username}`, 'utf-8');
  // HKDF-SHA256: info = app salt, length = 32 bytes
  return crypto.hkdfSync('sha256', ikm, Buffer.alloc(0), APP_SALT, 32) as unknown as Buffer;
}

/**
 * Encrypt a plaintext string → base64 encoded ciphertext
 * Format: base64(iv[16] + authTag[16] + ciphertext)
 */
export function encrypt(plaintext: string): string {
  const key = deriveKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  const encrypted = Buffer.concat([
    cipher.update(plaintext, 'utf-8'),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();

  return Buffer.concat([iv, tag, encrypted]).toString('base64');
}

/**
 * Decrypt a base64 encoded ciphertext → plaintext string
 */
export function decrypt(ciphertext: string): string {
  const key = deriveKey();
  const combined = Buffer.from(ciphertext, 'base64');

  if (combined.length < IV_LENGTH + TAG_LENGTH) {
    throw new Error('Invalid ciphertext: too short');
  }

  const iv        = combined.subarray(0, IV_LENGTH);
  const tag       = combined.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
  const encrypted = combined.subarray(IV_LENGTH + TAG_LENGTH);

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);

  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf-8');
}

/**
 * Mask an API key for display: sk-1234...abcd
 */
export function maskApiKey(key: string): string {
  if (!key || key.length <= 8) return '***';
  return `${key.slice(0, 4)}...${key.slice(-4)}`;
}
