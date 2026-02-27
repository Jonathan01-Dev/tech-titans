import type { Peer } from '../types/index.js';
import { CONFIG } from '../config.js';

export class PeerTable {
  private peers: Map<string, Peer>;
  private cleanupInterval: NodeJS.Timeout;

  constructor() {
    this.peers = new Map();
    this.cleanupInterval = setInterval(() => this.cleanup(), CONFIG.HELLO_INTERVAL);
  }

  upsert(nodeId: string, data: Partial<Peer>): void {
    const existing = this.peers.get(nodeId);

    if (existing) {
      const updated: Peer = {
        ...existing,
        ...data,
        lastSeen: Date.now()
      };
      this.peers.set(nodeId, updated);
    } else {
      const created: Peer = {
        nodeId,
        ip: '',
        tcpPort: 0,
        lastSeen: Date.now(),
        sharedFiles: [],
        reputation: 1.0,
        ...data
      };
      this.peers.set(nodeId, created);
    }

    console.log(`[PeerTable] Pair ajouté/mis à jour: ${nodeId}`);
  }

  getAll(): Peer[] {
    const minLastSeen = Date.now() - CONFIG.PEER_TIMEOUT;
    return Array.from(this.peers.values()).filter((peer) => peer.lastSeen > minLastSeen);
  }

  get(nodeId: string): Peer | undefined {
    return this.peers.get(nodeId);
  }

  size(): number {
    return this.getAll().length;
  }

  private cleanup(): void {
    const minLastSeen = Date.now() - 90000;
    let removed = 0;

    for (const [nodeId, peer] of this.peers.entries()) {
      if (peer.lastSeen < minLastSeen) {
        this.peers.delete(nodeId);
        removed += 1;
      }
    }

    if (removed > 0) {
      console.log(`[PeerTable] ${removed} pair(s) expiré(s) supprimé(s)`);
    }
  }

  destroy(): void {
    clearInterval(this.cleanupInterval);
  }
}
