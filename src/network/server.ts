import net from 'net';
import { EventEmitter } from 'events';
import { CONFIG } from '../config.js';
import { parsePacket, buildPacket } from './packet.js';
import type { FileManifest, Identity } from '../types/index.js';
import { PacketType } from '../types/index.js';
import { encrypt } from '../crypto/cipher.js';

type PacketData = { type: number; nodeId: Buffer; payload: Buffer; signature: Buffer };
type PacketHandler = (socket: net.Socket, packet: PacketData) => void | Promise<void>;
type RawConnectionHandler = (socket: net.Socket) => void | Promise<void>;

export class TcpServer extends EventEmitter {
  private server!: net.Server;
  private connections: Set<net.Socket>;
  private identity: Identity;
  private port: number;
  private socketBuffers: Map<net.Socket, Buffer>;
  private packetHandler: PacketHandler | null;
  private rawConnectionHandler: RawConnectionHandler | null;
  private chunkStore: Map<string, Map<number, Buffer>>;
  private manifestStore: Map<string, FileManifest>;
  private sessionKeys: Map<string, Buffer>;

  constructor(identity: Identity) {
    super();
    this.connections = new Set();
    this.identity = identity;
    this.port = 0;
    this.socketBuffers = new Map();
    this.packetHandler = null;
    this.rawConnectionHandler = null;
    this.chunkStore = new Map();
    this.manifestStore = new Map();
    this.sessionKeys = new Map();
  }

  setPacketHandler(handler: PacketHandler): void {
    this.packetHandler = handler;
  }

  setRawConnectionHandler(handler: RawConnectionHandler): void {
    this.rawConnectionHandler = handler;
  }

  setSessionKey(peerId: string, sessionKey: Buffer): void {
    this.sessionKeys.set(peerId, sessionKey);
  }

  storeChunk(fileId: string, index: number, data: Buffer): void {
    if (!this.chunkStore.has(fileId)) {
      this.chunkStore.set(fileId, new Map<number, Buffer>());
    }
    const fileChunks = this.chunkStore.get(fileId);
    if (!fileChunks) {
      return;
    }
    fileChunks.set(index, data);
  }

  getChunk(fileId: string, index: number): Buffer | undefined {
    return this.chunkStore.get(fileId)?.get(index);
  }

  hasFile(fileId: string): boolean {
    return this.chunkStore.has(fileId);
  }

  listFileIds(): string[] {
    return Array.from(this.chunkStore.keys());
  }

  getManifest(fileId: string): FileManifest | undefined {
    return this.manifestStore.get(fileId);
  }

  private extractPackets(buffer: Buffer): { packets: PacketData[]; remaining: Buffer } {
    const packets: PacketData[] = [];
    let offset = 0;

    while (offset + 73 <= buffer.length) {
      const payloadLen = buffer.readUInt32BE(offset + 37);
      const packetLen = 41 + payloadLen + 32;

      if (offset + packetLen > buffer.length) {
        break;
      }

      const packetBuffer = buffer.subarray(offset, offset + packetLen);
      packets.push(parsePacket(packetBuffer));
      offset += packetLen;
    }

    return { packets, remaining: buffer.subarray(offset) };
  }

  private async handleBuiltInPacket(socket: net.Socket, pkt: PacketData): Promise<boolean> {
    if (pkt.type === PacketType.CHUNK_REQ) {
      const body = JSON.parse(pkt.payload.toString('utf8')) as {
        fileId: string;
        chunkIndex: number;
        requesterId: string;
      };
      const chunk = this.getChunk(body.fileId, body.chunkIndex);

      if (!chunk) {
        const notFound = buildPacket(
          PacketType.ACK,
          Buffer.from(this.identity.sign.publicKey),
          Buffer.from(JSON.stringify({ status: 0x02 }), 'utf8')
        );
        socket.write(notFound);
        return true;
      }

      const sessionKey = this.sessionKeys.get(body.requesterId);
      if (!sessionKey) {
        const noKey = buildPacket(
          PacketType.ACK,
          Buffer.from(this.identity.sign.publicKey),
          Buffer.from(JSON.stringify({ status: 0x03 }), 'utf8')
        );
        socket.write(noKey);
        return true;
      }

      const enc = encrypt(sessionKey, chunk);
      const payload = Buffer.from(
        JSON.stringify({
          fileId: body.fileId,
          chunkIndex: body.chunkIndex,
          nonce: enc.nonce.toString('hex'),
          ciphertext: enc.ciphertext.toString('hex'),
          tag: enc.tag.toString('hex')
        }),
        'utf8'
      );

      const packet = buildPacket(PacketType.CHUNK_DATA, Buffer.from(this.identity.sign.publicKey), payload);
      socket.write(packet);
      return true;
    }

    if (pkt.type === PacketType.MANIFEST) {
      const manifest = JSON.parse(pkt.payload.toString('utf8')) as FileManifest;
      this.manifestStore.set(manifest.fileId, manifest);
      this.emit('manifest', manifest);

      const ack = buildPacket(
        PacketType.ACK,
        Buffer.from(this.identity.sign.publicKey),
        Buffer.from(JSON.stringify({ status: 0x00 }), 'utf8')
      );
      socket.write(ack);
      return true;
    }

    if (pkt.type === PacketType.CHUNK_DATA) {
      const body = JSON.parse(pkt.payload.toString('utf8')) as {
        fileId: string;
        chunkIndex: number;
        data?: string;
      };

      if (!body.fileId || typeof body.chunkIndex !== 'number' || !body.data) {
        const invalid = buildPacket(
          PacketType.ACK,
          Buffer.from(this.identity.sign.publicKey),
          Buffer.from(JSON.stringify({ status: 0x01 }), 'utf8')
        );
        socket.write(invalid);
        return true;
      }

      this.storeChunk(body.fileId, body.chunkIndex, Buffer.from(body.data, 'hex'));

      const ack = buildPacket(
        PacketType.ACK,
        Buffer.from(this.identity.sign.publicKey),
        Buffer.from(JSON.stringify({ status: 0x00 }), 'utf8')
      );
      socket.write(ack);
      return true;
    }

    return false;
  }

  start(port: number): Promise<void> {
    this.port = port;

    this.server = net.createServer((socket) => {
      this.connections.add(socket);
      this.socketBuffers.set(socket, Buffer.alloc(0));
      socket.setKeepAlive(true, CONFIG.KEEPALIVE_INTERVAL);
      console.log(`[TCP] Connexion de ${socket.remoteAddress ?? 'unknown'}:${socket.remotePort ?? 0}`);

      socket.on('close', () => {
        this.connections.delete(socket);
        this.socketBuffers.delete(socket);
        console.log('[TCP] Connexion fermee');
      });

      socket.on('error', (err) => {
        this.connections.delete(socket);
        this.socketBuffers.delete(socket);
        console.error('[TCP] Erreur connexion:', err);
      });

      if (this.rawConnectionHandler) {
        void this.rawConnectionHandler(socket);
        return;
      }

      socket.on('data', (data: Buffer) => {
        try {
          const buffered = Buffer.concat([this.socketBuffers.get(socket) ?? Buffer.alloc(0), data]);
          const { packets, remaining } = this.extractPackets(buffered);
          this.socketBuffers.set(socket, remaining);

          for (const pkt of packets) {
            console.log(`[TCP] Paquet recu type=${pkt.type}`);

            void this.handleBuiltInPacket(socket, pkt).then((handled) => {
              if (!handled && pkt.type !== PacketType.ACK) {
                const ack = buildPacket(PacketType.ACK, Buffer.from(this.identity.sign.publicKey), Buffer.alloc(0));
                socket.write(ack);
              }
            });

            if (this.packetHandler) {
              void this.packetHandler(socket, pkt);
            }
          }
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          console.error('[TCP] Erreur parsing paquet:', message);
        }
      });
    });

    return new Promise<void>((resolve, reject) => {
      this.server.once('error', reject);
      this.server.listen(port, () => {
        console.log(`[TCP] Serveur sur port ${port}`);
        resolve();
      });
    });
  }

  stop(): Promise<void> {
    for (const socket of this.connections) {
      socket.destroy();
    }
    this.connections.clear();
    this.socketBuffers.clear();

    return new Promise<void>((resolve) => {
      this.server.close(() => resolve());
    });
  }

  getConnectionCount(): number {
    return this.connections.size;
  }
}
