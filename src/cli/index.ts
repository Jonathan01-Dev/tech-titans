import { ArpelNode } from './node.js';
import { startWebServer } from '../api/server.js';

const TCP_PORT = parseInt(process.env.TCP_PORT || '7777', 10);
const WEB_PORT = parseInt(process.env.WEB_PORT || '8080', 10);

async function main(): Promise<void> {
  console.log('ARCHIPEL - Demarrage...');
  console.log('TCP Port : ' + TCP_PORT);
  console.log('Web Port : ' + WEB_PORT);

  const node = new ArpelNode();
  await node.start(TCP_PORT);
  await startWebServer(node, WEB_PORT);

  console.log('');
  console.log('Interface web : http://localhost:' + WEB_PORT);
  console.log('NodeId : ' + node.identity.nodeId);
  console.log('Ctrl+C pour arreter');

  process.on('SIGINT', async () => {
    await node.stop();
    process.exit(0);
  });
}

void main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exit(1);
});
