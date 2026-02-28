import path from 'path';
import fs from 'fs/promises';
import crypto from 'crypto';
import type { FileManifest, Peer } from '../types/index.js';
import { TcpClient } from '../network/client.js';
import { buildPacket, parsePacket } from '../network/packet.js';
import { decrypt } from '../crypto/cipher.js';
import { PacketType } from '../types/index.js';
import { CONFIG } from '../config.js';
import { reassembleFile } from './chunker.js';

export class DownloadManager {
  private manifest: FileManifest;
  private peers: Peer[];
  private sessionKeys: Map<string, Buffer>;
  private pendingChunks: Set<number>;
  private inProgress: Map<number, string>;
  private completedChunks: Map<number, Buffer>;
  private outputDir: string;

  constructor(manifest: FileManifest, peers: Peer[], sessionKeys: Map<string, Buffer>, outputDir: string) {
    this.manifest = manifest;
    this.peers = peers;
    this.sessionKeys = sessionKeys;
    this.pendingChunks = new Set<number>();
    for (let i = 0; i < manifest.nbChunks; i += 1) {
      this.pendingChunks.add(i);
    }
    this.inProgress = new Map<number, string>();
    this.completedChunks = new Map<number, Buffer>();
    this.outputDir = outputDir;
  }

  private takeNextChunk(peerNodeId: string): number | null {
    for (const idx of this.pendingChunks) {
      if (!this.inProgress.has(idx)) {
        this.inProgress.set(idx, peerNodeId);
        return idx;
      }
    }
    return null;
  }

  async download(): Promise<string> {
    const workerPeers = [this.peers[0], this.peers[1] || this.peers[0], this.peers[2] || this.peers[0]].filter(
      (p): p is Peer => Boolean(p)
    );
    const MAX_PARALLEL = Math.min(3, workerPeers.length);

    await Promise.all(workerPeers.slice(0, MAX_PARALLEL).map((peer) => this.worker(peer)));

    await fs.mkdir(this.outputDir, { recursive: true });
    const outputPath = path.join(this.outputDir, this.manifest.filename);
    await reassembleFile(outputPath, this.manifest, this.completedChunks);
    return outputPath;
  }

  private async worker(peer: Peer): Promise<void> {
    while (this.pendingChunks.size > 0) {
      const chunkIndex = this.takeNextChunk(peer.nodeId);
      if (chunkIndex === null) {
        await new Promise<void>((resolve) => setTimeout(resolve, 50));
        continue;
      }

      try {
        const data = await this.requestChunk(peer, chunkIndex);
        const expected = this.manifest.chunks[chunkIndex];
        const actualHash = crypto.createHash('sha256').update(data).digest('hex');

        if (actualHash !== expected.hash) {
          this.inProgress.delete(chunkIndex);
          console.log(`[DL] Hash invalide chunk ${chunkIndex}, retry`);
          continue;
        }

        this.completedChunks.set(chunkIndex, data);
        this.pendingChunks.delete(chunkIndex);
        this.inProgress.delete(chunkIndex);
        console.log(`[DL] Chunk ${chunkIndex + 1}/${this.manifest.nbChunks} OK`);
      } catch {
        this.inProgress.delete(chunkIndex);
        console.log(`[DL] Pair injoignable, chunk ${chunkIndex} remis en file`);
        break;
      }
    }

    console.log('[DL] Worker termine');
  }

  private async readPacket(socket: import('net').Socket, timeoutMs = 10000): Promise<Buffer> {
    return new Promise<Buffer>((resolve, reject) => {
      let buffer = Buffer.alloc(0);

      const cleanup = (): void => {
        clearTimeout(timer);
        socket.off('data', onData);
        socket.off('error', onError);
      };

      const onData = (chunk: Buffer): void => {
        buffer = Buffer.concat([buffer, chunk]);
        while (buffer.length >= 73) {
          const payloadLen = buffer.readUInt32BE(37);
          const packetLen = 41 + payloadLen + 32;
          if (buffer.length < packetLen) {
            return;
          }
          const packet = buffer.subarray(0, packetLen);
          cleanup();
          resolve(packet);
          return;
        }
      };

      const onError = (error: Error): void => {
        cleanup();
        reject(error);
      };

      const timer = setTimeout(() => {
        cleanup();
        reject(new Error('Timeout waiting for CHUNK_DATA'));
      }, timeoutMs);

      socket.on('data', onData);
      socket.on('error', onError);
    });
  }

  private async requestChunk(peer: Peer, chunkIndex: number): Promise<Buffer> {
    const client = new TcpClient();
    const socket = await client.connect(peer);

    try {
      const payload = Buffer.from(
        JSON.stringify({
          fileId: this.manifest.fileId,
          chunkIndex,
          requesterId: 'local'
        }),
        'utf8'
      );

      const req = buildPacket(PacketType.CHUNK_REQ, Buffer.from(peer.nodeId.padEnd(64, '0').slice(0, 64), 'hex'), payload);
      await client.sendPacket(socket, req);

      const responseRaw = await this.readPacket(socket);
      const response = parsePacket(responseRaw);
      if (response.type !== PacketType.CHUNK_DATA) {
        throw new Error(`Unexpected packet type ${response.type}`);
      }

      const body = JSON.parse(response.payload.toString('utf8')) as {
        fileId: string;
        chunkIndex: number;
        nonce: string;
        ciphertext: string;
        tag: string;
      };

      const sessionKey = this.sessionKeys.get(peer.nodeId);
      if (!sessionKey) {
        throw new Error(`Missing session key for peer ${peer.nodeId}`);
      }

      return decrypt(sessionKey, {
        nonce: Buffer.from(body.nonce, 'hex'),
        ciphertext: Buffer.from(body.ciphertext, 'hex'),
        tag: Buffer.from(body.tag, 'hex')
      });
    } finally {
      await client.disconnectGraceful(socket).catch(() => undefined);
    }
  }

  getProgress(): { downloaded: number; total: number } {
    return {
      downloaded: this.completedChunks.size,
      total: this.manifest.nbChunks
    };
  }
}
