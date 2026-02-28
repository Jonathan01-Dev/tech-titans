import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import { splitFile, buildManifest, reassembleFile, computeFileHash } from '../src/transfer/chunker.js';
import { serializeManifest, deserializeManifest, encryptManifest, decryptManifest } from '../src/transfer/manifest.js';
import { DownloadManager } from '../src/transfer/downloader.js';
import { TcpServer } from '../src/network/server.js';
import { loadIdentity } from '../src/crypto/identity.js';
import type { Peer } from '../src/types/index.js';

async function ensureTestFile(filePath: string): Promise<void> {
  try {
    await fs.access(filePath);
    return;
  } catch {
    // create below
  }

  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const size = 10 * 1024 * 1024;
  const chunkSize = 1024 * 1024;
  await fs.writeFile(filePath, Buffer.alloc(0));
  for (let i = 0; i < size; i += chunkSize) {
    const remaining = Math.min(chunkSize, size - i);
    await fs.appendFile(filePath, crypto.randomBytes(remaining));
  }
}

async function run(): Promise<void> {
  const sourcePath = path.join(process.cwd(), 'demo', 'test-50mb.bin');
  const tempOutPath = path.join(process.cwd(), 'demo', 'reassembled-test.bin');
  const dlOutDir = path.join(process.cwd(), 'demo', 'downloads');

  await ensureTestFile(sourcePath);
  const identity = await loadIdentity();

  let chunkCount = 0;
  const chunkMap = new Map<number, Buffer>();
  try {
    for await (const chunk of splitFile(sourcePath)) {
      const checkHash = crypto.createHash('sha256').update(chunk.data).digest('hex');
      if (checkHash !== chunk.hash) {
        throw new Error(`Hash chunk invalide: ${chunk.index}`);
      }
      chunkMap.set(chunk.index, chunk.data);
      chunkCount += 1;
    }
    console.log(`Chunking : ${chunkCount} chunks générés - OK`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`ERREUR ETAPE 2 : ${message}`);
    process.exit(1);
  }

  let manifest: Awaited<ReturnType<typeof buildManifest>>;
  try {
    manifest = await buildManifest(sourcePath, identity.nodeId, (data) => {
      return crypto.createHash('sha256').update(data).digest();
    });

    const serialized = serializeManifest(manifest);
    const parsed = deserializeManifest(serialized);
    if (JSON.stringify(parsed) !== JSON.stringify(manifest)) {
      throw new Error('Manifest mismatch apres deserialize');
    }
    console.log('Manifest : sérialisé/désérialisé - OK');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`ERREUR ETAPE 3 : ${message}`);
    process.exit(1);
    return;
  }

  const sessionKey = crypto.randomBytes(32);
  try {
    const encrypted = encryptManifest(manifest, sessionKey);
    const decrypted = decryptManifest(encrypted, sessionKey);
    if (decrypted.fileId !== manifest.fileId) {
      throw new Error('fileId mismatch apres decrypt manifest');
    }
    console.log('Manifest chiffré : OK');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`ERREUR ETAPE 4 : ${message}`);
    process.exit(1);
  }

  let sourceHash = '';
  let rebuiltHash = '';
  try {
    await reassembleFile(tempOutPath, manifest, chunkMap);
    sourceHash = await computeFileHash(sourcePath);
    rebuiltHash = await computeFileHash(tempOutPath);
    if (sourceHash !== rebuiltHash) {
      throw new Error('Hash source != reconstruit');
    }
    console.log('Reconstruction : SHA-256 identique - OK');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`ERREUR ETAPE 5 : ${message}`);
    process.exit(1);
  }

  let downloadedPath = '';
  try {
    const server = new TcpServer(identity);
    server.setSessionKey('local', sessionKey);

    for await (const chunk of splitFile(sourcePath)) {
      server.storeChunk(manifest.fileId, chunk.index, chunk.data);
    }

    await server.start(7779);

    const peers: Peer[] = [
      {
        nodeId: 'server-node',
        ip: '127.0.0.1',
        tcpPort: 7779,
        lastSeen: Date.now(),
        sharedFiles: [],
        reputation: 1
      }
    ];
    const sessionKeys = new Map<string, Buffer>([['server-node', sessionKey]]);

    const manager = new DownloadManager(manifest, peers, sessionKeys, dlOutDir);

    const interval = setInterval(() => {
      const p = manager.getProgress();
      const percent = p.total > 0 ? ((p.downloaded / p.total) * 100).toFixed(1) : '0.0';
      console.log(`[DL] ${p.downloaded}/${p.total} chunks (${percent}%)`);
    }, 1000);

    downloadedPath = await manager.download();
    clearInterval(interval);

    await server.stop();

    const dlHash = await computeFileHash(downloadedPath);
    if (dlHash !== sourceHash) {
      throw new Error('Hash final transfert invalide');
    }
    rebuiltHash = dlHash;
    console.log('Transfert simulé : SHA-256 validé - OK');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`ERREUR ETAPE 6 : ${message}`);
    process.exit(1);
  }

  console.log('ARCHIPEL - Test Transfer Sprint 3');
  console.log('-----------------------------------------');
  console.log(`Chunking          : ${chunkCount} chunks générés - OK`);
  console.log('Manifest          : sérialisé/désérialisé - OK');
  console.log('Manifest chiffré  : OK');
  console.log('Reconstruction    : SHA-256 identique - OK');
  console.log('Transfert simulé  : SHA-256 validé - OK');
  console.log('-----------------------------------------');
  console.log(`Fichier source      : ${sourceHash}`);
  console.log(`Fichier reconstruit : ${rebuiltHash}`);
  console.log(`Identiques          : ${sourceHash === rebuiltHash ? 'OUI' : 'NON'}`);
  console.log('-----------------------------------------');
  console.log('Tous les tests transfert passent - Sprint 3 OK');
  void downloadedPath;
}

void run();
