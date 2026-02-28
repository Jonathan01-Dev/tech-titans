import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import crypto from 'crypto';
import { CONFIG } from '../config.js';
import type { Chunk, FileManifest } from '../types/index.js';

export async function* splitFile(filepath: string): AsyncGenerator<Chunk> {
  await fs.access(filepath);

  const stream = fsSync.createReadStream(filepath, { highWaterMark: CONFIG.CHUNK_SIZE });
  let index = 0;
  let total = 0;

  try {
    for await (const part of stream) {
      const data = Buffer.from(part as Buffer);
      const hash = crypto.createHash('sha256').update(data).digest('hex');
      const chunk: Chunk = { index, data, hash, size: data.length };
      yield chunk;
      total += 1;
      index += 1;
    }
  } finally {
    console.log(`[Chunker] Chunks generes: ${total}`);
  }
}

export async function computeFileHash(filepath: string): Promise<string> {
  await fs.access(filepath);

  return new Promise<string>((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fsSync.createReadStream(filepath);

    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

export async function buildManifest(
  filepath: string,
  senderId: string,
  sign: (data: Buffer) => Buffer,
  filenameOverride?: string
): Promise<FileManifest> {
  const stats = await fs.stat(filepath);
  const fileId = await computeFileHash(filepath);
  const chunks: Array<{ index: number; hash: string; size: number }> = [];

  for await (const chunk of splitFile(filepath)) {
    chunks.push({ index: chunk.index, hash: chunk.hash, size: chunk.size });
  }

  const unsignedManifest = {
    fileId,
    filename: path.basename(filepath),
    size: stats.size,
    chunkSize: CONFIG.CHUNK_SIZE,
    nbChunks: chunks.length,
    chunks,
    senderId
  };

  const manifestHash = crypto.createHash('sha256').update(Buffer.from(JSON.stringify(unsignedManifest), 'utf8')).digest();
  const signature = sign(manifestHash).toString('hex');

  const manifest: FileManifest = {
    ...unsignedManifest,
    filename: filenameOverride ? path.basename(filenameOverride) : unsignedManifest.filename,
    signature
  };

  return manifest;
}

export async function reassembleFile(
  outputPath: string,
  manifest: FileManifest,
  chunksMap: Map<number, Buffer>
): Promise<void> {
  if (chunksMap.size !== manifest.nbChunks) {
    throw new Error('Chunks manquants');
  }

  const outputDir = path.dirname(outputPath);
  await fs.mkdir(outputDir, { recursive: true });
  const partPath = path.join(outputDir, `${path.basename(outputPath)}.part`);

  await new Promise<void>((resolve, reject) => {
    const writer = fsSync.createWriteStream(partPath, { flags: 'w' });
    writer.on('error', reject);

    (async () => {
      for (let i = 0; i < manifest.nbChunks; i += 1) {
        const chunk = chunksMap.get(i);
        if (!chunk) {
          throw new Error('Chunks manquants');
        }

        const expected = manifest.chunks[i];
        const actualHash = crypto.createHash('sha256').update(chunk).digest('hex');
        if (actualHash !== expected.hash) {
          throw new Error('Hash invalide pour chunk ' + i);
        }

        await new Promise<void>((res, rej) => {
          writer.write(chunk, (err) => {
            if (err) {
              rej(err);
              return;
            }
            res();
          });
        });
      }

      writer.end(() => resolve());
    })().catch((error) => {
      writer.destroy();
      reject(error as Error);
    });
  });

  const rebuiltHash = await computeFileHash(partPath);
  if (rebuiltHash !== manifest.fileId) {
    throw new Error('Hash global invalide');
  }

  await fs.rename(partPath, outputPath);
  console.log(`[Chunker] Fichier reconstruit : ${outputPath}`);
}
