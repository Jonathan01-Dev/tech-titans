import path from 'path';
import crypto from 'crypto';
import { loadIdentity, getPublicIdentity } from '../crypto/identity.js';
import { PeerTable } from '../network/peerTable.js';
import { Discovery } from '../network/discovery.js';
import { TcpServer } from '../network/server.js';
import { TcpClient } from '../network/client.js';
import { ChatSession } from '../messaging/chat.js';
import { performHandshake } from '../crypto/handshake.js';
import { trustPeer, revokePeer, loadTrustStore } from '../crypto/trust.js';
import { buildManifest, computeFileHash, splitFile, reassembleFile } from '../transfer/chunker.js';
import { DownloadManager } from '../transfer/downloader.js';
import { CONFIG } from '../config.js';
import { buildPacket } from '../network/packet.js';
import { encrypt, decrypt } from '../crypto/cipher.js';
import { PacketType } from '../types/index.js';
import type { Identity, Peer } from '../types/index.js';

type MessageEntry = {
  id: string;
  fromNodeId: string;
  toNodeId: string;
  content: string;
  nonce: string;
  timestamp: number;
  direction: 'sent' | 'received';
};

export class ArpelNode {
  public identity!: Identity;
  public peerTable!: PeerTable;
  public discovery!: Discovery;
  public server!: TcpServer;
  public port: number;
  public running: boolean;
  public messages: MessageEntry[];

  private sessionKeys: Map<string, Buffer>;
  private webPort: number;
  private startedAt: number;
  private defaultSessionKey: Buffer;

  constructor() {
    this.port = 0;
    this.running = false;
    this.messages = [];
    this.sessionKeys = new Map();
    this.webPort = 8080;
    this.startedAt = 0;
    this.defaultSessionKey = crypto.createHash('sha256').update('demo').digest().subarray(0, 32);
  }

  async start(port: number): Promise<void> {
    this.port = port;
    this.identity = await loadIdentity();
    this.peerTable = new PeerTable();
    this.server = new TcpServer(this.identity);
    this.discovery = new Discovery(this.identity, this.port, this.peerTable);

    this.server.setPacketHandler(async (_socket, packet) => {
      if (packet.type !== PacketType.MSG) {
        return;
      }

      try {
        const fromNodeId = packet.nodeId.toString('hex');
        const payload = JSON.parse(packet.payload.toString('utf8')) as {
          nonce: string;
          ciphertext: string;
          tag: string;
        };
        const sessionKey = this.sessionKeys.get(fromNodeId) ?? this.defaultSessionKey;

        const clear = decrypt(sessionKey, {
          nonce: Buffer.from(payload.nonce, 'hex'),
          ciphertext: Buffer.from(payload.ciphertext, 'hex'),
          tag: Buffer.from(payload.tag, 'hex')
        });
        this.receiveMessage(fromNodeId, clear.toString('utf8'), payload.nonce.slice(0, 16));
      } catch {
        // ignore malformed message packets
      }
    });

    await this.server.start(this.port);
    await this.discovery.start();
    this.running = true;
    this.startedAt = Date.now();
    console.log(`[Node] Demarre: ${this.identity.nodeId.slice(0, 16)}... tcp=${this.port}`);
    console.log(`[Node] Public identity: ${JSON.stringify(getPublicIdentity(this.identity))}`);
  }

  async stop(): Promise<void> {
    if (!this.running) {
      return;
    }
    this.discovery.stop();
    await this.server.stop();
    this.peerTable.destroy();
    this.running = false;
  }

  getPeers(): Peer[] {
    return this.peerTable.getAll();
  }

  getMessages(nodeId?: string): typeof this.messages {
    if (!nodeId) {
      return this.messages;
    }
    return this.messages.filter((m) => m.fromNodeId === nodeId || m.toNodeId === nodeId);
  }

  async sendMessage(targetNodeId: string, message: string, sessionKey: Buffer): Promise<void> {
    const peer = this.peerTable.get(targetNodeId);
    if (!peer) {
      throw new Error(`Peer introuvable: ${targetNodeId}`);
    }

    this.sessionKeys.set(targetNodeId, sessionKey);
    this.server.setSessionKey(this.identity.nodeId, sessionKey);

    const encrypted = encrypt(sessionKey, Buffer.from(message, 'utf8'));
    const payload = Buffer.from(
      JSON.stringify({
        nonce: encrypted.nonce.toString('hex'),
        ciphertext: encrypted.ciphertext.toString('hex'),
        tag: encrypted.tag.toString('hex')
      }),
      'utf8'
    );
    const packet = buildPacket(PacketType.MSG, Buffer.from(this.identity.sign.publicKey), payload);

    const client = new TcpClient();
    const socket = await client.connect(peer);
    try {
      await client.sendPacket(socket, packet);
    } finally {
      await client.disconnectGraceful(socket).catch(() => undefined);
    }

    const nonce = crypto.randomBytes(8).toString('hex');
    this.messages.push({
      id: crypto.randomUUID(),
      fromNodeId: this.identity.nodeId,
      toNodeId: targetNodeId,
      content: message,
      nonce,
      timestamp: Date.now(),
      direction: 'sent'
    });
  }

  receiveMessage(fromNodeId: string, content: string, nonce: string): void {
    this.messages.push({
      id: crypto.randomUUID(),
      fromNodeId,
      toNodeId: this.identity.nodeId,
      content,
      nonce,
      timestamp: Date.now(),
      direction: 'received'
    });
  }

  async sendFile(targetNodeId: string, filepath: string, originalName?: string): Promise<void> {
    const peer = this.peerTable.get(targetNodeId);
    if (!peer) {
      throw new Error(`Peer introuvable: ${targetNodeId}`);
    }

    const manifest = await buildManifest(
      filepath,
      this.identity.nodeId,
      (data) => {
        return crypto.createHash('sha256').update(data).digest();
      },
      originalName
    );

    const client = new TcpClient();
    const socket = await client.connect(peer);
    try {
      const manifestPacket = buildPacket(
        PacketType.MANIFEST,
        Buffer.from(this.identity.sign.publicKey),
        Buffer.from(JSON.stringify(manifest), 'utf8')
      );
      await client.sendPacket(socket, manifestPacket);

      for await (const chunk of splitFile(filepath)) {
        this.server.storeChunk(manifest.fileId, chunk.index, chunk.data);
        const chunkPayload = Buffer.from(
          JSON.stringify({
            fileId: manifest.fileId,
            chunkIndex: chunk.index,
            data: chunk.data.toString('hex')
          }),
          'utf8'
        );
        const chunkPacket = buildPacket(PacketType.CHUNK_DATA, Buffer.from(this.identity.sign.publicKey), chunkPayload);
        await client.sendPacket(socket, chunkPacket);
      }
    } finally {
      await client.disconnectGraceful(socket).catch(() => undefined);
    }
  }

  async downloadFile(fileId: string): Promise<string> {
    const manifest = this.server.getManifest(fileId);
    if (!manifest) {
      throw new Error(`Manifest introuvable pour ${fileId}`);
    }

    const outputDir = path.join(process.cwd(), 'downloads');
    const localChunks = this.server.getStoredChunks(fileId);
    if (localChunks.size === manifest.nbChunks) {
      const outputPath = path.join(outputDir, manifest.filename);
      await reassembleFile(outputPath, manifest, localChunks);
      const hash = await computeFileHash(outputPath);
      console.log(`[Node] Fichier reconstruit localement: ${outputPath} (${hash})`);
      return outputPath;
    }

    const peers = this.getPeers();
    if (peers.length === 0) {
      throw new Error('Aucun pair disponible pour telecharger');
    }

    const sessionKeys = new Map<string, Buffer>();
    for (const peer of peers) {
      const key = this.sessionKeys.get(peer.nodeId);
      if (key) {
        sessionKeys.set(peer.nodeId, key);
      }
    }

    if (sessionKeys.size === 0) {
      const fallback = crypto.createHash('sha256').update('archipel-demo-session').digest().subarray(0, 32);
      for (const peer of peers) {
        sessionKeys.set(peer.nodeId, fallback);
      }
    }

    const manager = new DownloadManager(manifest, peers, sessionKeys, outputDir, this.identity.nodeId, localChunks);
    const outputPath = await manager.download();
    const hash = await computeFileHash(outputPath);
    console.log(`[Node] Fichier telecharge: ${outputPath} (${hash})`);
    return outputPath;
  }

  async trustNode(nodeId: string): Promise<void> {
    const peer = this.peerTable.get(nodeId);
    if (!peer || !peer.publicIdentity) {
      throw new Error('Public identity introuvable pour ce noeud');
    }
    await trustPeer(peer.publicIdentity);
  }

  async revokeNode(nodeId: string): Promise<void> {
    await revokePeer(nodeId);
  }

  async getTrustStore(): Promise<any> {
    return loadTrustStore();
  }

  getStatus(): object {
    return {
      nodeId: this.identity?.nodeId ?? '',
      port: this.port,
      peers: this.peerTable?.size() ?? 0,
      running: this.running,
      uptime: this.startedAt > 0 ? Date.now() - this.startedAt : 0,
      aiReady: !process.argv.includes('--no-ai')
    };
  }

  async ensureHandshake(peer: Peer): Promise<Buffer> {
    const existing = this.sessionKeys.get(peer.nodeId);
    if (existing) {
      return existing;
    }

    const client = new TcpClient();
    const socket = await client.connect(peer);
    try {
      const key = await performHandshake(socket, this.identity, true);
      this.sessionKeys.set(peer.nodeId, key);
      this.server.setSessionKey(this.identity.nodeId, key);
      return key;
    } finally {
      await client.disconnectGraceful(socket).catch(() => undefined);
    }
  }

  useChatSession(sessionKey: Buffer): ChatSession {
    return new ChatSession(this.identity, sessionKey);
  }
}
