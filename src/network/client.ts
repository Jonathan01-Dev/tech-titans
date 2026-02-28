import net from 'net';
import { buildPacket, parsePacket } from './packet.js';
import type { Peer } from '../types/index.js';

export class TcpClient {
  connect(peer: Peer): Promise<net.Socket> {
    return new Promise<net.Socket>((resolve, reject) => {
      const socket = new net.Socket();
      socket.setTimeout(5000);

      socket.connect(peer.tcpPort, peer.ip, () => {
        socket.setTimeout(0);
        resolve(socket);
      });

      socket.on('timeout', () => {
        socket.destroy();
        reject(new Error(`Connexion timeout vers peer:${peer.ip}:${peer.tcpPort}`));
      });

      socket.on('error', (err) => reject(err));
    });
  }

  sendPacket(socket: net.Socket, packet: Buffer): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      socket.write(packet, (err) => {
        if (err) {
          reject(err);
          return;
        }
        resolve();
      });
    });
  }

  disconnect(socket: net.Socket): void {
    socket.destroy();
  }

  disconnectGraceful(socket: net.Socket, timeoutMs = 5000): Promise<void> {
    return new Promise<void>((resolve) => {
      let settled = false;

      const finish = (): void => {
        if (settled) {
          return;
        }
        settled = true;
        resolve();
      };

      const timer = setTimeout(() => {
        socket.destroy();
        finish();
      }, timeoutMs);

      socket.once('close', () => {
        clearTimeout(timer);
        finish();
      });

      socket.end();
    });
  }
}
