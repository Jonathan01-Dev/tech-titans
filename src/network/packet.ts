import { CONFIG } from '../config.js';
import { PacketType } from '../types/index.js';

export function buildPacket(type: PacketType, nodeId: Buffer, payload: Buffer): Buffer {
  const header = Buffer.alloc(41);
  CONFIG.MAGIC.copy(header, 0);
  header.writeUInt8(type, 4);
  nodeId.copy(header, 5, 0, 32);
  header.writeUInt32BE(payload.length, 37);
  const signature = Buffer.alloc(32);
  return Buffer.concat([header, payload, signature]);
}

export function parsePacket(buffer: Buffer): { type: number; nodeId: Buffer; payload: Buffer; signature: Buffer } {
  if (buffer.length < 41 || !buffer.subarray(0, 4).equals(CONFIG.MAGIC)) {
    throw new Error('Invalid packet MAGIC');
  }

  const type = buffer[4];
  const nodeId = buffer.subarray(5, 37);
  const payloadLen = buffer.readUInt32BE(37);
  const payloadStart = 41;
  const payloadEnd = payloadStart + payloadLen;
  const signatureEnd = payloadEnd + 32;

  if (buffer.length < signatureEnd) {
    throw new Error('Incomplete packet payload/signature');
  }

  const payload = buffer.subarray(payloadStart, payloadEnd);
  const signature = buffer.subarray(payloadEnd, signatureEnd);

  return { type, nodeId, payload, signature };
}
