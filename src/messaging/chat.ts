import net from 'net';
import type { Identity, Peer } from '../types/index.js';
import { encrypt, decrypt } from '../crypto/cipher.js';
import { signPacket, verifyPacket, deriveHmacKey } from '../crypto/hmac.js';
import { buildPacket, parsePacket } from '../network/packet.js';
import { PacketType } from '../types/index.js';
import { TcpClient } from '../network/client.js';

export class ChatSession {
  private sessionKey: Buffer;
  private hmacKey: Buffer;
  private identity: Identity;
  private socket: net.Socket | null;

  constructor(identity: Identity, sessionKey: Buffer) {
    this.identity = identity;
    this.sessionKey = sessionKey;
    this.hmacKey = deriveHmacKey(sessionKey);
    this.socket = null;
  }

  async sendMessage(peer: Peer, message: string): Promise<void> {
    const encrypted = encrypt(this.sessionKey, Buffer.from(message, 'utf-8'));
    const payload = Buffer.from(
      JSON.stringify({
        nonce: encrypted.nonce.toString('hex'),
        ciphertext: encrypted.ciphertext.toString('hex'),
        tag: encrypted.tag.toString('hex')
      }),
      'utf8'
    );

    const packet = buildPacket(PacketType.MSG, Buffer.from(this.identity.sign.publicKey), payload);
    const signedPacket = signPacket(packet, this.hmacKey);

    const client = new TcpClient();
    this.socket = await client.connect(peer);
    try {
      await client.sendPacket(this.socket, signedPacket);
      console.log(`[Chat] Message chiffre envoye a ${peer.nodeId.slice(0, 16)}...`);
    } finally {
      await client.disconnectGraceful(this.socket).catch(() => undefined);
      this.socket = null;
    }
  }

  receiveMessage(signedPacket: Buffer): string {
    const packet = verifyPacket(signedPacket, this.hmacKey);
    const parsed = parsePacket(packet);
    const payload = JSON.parse(parsed.payload.toString('utf8')) as {
      nonce: string;
      ciphertext: string;
      tag: string;
    };

    const plaintext = decrypt(this.sessionKey, {
      nonce: Buffer.from(payload.nonce, 'hex'),
      ciphertext: Buffer.from(payload.ciphertext, 'hex'),
      tag: Buffer.from(payload.tag, 'hex')
    });

    console.log('[Chat] Message recu et dechiffre');
    return plaintext.toString('utf-8');
  }
}
