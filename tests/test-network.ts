import { loadIdentity } from '../src/crypto/identity.js';
import { PeerTable } from '../src/network/peerTable.js';
import { Discovery } from '../src/network/discovery.js';
import { TcpServer } from '../src/network/server.js';
import { CONFIG } from '../src/config.js';

async function run(): Promise<void> {
  const identity = await loadIdentity();
  const peerTable = new PeerTable();
  const server = new TcpServer(identity);
  const tcpPort = CONFIG.TCP_PORT;
  const discovery = new Discovery(identity, tcpPort, peerTable);

  try {
    await server.start(tcpPort);
    await discovery.start();

    const nodeIdShort = identity.nodeId.slice(0, 16);
    console.log('ARCHIPEL - Test Network Sprint 1');
    console.log('-----------------------------------------');
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
    console.log(`Pairs découverts : ${peers.length}`);
    for (const peer of peers) {
      console.log(`- ${peer.nodeId.slice(0, 16)}... @ ${peer.ip}:${peer.tcpPort}`);
    }
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
