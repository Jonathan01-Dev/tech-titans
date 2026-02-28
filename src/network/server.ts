import net from 'net';
import { CONFIG } from '../config.js';
import { parsePacket, buildPacket } from './packet.js';
import type { Identity } from '../types/index.js';
import { PacketType } from '../types/index.js';

type PacketData = { type: number; nodeId: Buffer; payload: Buffer; signature: Buffer };
type PacketHandler = (socket: net.Socket, packet: PacketData) => void | Promise<void>;

export class TcpServer {
  private server!: net.Server;
  private connections: Set<net.Socket>;
  private identity: Identity;
  private port: number;
  private socketBuffers: Map<net.Socket, Buffer>;
  private packetHandler: PacketHandler | null;

  constructor(identity: Identity) {
    this.connections = new Set();
    this.identity = identity;
    this.port = 0;
    this.socketBuffers = new Map();
    this.packetHandler = null;
  }

  setPacketHandler(handler: PacketHandler): void {
    this.packetHandler = handler;
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

  start(port: number): Promise<void> {
    this.port = port;

    this.server = net.createServer((socket) => {
      this.connections.add(socket);
      this.socketBuffers.set(socket, Buffer.alloc(0));
      socket.setKeepAlive(true, CONFIG.KEEPALIVE_INTERVAL);
      console.log(`[TCP] Connexion de ${socket.remoteAddress ?? 'unknown'}:${socket.remotePort ?? 0}`);

      socket.on('data', (data: Buffer) => {
        try {
          const buffered = Buffer.concat([this.socketBuffers.get(socket) ?? Buffer.alloc(0), data]);
          const { packets, remaining } = this.extractPackets(buffered);
          this.socketBuffers.set(socket, remaining);

          for (const pkt of packets) {
            console.log(`[TCP] Paquet recu type=${pkt.type}`);

            if (this.packetHandler) {
              void this.packetHandler(socket, pkt);
            }

            if (pkt.type !== PacketType.ACK) {
              const ack = buildPacket(PacketType.ACK, Buffer.from(this.identity.sign.publicKey), Buffer.alloc(0));
              socket.write(ack);
            }
          }
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          console.error('[TCP] Erreur parsing paquet:', message);
        }
      });

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
