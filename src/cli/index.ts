import { ArpelNode } from './node.js';
import { startWebServer } from '../api/server.js';
import net from 'net';

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

function isPortFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.unref();
    server.once('error', () => resolve(false));
    server.listen(port, '0.0.0.0', () => {
      server.close(() => resolve(true));
    });
  });
}

async function findAvailablePort(startPort: number, forbidden: Set<number> = new Set()): Promise<number> {
  const first = Math.max(1, Math.min(65535, startPort));
  for (let offset = 0; offset < 200; offset += 1) {
    const candidate = first + offset;
    if (candidate > 65535) break;
    if (forbidden.has(candidate)) continue;
    if (await isPortFree(candidate)) return candidate;
  }
  throw new Error(`Aucun port libre trouve a partir de ${first}`);
}

// Compat: accepte aussi l'ancien style "recv --port 7778 --out demo\\received".
const modeArg = process.argv[2];
const isLegacyMode = modeArg === 'recv' || modeArg === 'send';

const tcpArg = readArgValue('--port');
const webArg = readArgValue('--web-port');
const requestedTcpPort = parsePort(tcpArg ?? process.env.TCP_PORT, 7777);

async function main(): Promise<void> {
  const tcpPort = await findAvailablePort(requestedTcpPort);
  const defaultWebPort = 8080 + (tcpPort - 7777);
  const requestedWebPort = parsePort(webArg ?? process.env.WEB_PORT, defaultWebPort);
  const webPort = await findAvailablePort(requestedWebPort, new Set([tcpPort]));

  console.log('ARCHIPEL - Demarrage...');
  if (isLegacyMode) {
    console.log(`Mode CLI detecte: ${modeArg} (compatibilite active)`);
  }
  if (tcpPort !== requestedTcpPort) {
    console.log(`TCP Port demande ${requestedTcpPort} occupe, bascule automatique vers ${tcpPort}`);
  }
  if (webPort !== requestedWebPort) {
    console.log(`Web Port demande ${requestedWebPort} occupe, bascule automatique vers ${webPort}`);
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
