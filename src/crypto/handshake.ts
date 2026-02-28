import sodium from 'libsodium-wrappers';
import crypto from 'crypto';
import net from 'net';
import type { Identity } from '../types/index.js';
import { deriveSessionKey } from './cipher.js';
import { buildPacket, parsePacket } from '../network/packet.js';
import { PacketType } from '../types/index.js';

type ParsedPacket = ReturnType<typeof parsePacket>;

interface PacketReader {
  readNext(step: string, timeoutMs?: number): Promise<ParsedPacket>;
  close(): void;
}

function createPacketReader(socket: net.Socket): PacketReader {
  let buffer = Buffer.alloc(0);
  const queue: ParsedPacket[] = [];
  const waiters: Array<{ resolve: (pkt: ParsedPacket) => void; reject: (error: Error) => void }> = [];

  const onData = (chunk: Buffer): void => {
    buffer = Buffer.concat([buffer, chunk]);

    while (buffer.length >= 73) {
      const payloadLen = buffer.readUInt32BE(37);
      const packetLen = 41 + payloadLen + 32;
      if (buffer.length < packetLen) {
        break;
      }

      const pkt = parsePacket(buffer.subarray(0, packetLen));
      buffer = buffer.subarray(packetLen);

      const waiter = waiters.shift();
      if (waiter) {
        waiter.resolve(pkt);
      } else {
        queue.push(pkt);
      }
    }
  };

  const onError = (error: Error): void => {
    while (waiters.length > 0) {
      const waiter = waiters.shift();
      if (waiter) {
        waiter.reject(error);
      }
    }
  };

  socket.on('data', onData);
  socket.on('error', onError);

  return {
    readNext(step: string, timeoutMs = 10000): Promise<ParsedPacket> {
      if (queue.length > 0) {
        const pkt = queue.shift();
        if (!pkt) {
          throw new Error(`Handshake internal queue error at ${step}`);
        }
        return Promise.resolve(pkt);
      }

      return new Promise<ParsedPacket>((resolve, reject) => {
        const timer = setTimeout(() => {
          reject(new Error(`Handshake timeout at ${step}`));
        }, timeoutMs);

        waiters.push({
          resolve: (pkt) => {
            clearTimeout(timer);
            resolve(pkt);
          },
          reject: (error) => {
            clearTimeout(timer);
            reject(error);
          }
        });
      });
    },
    close(): void {
      socket.off('data', onData);
      socket.off('error', onError);
      while (waiters.length > 0) {
        const waiter = waiters.shift();
        if (waiter) {
          waiter.reject(new Error('Handshake reader closed'));
        }
      }
    }
  };
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

function verifySignature(signatureHex: string, message: Buffer, signerNodeIdHex: string): boolean {
  const signature = Buffer.from(signatureHex, 'hex');
  const signerPublicKey = Buffer.from(signerNodeIdHex, 'hex');
  return sodium.crypto_sign_verify_detached(signature, message, signerPublicKey);
}

function signShared(shared: Buffer, privateKey: Uint8Array): string {
  const digest = crypto.createHash('sha256').update(shared).digest();
  const signature = sodium.crypto_sign_detached(digest, privateKey);
  return Buffer.from(signature).toString('hex');
}

export async function performHandshake(
  socket: net.Socket,
  myIdentity: Identity,
  isInitiator: boolean
): Promise<Buffer> {
  const result = await performHandshakeDetailed(socket, myIdentity, isInitiator);
  return result.sessionKey;
}

export async function performHandshakeDetailed(
  socket: net.Socket,
  myIdentity: Identity,
  isInitiator: boolean
): Promise<{ sessionKey: Buffer; peerNodeId: string }> {
  await sodium.ready;
  const reader = createPacketReader(socket);

  try {
    const myNodeIdBuffer = Buffer.from(myIdentity.sign.publicKey);

    if (isInitiator) {
      const ephemeral = sodium.crypto_kx_keypair();
      const helloPayload = Buffer.from(
        JSON.stringify({
          e_pub: Buffer.from(ephemeral.publicKey).toString('hex'),
          timestamp: Date.now(),
          node_id: myIdentity.nodeId
        }),
        'utf8'
      );
      await writePacket(socket, buildPacket(PacketType.HELLO, myNodeIdBuffer, helloPayload));

      const helloReply = await reader.readNext('HELLO_REPLY');
      if (helloReply.type !== PacketType.HELLO) {
        throw new Error(`Unexpected packet type ${helloReply.type} at HELLO_REPLY`);
      }

      const helloReplyPayload = JSON.parse(helloReply.payload.toString('utf8')) as {
        e_pub: string;
        signature: string;
        node_id: string;
      };

      const shared = computeSharedSecret(ephemeral.privateKey, Buffer.from(helloReplyPayload.e_pub, 'hex'));
      const sharedDigest = crypto.createHash('sha256').update(shared).digest();

      if (!verifySignature(helloReplyPayload.signature, sharedDigest, helloReplyPayload.node_id)) {
        throw new Error('Invalid peer signature');
      }

      const authPayload = Buffer.from(
        JSON.stringify({
          signature: signShared(shared, myIdentity.sign.privateKey),
          node_id: myIdentity.nodeId
        }),
        'utf8'
      );
      await writePacket(socket, buildPacket(PacketType.AUTH, myNodeIdBuffer, authPayload));

      const authOk = await reader.readNext('AUTH_OK');
      if (authOk.type !== PacketType.AUTH_OK) {
        throw new Error(`Unexpected packet type ${authOk.type} at AUTH_OK`);
      }

      return {
        sessionKey: deriveSessionKey(shared),
        peerNodeId: helloReplyPayload.node_id
      };
    }

    const hello = await reader.readNext('HELLO');
    if (hello.type !== PacketType.HELLO) {
      throw new Error(`Unexpected packet type ${hello.type} at HELLO`);
    }

    const helloPayload = JSON.parse(hello.payload.toString('utf8')) as { e_pub: string; node_id: string; timestamp: number };
    const ephemeral = sodium.crypto_kx_keypair();
    const shared = computeSharedSecret(ephemeral.privateKey, Buffer.from(helloPayload.e_pub, 'hex'));
    const sharedDigest = crypto.createHash('sha256').update(shared).digest();

    const helloReplyPayload = Buffer.from(
      JSON.stringify({
        e_pub: Buffer.from(ephemeral.publicKey).toString('hex'),
        signature: signShared(shared, myIdentity.sign.privateKey),
        node_id: myIdentity.nodeId
      }),
      'utf8'
    );
    await writePacket(socket, buildPacket(PacketType.HELLO, myNodeIdBuffer, helloReplyPayload));

    const auth = await reader.readNext('AUTH');
    if (auth.type !== PacketType.AUTH) {
      throw new Error(`Unexpected packet type ${auth.type} at AUTH`);
    }

    const authPayload = JSON.parse(auth.payload.toString('utf8')) as { signature: string; node_id: string };
    if (!verifySignature(authPayload.signature, sharedDigest, authPayload.node_id)) {
      throw new Error('Invalid peer signature');
    }

    const authOkPayload = Buffer.from(JSON.stringify({ ok: true, timestamp: Date.now() }), 'utf8');
    await writePacket(socket, buildPacket(PacketType.AUTH_OK, myNodeIdBuffer, authOkPayload));

    return {
      sessionKey: deriveSessionKey(shared),
      peerNodeId: authPayload.node_id
    };
  } finally {
    reader.close();
  }
}

export function computeSharedSecret(myPrivateKey: Uint8Array, theirPublicKey: Uint8Array): Buffer {
  return Buffer.from(sodium.crypto_scalarmult(myPrivateKey, theirPublicKey));
}
