import { CONFIG } from '../config.js';
import { PacketType } from '../types/index.js';

export function buildPacket(type: PacketType, nodeId: Buffer, payload: Buffer): Buffer {
  const header = Buffer.alloc(41);
  CONFIG.MAGIC.copy(header, 0);
  header.writeUInt8(type, 4);
  nodeId.copy(header, 5, 0, 32);
  header.writeUInt32BE(payload.length, 37);
  return Buffer.concat([header, payload]);
}

export function parsePacket(buffer: Buffer): { type: number; nodeId: Buffer; payload: Buffer } {
  if (buffer.length < 41 || !buffer.subarray(0, 4).equals(CONFIG.MAGIC)) {
    throw new Error('Invalid packet MAGIC');
  }

  const type = buffer[4];
  const nodeId = buffer.subarray(5, 37);
  const payloadLen = buffer.readUInt32BE(37);
  const payload = buffer.subarray(41, 41 + payloadLen);

  return { type, nodeId, payload };
}
