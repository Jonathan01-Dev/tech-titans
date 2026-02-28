import net from 'net';
import { loadIdentity } from '../src/crypto/identity.js';
import { performHandshake } from '../src/crypto/handshake.js';
import { decrypt, encrypt } from '../src/crypto/cipher.js';
import { deriveHmacKey, signPacket, verifyPacket } from '../src/crypto/hmac.js';
import { buildPacket, parsePacket } from '../src/network/packet.js';
import { TcpClient } from '../src/network/client.js';
import { TcpServer } from '../src/network/server.js';
import { PacketType } from '../src/types/index.js';
import type { Peer } from '../src/types/index.js';

type Mode = 'server' | 'client';

function getArg(name: string): string | undefined {
  const idx = process.argv.indexOf(name);
  if (idx < 0) {
    return undefined;
  }
  return process.argv[idx + 1];
}

function parseMode(): Mode {
  const mode = getArg('--mode');
  if (mode === 'server' || mode === 'client') {
    return mode;
  }
  throw new Error('Missing or invalid --mode (server|client)');
}

function parsePeer(): { ip: string; port: number } {
  const peer = getArg('--peer');
  if (!peer) {
    throw new Error('Missing --peer ip:port in client mode');
  }

  const [ip, portRaw] = peer.split(':');
  const port = Number(portRaw);
  if (!ip || !Number.isInteger(port) || port <= 0) {
    throw new Error('Invalid --peer format, expected ip:port');
  }

  return { ip, port };
}

function readSignedPacket(socket: net.Socket, timeoutMs = 15000): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    let buffer = Buffer.alloc(0);

    const cleanup = (): void => {
      clearTimeout(timer);
      socket.off('data', onData);
      socket.off('error', onError);
      socket.off('close', onClose);
    };

    const onData = (chunk: Buffer): void => {
      buffer = Buffer.concat([buffer, chunk]);

      while (buffer.length >= 73) {
        const payloadLen = buffer.readUInt32BE(37);
        const packetLen = 41 + payloadLen + 32;
        const signedLen = packetLen + 32;

        if (buffer.length < signedLen) {
          return;
        }

        const signedPacket = buffer.subarray(0, signedLen);
        buffer = buffer.subarray(signedLen);
        cleanup();
        resolve(signedPacket);
        return;
      }
    };

    const onError = (error: Error): void => {
      cleanup();
      reject(error);
    };

    const onClose = (): void => {
      cleanup();
      reject(new Error('Socket closed before receiving signed packet'));
    };

    const timer = setTimeout(() => {
      cleanup();
      reject(new Error('Timeout while waiting for signed MSG packet'));
    }, timeoutMs);

    socket.on('data', onData);
    socket.on('error', onError);
    socket.on('close', onClose);
  });
}

async function runServer(): Promise<void> {
  const identity = await loadIdentity();
  const port = Number(process.env.TCP_PORT ?? '7777');
  const server = new TcpServer(identity);

  const socketPromise = new Promise<net.Socket>((resolve) => {
    server.setRawConnectionHandler((socket) => {
      resolve(socket);
    });
  });

  await server.start(port);
  const socket = await socketPromise;

  try {
    const sessionKey = await performHandshake(socket, identity, false);
    const hmacKey = deriveHmacKey(sessionKey);
    const signedPacket = await readSignedPacket(socket);
    const rawPacket = verifyPacket(signedPacket, hmacKey);
    const parsed = parsePacket(rawPacket);

    if (parsed.type !== PacketType.MSG) {
      throw new Error(`Unexpected packet type ${parsed.type}, expected MSG`);
    }

    const payload = JSON.parse(parsed.payload.toString('utf8')) as {
      nonce: string;
      ciphertext: string;
      tag: string;
    };

    const clear = decrypt(sessionKey, {
      nonce: Buffer.from(payload.nonce, 'hex'),
      ciphertext: Buffer.from(payload.ciphertext, 'hex'),
      tag: Buffer.from(payload.tag, 'hex')
    });

    console.log('[Bob] Handshake reussi');
    console.log(`[Bob] Session key: ${sessionKey.toString('hex').slice(0, 32)}...`);
    console.log(`[Bob] Message recu: ${clear.toString('utf8')}`);
    console.log('[Bob] SPRINT 2 VALIDE');
  } finally {
    socket.destroy();
    await server.stop().catch(() => undefined);
  }
}

async function runClient(): Promise<void> {
  const identity = await loadIdentity();
  const { ip, port } = parsePeer();
  const client = new TcpClient();
  const peer: Peer = {
    nodeId: 'bob',
    ip,
    tcpPort: port,
    lastSeen: Date.now(),
    sharedFiles: [],
    reputation: 1
  };

  const socket = await client.connect(peer);
  try {
    const sessionKey = await performHandshake(socket, identity, true);
    const hmacKey = deriveHmacKey(sessionKey);

    const encrypted = encrypt(sessionKey, Buffer.from('Bonjour depuis Archipel !', 'utf8'));
    const payload = Buffer.from(
      JSON.stringify({
        nonce: encrypted.nonce.toString('hex'),
        ciphertext: encrypted.ciphertext.toString('hex'),
        tag: encrypted.tag.toString('hex')
      }),
      'utf8'
    );

    const packet = buildPacket(PacketType.MSG, Buffer.from(identity.sign.publicKey), payload);
    const signedPacket = signPacket(packet, hmacKey);
    await client.sendPacket(socket, signedPacket);

    console.log('[Alice] Handshake reussi');
    console.log(`[Alice] Session key: ${sessionKey.toString('hex').slice(0, 32)}...`);
    console.log('[Alice] Message chiffre envoye');
    console.log('[Alice] SPRINT 2 VALIDE');
  } finally {
    await client.disconnectGraceful(socket).catch(() => undefined);
  }
}

async function main(): Promise<void> {
  const mode = parseMode();
  if (mode === 'server') {
    await runServer();
    return;
  }
  await runClient();
}

void main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`ERREUR : ${message}`);
  process.exit(1);
});
