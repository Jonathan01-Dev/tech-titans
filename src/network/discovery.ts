import dgram from 'dgram';
import os from 'os';
import { CONFIG } from '../config.js';
import { buildPacket, parsePacket } from './packet.js';
import { PeerTable } from './peerTable.js';
import type { Identity } from '../types/index.js';
import { PacketType } from '../types/index.js';

function getActiveIpv4Interfaces(): string[] {
  const nets = os.networkInterfaces();
  const addresses = new Set<string>();

  for (const list of Object.values(nets)) {
    if (!list) continue;
    for (const net of list) {
      if (net.family === 'IPv4' && !net.internal) {
        addresses.add(net.address);
      }
    }
  }

  return [...addresses];
}

export class Discovery {
  private socket!: dgram.Socket;
  private helloInterval: NodeJS.Timeout | null;
  private identity: Identity;
  private tcpPort: number;
  private peerTable: PeerTable;
  private running: boolean;

  constructor(identity: Identity, tcpPort: number, peerTable: PeerTable) {
    this.identity = identity;
    this.tcpPort = tcpPort;
    this.peerTable = peerTable;
    this.helloInterval = null;
    this.running = false;
  }

  async start(): Promise<void> {
    if (this.running) {
      return;
    }

    this.running = true;
    this.socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });

    this.socket.on('message', (msg: Buffer, rinfo: dgram.RemoteInfo) => {
      try {
        const pkt = parsePacket(msg);
        const ourNodeId = Buffer.from(this.identity.sign.publicKey).toString('hex');
        const packetNodeIdHex = pkt.nodeId.toString('hex');

        if (pkt.type === PacketType.HELLO && packetNodeIdHex !== ourNodeId) {
          const payload = JSON.parse(pkt.payload.toString('utf8')) as { tcp_port: number; timestamp: number };

          this.peerTable.upsert(packetNodeIdHex, {
            ip: rinfo.address,
            tcpPort: payload.tcp_port,
            lastSeen: Date.now()
          });

          console.log(`[Discovery] Pair: ${packetNodeIdHex.slice(0, 16)}... @ ${rinfo.address}:${payload.tcp_port}`);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error('[Discovery] Message ignore:', message);
      }
    });

    this.socket.on('error', (err) => {
      console.error('[Discovery] UDP error:', err);
    });

    await new Promise<void>((resolve, reject) => {
      this.socket.once('error', reject);
      this.socket.bind(CONFIG.MULTICAST_PORT, () => {
        try {
          const ifaces = getActiveIpv4Interfaces();

          if (ifaces.length === 0) {
            this.socket.addMembership(CONFIG.MULTICAST_ADDR);
          } else {
            for (const iface of ifaces) {
              try {
                this.socket.addMembership(CONFIG.MULTICAST_ADDR, iface);
                console.log(`[Discovery] Multicast joined on ${iface}`);
              } catch (err) {
                const message = err instanceof Error ? err.message : String(err);
                console.warn(`[Discovery] Join failed on ${iface}: ${message}`);
              }
            }
          }

          this.socket.setMulticastLoopback(true);
          this.socket.setBroadcast(true);
          this.socket.setMulticastTTL(128);
          this.sendHello();
          this.helloInterval = setInterval(() => this.sendHello(), CONFIG.HELLO_INTERVAL);
          console.log(`[Discovery] Started on ${CONFIG.MULTICAST_ADDR}:${CONFIG.MULTICAST_PORT}`);
          resolve();
        } catch (error) {
          reject(error);
        }
      });
    });
  }

  private sendHello(): void {
    if (!this.running) {
      return;
    }

    const nodeIdBuffer = Buffer.from(this.identity.sign.publicKey);
    const payload = Buffer.from(
      JSON.stringify({
        tcp_port: this.tcpPort,
        timestamp: Date.now()
      }),
      'utf8'
    );

    const pkt = buildPacket(PacketType.HELLO, nodeIdBuffer, payload);
    this.socket.send(pkt, CONFIG.MULTICAST_PORT, CONFIG.MULTICAST_ADDR);
    this.socket.send(pkt, CONFIG.MULTICAST_PORT, CONFIG.BROADCAST_ADDR);
    console.log('[Discovery] HELLO sent (multicast+broadcast)');
  }

  stop(): void {
    if (!this.running) {
      return;
    }

    this.running = false;

    if (this.helloInterval) {
      clearInterval(this.helloInterval);
      this.helloInterval = null;
    }

    try {
      this.socket.dropMembership(CONFIG.MULTICAST_ADDR);
    } catch {
      // ignore dropMembership errors during shutdown
    }

    this.socket.close();
    console.log('[Discovery] Stopped');
  }
}
