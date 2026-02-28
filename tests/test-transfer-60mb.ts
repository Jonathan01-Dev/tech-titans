import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import { loadIdentity } from '../src/crypto/identity.js';
import { TcpServer } from '../src/network/server.js';
import { TcpClient } from '../src/network/client.js';
import { FileSender, FileReceiver } from '../src/transfer/fileTransfer.js';
import type { Peer } from '../src/types/index.js';

const TEST_PORT = 7790;
const TEST_SIZE_MB = 60;

async function ensureTestFile(filePath: string, sizeMb: number): Promise<void> {
  const targetSize = sizeMb * 1024 * 1024;

  try {
    const existing = await fsp.stat(filePath);
    if (existing.size === targetSize) {
      return;
    }
  } catch {
    // ignore and recreate
  }

  await fsp.mkdir(path.dirname(filePath), { recursive: true });
  const stream = fs.createWriteStream(filePath, { flags: 'w' });
  const block = Buffer.alloc(1024 * 1024);

  for (let i = 0; i < block.length; i += 1) {
    block[i] = i % 251;
  }

  for (let i = 0; i < sizeMb; i += 1) {
    await new Promise<void>((resolve, reject) => {
      stream.write(block, (err) => {
        if (err) {
          reject(err);
          return;
        }
        resolve();
      });
    });
  }

  await new Promise<void>((resolve) => stream.end(() => resolve()));
}

async function fileHash(filePath: string): Promise<string> {
  const hash = crypto.createHash('sha256');
  const stream = fs.createReadStream(filePath);
  for await (const chunk of stream) {
    hash.update(chunk as Buffer);
  }
  return hash.digest('hex');
}

async function run(): Promise<void> {
  const identity = await loadIdentity();
  const server = new TcpServer(identity);
  const client = new TcpClient();
  const sender = new FileSender();
  const outputDir = path.join(process.cwd(), 'demo', 'received');
  const receiver = new FileReceiver(outputDir);
  const sourcePath = path.join(process.cwd(), 'demo', 'payload-60mb.bin');

  await ensureTestFile(sourcePath, TEST_SIZE_MB);

  server.setPacketHandler(async (_socket, packet) => {
    await receiver.handlePacket(packet.type, packet.payload);
  });

  await server.start(TEST_PORT);

  const peer: Peer = {
    nodeId: 'local',
    ip: '127.0.0.1',
    tcpPort: TEST_PORT,
    lastSeen: Date.now(),
    sharedFiles: [],
    reputation: 1
  };

  try {
    const socket = await client.connect(peer);
    const manifest = await sender.sendFile(socket, sourcePath, Buffer.from(identity.sign.publicKey));
    const receivedPath = await receiver.waitForCompletion(manifest.fileId, 180000);
    client.disconnect(socket);

    const [sourceStat, receivedStat] = await Promise.all([fsp.stat(sourcePath), fsp.stat(receivedPath)]);
    const [sourceDigest, receivedDigest] = await Promise.all([fileHash(sourcePath), fileHash(receivedPath)]);

    console.log('ARCHIPEL - Test Transfer 60MB');
    console.log('-----------------------------------------');
    console.log(`Source   : ${sourcePath}`);
    console.log(`Received : ${receivedPath}`);
    console.log(`Size src : ${sourceStat.size}`);
    console.log(`Size dst : ${receivedStat.size}`);
    console.log(`SHA src  : ${sourceDigest}`);
    console.log(`SHA dst  : ${receivedDigest}`);
    console.log(`Chunks   : ${manifest.nbChunks}`);
    console.log('-----------------------------------------');

    if (sourceStat.size !== receivedStat.size || sourceDigest !== receivedDigest) {
      throw new Error('Integrity check failed on transferred file');
    }

    console.log('Transfer > 50MB OK');
    await server.stop();
    process.exit(0);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`ERREUR : ${message}`);
    await server.stop().catch(() => undefined);
    process.exit(1);
  }
}

void run();
