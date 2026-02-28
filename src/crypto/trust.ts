import fs from 'fs/promises';
import path from 'path';
import type { PublicIdentity } from '../types/index.js';

const TRUST_FILE = path.join(process.cwd(), '.archipel', 'trust.json');

interface TrustEntry extends PublicIdentity {
  trustedAt: number;
  trustedBy: 'self' | string;
  revoked: boolean;
}

type TrustStore = Record<string, TrustEntry>;

export async function loadTrustStore(): Promise<Record<string, any>> {
  try {
    const raw = await fs.readFile(TRUST_FILE, 'utf8');
    return JSON.parse(raw) as TrustStore;
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err.code === 'ENOENT') {
      return {};
    }
    throw error;
  }
}

export async function saveTrustStore(store: Record<string, any>): Promise<void> {
  const dirPath = path.join(process.cwd(), '.archipel');
  await fs.mkdir(dirPath, { recursive: true });
  await fs.writeFile(TRUST_FILE, JSON.stringify(store, null, 2), 'utf8');
}

export async function trustPeer(publicIdentity: PublicIdentity): Promise<void> {
  const store = (await loadTrustStore()) as TrustStore;
  const current = store[publicIdentity.nodeId];

  if (current && current.fingerprint !== publicIdentity.fingerprint) {
    throw new Error('ALERTE MITM : clé publique changée pour ' + publicIdentity.nodeId.slice(0, 16));
  }

  if (!current) {
    store[publicIdentity.nodeId] = {
      ...publicIdentity,
      trustedAt: Date.now(),
      trustedBy: 'self',
      revoked: false
    };
  } else {
    store[publicIdentity.nodeId] = {
      ...current,
      ...publicIdentity,
      revoked: false
    };
  }

  await saveTrustStore(store);
  console.log(`[Trust] Pair approuve: ${publicIdentity.nodeId.slice(0, 16)}...`);
}

export async function isPeerTrusted(nodeId: string): Promise<boolean> {
  const store = (await loadTrustStore()) as TrustStore;
  const entry = store[nodeId];
  if (!entry) {
    return false;
  }
  return entry.revoked === false;
}

export async function revokePeer(nodeId: string): Promise<void> {
  const store = (await loadTrustStore()) as TrustStore;
  const entry = store[nodeId];
  if (!entry) {
    throw new Error('Peer not found');
  }

  entry.revoked = true;
  store[nodeId] = entry;
  await saveTrustStore(store);
  console.log(`[Trust] Pair revoque: ${nodeId.slice(0, 16)}...`);
}
