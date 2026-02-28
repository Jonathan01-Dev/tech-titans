import path from 'path';
import process from 'process';
import { loadIdentity } from '../crypto/identity.js';
import { TcpServer } from '../network/server.js';
import { TcpClient } from '../network/client.js';
import { FileSender, FileReceiver } from '../transfer/fileTransfer.js';
import { PacketType } from '../types/index.js';
import type { Peer } from '../types/index.js';

type Options = Record<string, string>;

function parseArgs(argv: string[]): { command: string; options: Options } {
  const [command = '', ...rest] = argv;
  const options: Options = {};

  for (let i = 0; i < rest.length; i += 1) {
    const arg = rest[i];
    if (!arg.startsWith('--')) {
      continue;
    }

    const key = arg.slice(2);
    const next = rest[i + 1];
    if (!next || next.startsWith('--')) {
      options[key] = 'true';
      continue;
    }

    options[key] = next;
    i += 1;
  }

  return { command, options };
}

function printUsage(): void {
  console.log('ARCHIPEL CLI');
  console.log('-----------------------------------------');
  console.log('Receive:');
  console.log('  npx.cmd ts-node --esm src/cli/index.ts recv --port 7778 --out demo\\received');
  console.log('Send:');
  console.log('  npx.cmd ts-node --esm src/cli/index.ts send --ip 192.168.1.20 --port 7778 --file C:\\path\\video.mp4');
  console.log('-----------------------------------------');
}

async function runRecv(options: Options): Promise<void> {
  const identity = await loadIdentity();
  const port = Number(options.port ?? process.env.TCP_PORT ?? '7777');
  const outDir = path.join(process.cwd(), options.out ?? path.join('demo', 'received'));
  const server = new TcpServer(identity);
  const receiver = new FileReceiver(outDir);
  const pending = new Set<string>();

  server.setPacketHandler(async (_socket, packet) => {
    if (packet.type === PacketType.MANIFEST) {
      const manifest = JSON.parse(packet.payload.toString('utf8')) as { fileId: string; filename: string; size: number };
      if (!pending.has(manifest.fileId)) {
        pending.add(manifest.fileId);
        console.log(
          `[RECV] MANIFEST ${manifest.filename} (${manifest.size} bytes) fileId=${manifest.fileId.slice(0, 16)}...`
        );
        void receiver
          .waitForCompletion(manifest.fileId, 300000)
          .then((finalPath) => {
            console.log(`[RECV] Completed: ${finalPath}`);
            pending.delete(manifest.fileId);
          })
          .catch((error) => {
            const message = error instanceof Error ? error.message : String(error);
            console.error(`[RECV] Failed: ${message}`);
            pending.delete(manifest.fileId);
          });
      }
    }

    await receiver.handlePacket(packet.type, packet.payload);
  });

  await server.start(port);
  console.log('ARCHIPEL - Receive Mode');
  console.log('-----------------------------------------');
  console.log(`NodeId: ${identity.nodeId.slice(0, 16)}...`);
  console.log(`Port  : ${port}`);
  console.log(`Out   : ${outDir}`);
  console.log('Ctrl+C to stop');

  process.on('SIGINT', async () => {
    console.log('\n[RECV] Stopping...');
    await server.stop().catch(() => undefined);
    process.exit(0);
  });
}

async function runSend(options: Options): Promise<void> {
  const ip = options.ip;
  const fileArg = options.file;
  const port = Number(options.port ?? '7777');

  if (!ip || !fileArg) {
    throw new Error('Missing required args: --ip and --file');
  }

  const identity = await loadIdentity();
  const client = new TcpClient();
  const sender = new FileSender();
  const filePath = path.join(fileArg);
  const peer: Peer = {
    nodeId: 'remote',
    ip,
    tcpPort: port,
    lastSeen: Date.now(),
    sharedFiles: [],
    reputation: 1
  };

  const socket = await client.connect(peer);
  try {
    console.log('ARCHIPEL - Send Mode');
    console.log('-----------------------------------------');
    console.log(`To   : ${ip}:${port}`);
    console.log(`File : ${filePath}`);
    const manifest = await sender.sendFile(socket, filePath, Buffer.from(identity.sign.publicKey));
    console.log(`FileId : ${manifest.fileId}`);
    console.log(`Chunks : ${manifest.nbChunks}`);
    console.log('Send OK');
  } finally {
    await client.disconnectGraceful(socket);
  }
}

async function main(): Promise<void> {
  const { command, options } = parseArgs(process.argv.slice(2));

  if (!command || command === 'help' || options.help === 'true') {
    printUsage();
    return;
  }

  if (command === 'recv') {
    await runRecv(options);
    return;
  }

  if (command === 'send') {
    await runSend(options);
    return;
  }

  throw new Error(`Unknown command: ${command}`);
}

void main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`ERREUR : ${message}`);
  printUsage();
  process.exit(1);
});
