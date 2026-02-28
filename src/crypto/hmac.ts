import crypto from 'crypto';

export function deriveHmacKey(sessionKey: Buffer): Buffer {
  const key = crypto.hkdfSync('sha256', sessionKey, Buffer.alloc(32), Buffer.from('archipel-hmac-v1'), 32);
  return Buffer.from(key);
}

export function signPacket(packet: Buffer, hmacKey: Buffer): Buffer {
  const mac = crypto.createHmac('sha256', hmacKey).update(packet).digest();
  return Buffer.concat([packet, mac]);
}

export function verifyPacket(signedPacket: Buffer, hmacKey: Buffer): Buffer {
  if (signedPacket.length < 32) {
    throw new Error('HMAC verification failed');
  }

  const packet = signedPacket.subarray(0, signedPacket.length - 32);
  const mac = signedPacket.subarray(signedPacket.length - 32);
  const expected = crypto.createHmac('sha256', hmacKey).update(packet).digest();

  if (mac.length !== expected.length || !crypto.timingSafeEqual(mac, expected)) {
    throw new Error('HMAC verification failed');
  }

  return packet;
}
