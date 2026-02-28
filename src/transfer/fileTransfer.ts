import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import net from 'net';
import { CONFIG } from '../config.js';
import { buildPacket } from '../network/packet.js';
import { PacketType } from '../types/index.js';

interface ManifestPayload {
  fileId: string;
  filename: string;
  size: number;
  chunkSize: number;
  nbChunks: number;
  senderId: string;
  signature: string;
}

interface ChunkMeta {
  fileId: string;
  index: number;
  size: number;
  hash: string;
}

interface ReceiveSession {
  manifest: ManifestPayload;
  tempPath: string;
  finalPath: string;
  stream: fs.WriteStream;
  receivedChunks: number;
}

function sha256(buffer: Buffer): string {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function buildFileId(filePath: string, size: number): string {
  const seed = `${filePath}:${size}:${Date.now()}:${Math.random()}`;
  return crypto.createHash('sha256').update(seed).digest('hex');
}

async function writePacket(socket: net.Socket, packet: Buffer): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    socket.write(packet, (err) => {
      if (err) {
        reject(err);
        return;
      }
      resolve();
    });
  });
}

function encodeChunkPayload(meta: ChunkMeta, chunk: Buffer): Buffer {
  const metaBuffer = Buffer.from(JSON.stringify(meta), 'utf8');
  const metaLen = Buffer.alloc(4);
  metaLen.writeUInt32BE(metaBuffer.length, 0);
  return Buffer.concat([metaLen, metaBuffer, chunk]);
}

function decodeChunkPayload(payload: Buffer): { meta: ChunkMeta; chunk: Buffer } {
  const metaLen = payload.readUInt32BE(0);
  const metaBuffer = payload.subarray(4, 4 + metaLen);
  const chunk = payload.subarray(4 + metaLen);
  const meta = JSON.parse(metaBuffer.toString('utf8')) as ChunkMeta;
  return { meta, chunk };
}

export class FileSender {
  async sendFile(socket: net.Socket, filePath: string, nodeId: Buffer): Promise<ManifestPayload> {
    const absolutePath = path.resolve(filePath);
    const stat = await fsp.stat(absolutePath);

    if (!stat.isFile()) {
      throw new Error('Path is not a file');
    }

    const chunkSize = CONFIG.CHUNK_SIZE;
    const nbChunks = Math.ceil(stat.size / chunkSize);
    const fileId = buildFileId(absolutePath, stat.size);
    const manifest: ManifestPayload = {
      fileId,
      filename: path.basename(absolutePath),
      size: stat.size,
      chunkSize,
      nbChunks,
      senderId: nodeId.toString('hex'),
      signature: ''
    };

    const manifestPacket = buildPacket(
      PacketType.MANIFEST,
      nodeId,
      Buffer.from(JSON.stringify(manifest), 'utf8')
    );
    await writePacket(socket, manifestPacket);

    let index = 0;
    const stream = fs.createReadStream(absolutePath, { highWaterMark: chunkSize });
    for await (const part of stream) {
      const chunk = Buffer.from(part as Buffer);
      const meta: ChunkMeta = {
        fileId,
        index,
        size: chunk.length,
        hash: sha256(chunk)
      };
      const payload = encodeChunkPayload(meta, chunk);
      const pkt = buildPacket(PacketType.CHUNK_DATA, nodeId, payload);
      await writePacket(socket, pkt);
      index += 1;
    }

    return manifest;
  }
}

export class FileReceiver {
  private outputDir: string;
  private sessions: Map<string, ReceiveSession>;
  private completions: Map<string, { resolve: (filePath: string) => void; reject: (error: Error) => void }>;

  constructor(outputDir: string) {
    this.outputDir = outputDir;
    this.sessions = new Map();
    this.completions = new Map();
  }

  waitForCompletion(fileId: string, timeoutMs = 120000): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      this.completions.set(fileId, { resolve, reject });
      setTimeout(() => {
        if (this.completions.has(fileId)) {
          this.completions.delete(fileId);
          reject(new Error(`Transfer timeout for ${fileId}`));
        }
      }, timeoutMs);
    });
  }

  async handlePacket(type: number, payload: Buffer): Promise<void> {
    if (type === PacketType.MANIFEST) {
      await this.handleManifest(payload);
      return;
    }

    if (type === PacketType.CHUNK_DATA) {
      await this.handleChunk(payload);
    }
  }

  private async handleManifest(payload: Buffer): Promise<void> {
    const manifest = JSON.parse(payload.toString('utf8')) as ManifestPayload;
    await fsp.mkdir(this.outputDir, { recursive: true });

    const tempPath = path.join(this.outputDir, `${manifest.fileId}.part`);
    const finalPath = path.join(this.outputDir, manifest.filename);
    const stream = fs.createWriteStream(tempPath, { flags: 'w' });

    this.sessions.set(manifest.fileId, {
      manifest,
      tempPath,
      finalPath,
      stream,
      receivedChunks: 0
    });
  }

  private async handleChunk(payload: Buffer): Promise<void> {
    const { meta, chunk } = decodeChunkPayload(payload);
    const session = this.sessions.get(meta.fileId);

    if (!session) {
      return;
    }

    if (sha256(chunk) !== meta.hash) {
      const completion = this.completions.get(meta.fileId);
      if (completion) {
        completion.reject(new Error(`Chunk hash mismatch for ${meta.fileId}:${meta.index}`));
        this.completions.delete(meta.fileId);
      }
      return;
    }

    await new Promise<void>((resolve, reject) => {
      session.stream.write(chunk, (err) => {
        if (err) {
          reject(err);
          return;
        }
        resolve();
      });
    });

    session.receivedChunks += 1;

    if (session.receivedChunks >= session.manifest.nbChunks) {
      await new Promise<void>((resolve) => session.stream.end(() => resolve()));
      await fsp.rename(session.tempPath, session.finalPath);
      this.sessions.delete(meta.fileId);

      const completion = this.completions.get(meta.fileId);
      if (completion) {
        completion.resolve(session.finalPath);
        this.completions.delete(meta.fileId);
      }
    }
  }
}
