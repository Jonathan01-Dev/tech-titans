import sodium from 'libsodium-wrappers';
import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import type { Identity, PublicIdentity } from '../types/index.js';

const IDENTITY_DIR = path.join(process.cwd(), '.archipel');
const IDENTITY_FILE = path.join(IDENTITY_DIR, 'identity.json');

interface StoredIdentity {
  nodeId: string;
  fingerprint: string;
  sign: {
    publicKey: string;
    privateKey: string;
  };
  kx: {
    publicKey: string;
    privateKey: string;
  };
  createdAt: number;
}

function toHex(data: Uint8Array): string {
  return Buffer.from(data).toString('hex');
}

function fromHex(hex: string): Uint8Array {
  return new Uint8Array(Buffer.from(hex, 'hex'));
}

function computeFingerprint(signPublicKey: Uint8Array, kxPublicKey: Uint8Array): string {
  return crypto
    .createHash('sha256')
    .update(Buffer.concat([Buffer.from(signPublicKey), Buffer.from(kxPublicKey)]))
    .digest('hex');
}

function validateKeySizes(signPublicKey: Uint8Array, signPrivateKey: Uint8Array, kxPublicKey: Uint8Array, kxPrivateKey: Uint8Array): void {
  if (signPublicKey.length !== 32 || signPrivateKey.length !== 64 || kxPublicKey.length !== 32 || kxPrivateKey.length !== 32) {
    throw new Error('Invalid key size');
  }
}

export async function generateIdentity(): Promise<Identity> {
  await sodium.ready;

  const signPair = sodium.crypto_sign_keypair();
  const kxPair = sodium.crypto_kx_keypair();
  const nodeId = toHex(signPair.publicKey);
  const fingerprint = computeFingerprint(signPair.publicKey, kxPair.publicKey);

  return {
    nodeId,
    fingerprint,
    sign: {
      publicKey: signPair.publicKey,
      privateKey: signPair.privateKey
    },
    kx: {
      publicKey: kxPair.publicKey,
      privateKey: kxPair.privateKey
    },
    createdAt: Date.now()
  };
}

export async function saveIdentity(identity: Identity): Promise<void> {
  await fs.mkdir(IDENTITY_DIR, { recursive: true });

  try {
    await fs.chmod(IDENTITY_DIR, 0o700);
  } catch (error) {
    if (process.platform !== 'win32') {
      throw error;
    }
  }

  const toStore: StoredIdentity = {
    nodeId: identity.nodeId,
    fingerprint: identity.fingerprint,
    sign: {
      publicKey: toHex(identity.sign.publicKey),
      privateKey: toHex(identity.sign.privateKey)
    },
    kx: {
      publicKey: toHex(identity.kx.publicKey),
      privateKey: toHex(identity.kx.privateKey)
    },
    createdAt: identity.createdAt
  };

  await fs.writeFile(IDENTITY_FILE, JSON.stringify(toStore, null, 2), 'utf8');

  try {
    await fs.chmod(IDENTITY_FILE, 0o600);
  } catch (error) {
    if (process.platform !== 'win32') {
      throw error;
    }
  }
}

export async function loadIdentity(): Promise<Identity> {
  await sodium.ready;

  let raw: string;
  try {
    raw = await fs.readFile(IDENTITY_FILE, 'utf8');
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err.code === 'ENOENT') {
      const identity = await generateIdentity();
      await saveIdentity(identity);
      return identity;
    }
    throw error;
  }

  let parsed: StoredIdentity;
  try {
    parsed = JSON.parse(raw) as StoredIdentity;
  } catch {
    throw new Error('Identity file corrupted');
  }

  const signPublicKey = fromHex(parsed.sign?.publicKey ?? '');
  const signPrivateKey = fromHex(parsed.sign?.privateKey ?? '');
  const kxPublicKey = fromHex(parsed.kx?.publicKey ?? '');
  const kxPrivateKey = fromHex(parsed.kx?.privateKey ?? '');

  validateKeySizes(signPublicKey, signPrivateKey, kxPublicKey, kxPrivateKey);

  const recalculatedFingerprint = computeFingerprint(signPublicKey, kxPublicKey);
  const recalculatedNodeId = toHex(signPublicKey);

  if (recalculatedNodeId !== parsed.nodeId || recalculatedFingerprint !== parsed.fingerprint) {
    throw new Error('Identity tampered');
  }

  return {
    nodeId: parsed.nodeId,
    fingerprint: parsed.fingerprint,
    sign: {
      publicKey: signPublicKey,
      privateKey: signPrivateKey
    },
    kx: {
      publicKey: kxPublicKey,
      privateKey: kxPrivateKey
    },
    createdAt: parsed.createdAt
  };
}

export function getPublicIdentity(identity: Identity): PublicIdentity {
  return {
    nodeId: identity.nodeId,
    fingerprint: identity.fingerprint,
    signPublicKey: toHex(identity.sign.publicKey),
    kxPublicKey: toHex(identity.kx.publicKey)
  };
}

export function verifyIdentity(pub: PublicIdentity): boolean {
  try {
    if (pub.nodeId !== pub.signPublicKey) {
      return false;
    }

    const signPublicKey = fromHex(pub.signPublicKey);
    const kxPublicKey = fromHex(pub.kxPublicKey);

    if (signPublicKey.length !== 32 || kxPublicKey.length !== 32) {
      return false;
    }

    const expectedFingerprint = computeFingerprint(signPublicKey, kxPublicKey);
    return expectedFingerprint === pub.fingerprint;
  } catch {
    return false;
  }
}