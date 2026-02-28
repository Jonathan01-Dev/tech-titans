import dgram from 'dgram';
import os from 'os';
import { CONFIG } from '../config.js';
import { buildPacket, parsePacket } from './packet.js';
import { PeerTable } from './peerTable.js';
import type { Identity } from '../types/index.js';
import { PacketType } from '../types/index.js';

export class Discovery {
  private socket!: dgram.Socket;
  private helloInterval: NodeJS.Timeout | null;
  private identity: Identity;
  private tcpPort: number;
  private peerTable: PeerTable;
  private running: boolean;
  private joinedIfaces: string[];
  private localAddresses: Set<string>;
  private duplicateSelfWarnedFrom: Set<string>;

  constructor(identity: Identity, tcpPort: number, peerTable: PeerTable) {
    this.identity = identity;
    this.tcpPort = tcpPort;
    this.peerTable = peerTable;
    this.helloInterval = null;
    this.running = false;
    this.joinedIfaces = [];
    this.localAddresses = new Set<string>(['127.0.0.1', '0.0.0.0']);
    this.duplicateSelfWarnedFrom = new Set<string>();
    const interfaces = os.networkInterfaces();
    for (const entries of Object.values(interfaces)) {
      if (!entries) continue;
      for (const entry of entries) {
        if (entry.family === 'IPv4' && entry.address) {
          this.localAddresses.add(entry.address);
        }
      }
    }
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
          if (!this.localAddresses.has(rinfo.address) && !this.duplicateSelfWarnedFrom.has(rinfo.address)) {
            this.duplicateSelfWarnedFrom.add(rinfo.address);
            console.warn(
              `[Discovery] Alerte: HELLO avec le meme NodeId recu depuis ${rinfo.address}. ` +
                'Deux machines partagent probablement la meme identite (.archipel/identity.json).'
            );
          }
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
        if (message === 'Invalid packet MAGIC' || message === 'Incomplete packet payload/signature') {
          this.debugLog(`Ignored non-Archipel UDP datagram: ${message}`);
          return;
        }
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
          try {
            this.socket.addMembership(CONFIG.MULTICAST_ADDR, CONFIG.MULTICAST_INTERFACE);
            this.joinedIfaces.push(CONFIG.MULTICAST_INTERFACE);
            console.log(`[Discovery] Multicast joined on ${CONFIG.MULTICAST_INTERFACE}`);
          } catch {
            this.socket.addMembership(CONFIG.MULTICAST_ADDR);
            console.log('[Discovery] Multicast joined on default interface');
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
      if (this.joinedIfaces.length > 0) {
        for (const iface of this.joinedIfaces) {
          try {
            this.socket.dropMembership(CONFIG.MULTICAST_ADDR, iface);
          } catch {
            // ignore per-interface dropMembership errors during shutdown
          }
        }
      } else {
        this.socket.dropMembership(CONFIG.MULTICAST_ADDR);
      }
    } catch {
      // ignore dropMembership errors during shutdown
    }

    this.joinedIfaces = [];
    this.socket.close();
    console.log('[Discovery] Stopped');
  }
}
