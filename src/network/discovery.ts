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
  private joinedIfaces: string[];

  constructor(identity: Identity, tcpPort: number, peerTable: PeerTable) {
    this.identity = identity;
    this.tcpPort = tcpPort;
    this.peerTable = peerTable;
    this.helloInterval = null;
    this.running = false;
    this.joinedIfaces = [];
  }

  private debugLog(message: string): void {
    if (CONFIG.DISCOVERY_DEBUG) {
      console.log(`[Discovery][debug] ${message}`);
    }
  }

  async start(): Promise<void> {
    if (this.running) {
      return;
    }

    this.running = true;
    this.socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });

    this.socket.on('message', (msg: Buffer, rinfo: dgram.RemoteInfo) => {
      this.debugLog(`UDP datagram from ${rinfo.address}:${rinfo.port}, ${msg.length} bytes`);

      try {
        const pkt = parsePacket(msg);
        const ourNodeId = Buffer.from(this.identity.sign.publicKey).toString('hex');
        const packetNodeIdHex = pkt.nodeId.toString('hex');
        const isSelf = packetNodeIdHex === ourNodeId;

        this.debugLog(
          `Parsed packet type=0x${pkt.type.toString(16).padStart(2, '0')} node=${packetNodeIdHex.slice(0, 16)}... self=${isSelf}`
        );

        if (pkt.type !== PacketType.HELLO) {
          this.debugLog(`Ignored packet type ${pkt.type} (expected HELLO)`);
          return;
        }

        if (isSelf) {
          this.debugLog('Ignored self HELLO packet');
          return;
        }

        const payloadText = pkt.payload.toString('utf8');
        this.debugLog(`HELLO payload raw: ${payloadText}`);
        const payload = JSON.parse(payloadText) as { tcp_port: number; timestamp: number };

        if (typeof payload.tcp_port !== 'number') {
          this.debugLog('Ignored HELLO payload without numeric tcp_port');
          return;
        }

        this.peerTable.upsert(packetNodeIdHex, {
          ip: rinfo.address,
          tcpPort: payload.tcp_port,
          lastSeen: Date.now()
        });

        console.log(`[Discovery] Pair: ${packetNodeIdHex.slice(0, 16)}... @ ${rinfo.address}:${payload.tcp_port}`);
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
          const forcedIface = CONFIG.MULTICAST_IFACE.trim();
          const ifaces = forcedIface.length > 0 ? [forcedIface] : getActiveIpv4Interfaces();

          this.debugLog(
            `Startup: forcedIface=${forcedIface || '<none>'}, selectedIfaces=${ifaces.join(', ') || '<none>'}`
          );

          if (ifaces.length === 0) {
            this.socket.addMembership(CONFIG.MULTICAST_ADDR);
            this.debugLog('Joined multicast without explicit interface');
          } else {
            for (const iface of ifaces) {
              try {
                this.socket.addMembership(CONFIG.MULTICAST_ADDR, iface);
                this.joinedIfaces.push(iface);
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
          if (forcedIface.length > 0) {
            try {
              this.socket.setMulticastInterface(forcedIface);
              this.debugLog(`Multicast send interface set to ${forcedIface}`);
            } catch (err) {
              const message = err instanceof Error ? err.message : String(err);
              console.warn(`[Discovery] Failed to set multicast interface ${forcedIface}: ${message}`);
            }
          }

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
    this.debugLog(
      `HELLO emitted size=${pkt.length} tcpPort=${this.tcpPort} via=${this.joinedIfaces.join(', ') || 'default-route'}`
    );
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
