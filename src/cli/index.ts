import { ArpelNode } from './node.js';
import { startWebServer } from '../api/server.js';

function readArgValue(flag: string): string | null {
  const idx = process.argv.indexOf(flag);
  if (idx >= 0 && idx + 1 < process.argv.length) {
    return process.argv[idx + 1];
  }
  return null;
}

function parsePort(raw: string | null | undefined, fallback: number): number {
  const value = parseInt(String(raw ?? ''), 10);
  if (!Number.isInteger(value) || value <= 0 || value > 65535) {
    return fallback;
  }
  return value;
}

// Compat: accepte aussi l'ancien style "recv --port 7778 --out demo\\received".
const modeArg = process.argv[2];
const isLegacyMode = modeArg === 'recv' || modeArg === 'send';

const tcpArg = readArgValue('--port');
const webArg = readArgValue('--web-port');
const tcpPort = parsePort(tcpArg ?? process.env.TCP_PORT, 7777);
const defaultWebPort = 8080 + (tcpPort - 7777);
const webPort = parsePort(webArg ?? process.env.WEB_PORT, defaultWebPort);

async function main(): Promise<void> {
  console.log('ARCHIPEL - Demarrage...');
  if (isLegacyMode) {
    console.log(`Mode CLI detecte: ${modeArg} (compatibilite active)`);
  }
  console.log('TCP Port : ' + tcpPort);
  console.log('Web Port : ' + webPort);

  const node = new ArpelNode();
  await node.start(tcpPort);
  await startWebServer(node, webPort);

  console.log('');
  console.log('Interface web : http://localhost:' + webPort);
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
