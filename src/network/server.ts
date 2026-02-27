import net from 'net';
import { CONFIG } from '../config.js';
import { parsePacket, buildPacket } from './packet.js';
import type { Identity } from '../types/index.js';
import { PacketType } from '../types/index.js';

export class TcpServer {
  private server!: net.Server;
  private connections: Set<net.Socket>;
  private identity: Identity;
  private port: number;

  constructor(identity: Identity) {
    this.connections = new Set();
    this.identity = identity;
    this.port = 0;
  }

  start(port: number): Promise<void> {
    this.port = port;

    this.server = net.createServer((socket) => {
      this.connections.add(socket);
      socket.setKeepAlive(true, CONFIG.KEEPALIVE_INTERVAL);
      console.log(`[TCP] Connexion de ${socket.remoteAddress ?? 'unknown'}:${socket.remotePort ?? 0}`);

      socket.on('data', (data: Buffer) => {
        try {
          const pkt = parsePacket(data);
          console.log(`[TCP] Paquet reçu type=${pkt.type}`);

          if (pkt.type === PacketType.ACK) {
            return;
          }

          const ack = buildPacket(PacketType.ACK, Buffer.from(this.identity.sign.publicKey), Buffer.alloc(0));
          socket.write(ack);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          console.error('[TCP] Erreur parsing paquet:', message);
        }
      });

      socket.on('close', () => {
        this.connections.delete(socket);
        console.log('[TCP] Connexion fermée');
      });

      socket.on('error', (err) => {
        this.connections.delete(socket);
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

    return new Promise<void>((resolve) => {
      this.server.close(() => resolve());
    });
  }

  getConnectionCount(): number {
    return this.connections.size;
  }
}
