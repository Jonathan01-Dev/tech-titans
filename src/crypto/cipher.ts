import crypto from 'crypto';
import { CONFIG } from '../config.js';
import type { EncryptedPayload } from '../types/index.js';

export function encrypt(sessionKey: Buffer, plaintext: Buffer): EncryptedPayload {
  if (sessionKey.length !== 32) {
    throw new Error('Session key must be 32 bytes');
  }

  const nonce = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', sessionKey, nonce);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();

  return { nonce, ciphertext, tag };
}

export function decrypt(sessionKey: Buffer, payload: EncryptedPayload): Buffer {
  if (sessionKey.length !== 32) {
    throw new Error('Session key must be 32 bytes');
  }

  const decipher = crypto.createDecipheriv('aes-256-gcm', sessionKey, payload.nonce);
  decipher.setAuthTag(payload.tag);

  try {
    return Buffer.concat([decipher.update(payload.ciphertext), decipher.final()]);
  } catch {
    throw new Error('Decryption failed: invalid auth tag');
  }
}

export function deriveSessionKey(sharedSecret: Buffer, info: string = CONFIG.PROTOCOL_VERSION): Buffer {
  const key = crypto.hkdfSync('sha256', sharedSecret, Buffer.alloc(32), Buffer.from(info), 32);
  return Buffer.from(key);
}
