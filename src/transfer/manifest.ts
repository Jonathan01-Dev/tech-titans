import type { FileManifest } from '../types/index.js';
import { encrypt, decrypt } from '../crypto/cipher.js';
import type { EncryptedPayload } from '../types/index.js';

export function serializeManifest(manifest: FileManifest): Buffer {
  return Buffer.from(JSON.stringify(manifest), 'utf8');
}

export function deserializeManifest(buffer: Buffer): FileManifest {
  const parsed = JSON.parse(buffer.toString('utf8')) as Partial<FileManifest>;

  if (!parsed.fileId || !parsed.filename || typeof parsed.size !== 'number' || typeof parsed.nbChunks !== 'number' || !Array.isArray(parsed.chunks)) {
    throw new Error('Invalid manifest');
  }

  return parsed as FileManifest;
}

export function encryptManifest(manifest: FileManifest, sessionKey: Buffer): Buffer {
  const serialized = serializeManifest(manifest);
  const encrypted = encrypt(sessionKey, serialized);

  return Buffer.from(
    JSON.stringify({
      nonce: encrypted.nonce.toString('hex'),
      ciphertext: encrypted.ciphertext.toString('hex'),
      tag: encrypted.tag.toString('hex')
    }),
    'utf8'
  );
}

export function decryptManifest(encryptedBuffer: Buffer, sessionKey: Buffer): FileManifest {
  const payloadRaw = JSON.parse(encryptedBuffer.toString('utf8')) as {
    nonce: string;
    ciphertext: string;
    tag: string;
  };

  const payload: EncryptedPayload = {
    nonce: Buffer.from(payloadRaw.nonce, 'hex'),
    ciphertext: Buffer.from(payloadRaw.ciphertext, 'hex'),
    tag: Buffer.from(payloadRaw.tag, 'hex')
  };

  const serialized = decrypt(sessionKey, payload);
  return deserializeManifest(serialized);
}
