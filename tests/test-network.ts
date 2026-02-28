import os from 'os';
import type net from 'net';
import { loadIdentity } from '../src/crypto/identity.js';
import { PeerTable } from '../src/network/peerTable.js';
import { Discovery } from '../src/network/discovery.js';
import { TcpServer } from '../src/network/server.js';
import { TcpClient } from '../src/network/client.js';
import { buildPacket } from '../src/network/packet.js';
import { CONFIG } from '../src/config.js';
import { PacketType } from '../src/types/index.js';

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

async function run(): Promise<void> {
  const identity = await loadIdentity();
  const peerTable = new PeerTable();
  const server = new TcpServer(identity);
  const client = new TcpClient();
  const tcpPort = CONFIG.TCP_PORT;
  const discovery = new Discovery(identity, tcpPort, peerTable);
  const localIpv4 = getActiveIpv4Interfaces();
  const forcedIface = CONFIG.MULTICAST_IFACE || '<auto>';

  try {
    await server.start(tcpPort);
    await discovery.start();

    const nodeIdShort = identity.nodeId.slice(0, 16);
    console.log('ARCHIPEL - Test Network Sprint 1');
    console.log('-----------------------------------------');
    console.log('Pre-check:');
    console.log(`- DISCOVERY_DEBUG : ${CONFIG.DISCOVERY_DEBUG ? '1' : '0'}`);
    console.log(`- MULTICAST_IFACE : ${forcedIface}`);
    console.log(`- Local IPv4      : ${localIpv4.length > 0 ? localIpv4.join(', ') : '<none>'}`);
    if (CONFIG.MULTICAST_IFACE && !localIpv4.includes(CONFIG.MULTICAST_IFACE)) {
      console.log('- WARNING         : MULTICAST_IFACE n existe pas sur ce PC');
    }
    console.log(`NodeId   : ${nodeIdShort}...`);
    console.log(`TCP Port : ${tcpPort}`);
    console.log(`Multicast: ${CONFIG.MULTICAST_ADDR}:${CONFIG.MULTICAST_PORT}`);
    console.log('-----------------------------------------');
    console.log('Attente 10 secondes pour decouverte...');

    for (let remaining = 10; remaining > 0; remaining -= 1) {
      console.log(`Attente... ${remaining}s`);
      await new Promise<void>((resolve) => setTimeout(resolve, 1000));
    }

    const peers = peerTable.getAll();
    console.log(`Pairs decouverts : ${peers.length}`);
    for (const peer of peers) {
      console.log(`- ${peer.nodeId.slice(0, 16)}... @ ${peer.ip}:${peer.tcpPort}`);
    }

    let tcpProbeSuccess = 0;
    const openedSockets: net.Socket[] = [];
    for (const peer of peers) {
      try {
        const socket = await client.connect(peer);
        openedSockets.push(socket);

        const probePayload = Buffer.from(
          JSON.stringify({ kind: 'tcp_probe', from: identity.nodeId, ts: Date.now() }),
          'utf8'
        );
        const probePacket = buildPacket(PacketType.MSG, Buffer.from(identity.sign.publicKey), probePayload);
        await client.sendPacket(socket, probePacket);
        tcpProbeSuccess += 1;
        console.log(`[TCP][Probe] OK vers ${peer.ip}:${peer.tcpPort}`);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.log(`[TCP][Probe] KO vers ${peer.ip}:${peer.tcpPort} (${message})`);
      }
    }

    if (openedSockets.length > 0) {
      await new Promise<void>((resolve) => setTimeout(resolve, 1200));
      for (const socket of openedSockets) {
        client.disconnect(socket);
      }
    }

    console.log(`[TCP][Probe] Reussis : ${tcpProbeSuccess}/${peers.length}`);
    console.log(`Connexions TCP actives : ${server.getConnectionCount()}`);
    console.log('-----------------------------------------');
    console.log('Test reseau OK - en attente de pairs');
    console.log('(Lance 2 instances pour voir la decouverte)');

    discovery.stop();
    await server.stop();
    peerTable.destroy();
    process.exit(0);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`ERREUR : ${message}`);
    discovery.stop();
    await server.stop().catch(() => undefined);
    peerTable.destroy();
    process.exit(1);
  }
}

void run();
