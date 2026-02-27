import { PacketType } from './types/index.js';

export const CONFIG = {
  MULTICAST_ADDR: '239.255.42.99',
  MULTICAST_PORT: 6000,
  TCP_PORT: Number(process.env.TCP_PORT) || 7777,
  HELLO_INTERVAL: 30000,
  PEER_TIMEOUT: 90000,
  KEEPALIVE_INTERVAL: 15000,
  CHUNK_SIZE: 524288,
  TYPES: PacketType,
  MAGIC: Buffer.from('ARCH'),
  PROTOCOL_VERSION: 'archipel-v1'
} as const;