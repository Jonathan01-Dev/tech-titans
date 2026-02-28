import crypto from 'crypto';
import { encrypt, decrypt, deriveSessionKey } from '../src/crypto/cipher.js';
import { signPacket, verifyPacket, deriveHmacKey } from '../src/crypto/hmac.js';
import { trustPeer, isPeerTrusted, revokePeer } from '../src/crypto/trust.js';
import { loadIdentity, getPublicIdentity, generateIdentity } from '../src/crypto/identity.js';
import { buildPacket } from '../src/network/packet.js';
import { PacketType } from '../src/types/index.js';
import { ChatSession } from '../src/messaging/chat.js';
import type { Peer } from '../src/types/index.js';

async function run(): Promise<void> {
  const status: Record<string, 'OK'> = {};

  try {
    const sessionKey = crypto.randomBytes(32);
    const plaintext = Buffer.from('Message secret Archipel', 'utf8');
    const enc1 = encrypt(sessionKey, plaintext);
    const dec1 = decrypt(sessionKey, enc1);
    const enc2 = encrypt(sessionKey, plaintext);

    if (!dec1.equals(plaintext)) {
      throw new Error('plaintext mismatch after decrypt');
    }
    if (enc1.nonce.length !== 12) {
      throw new Error('nonce length must be 12');
    }
    if (enc1.tag.length !== 16) {
      throw new Error('auth tag length must be 16');
    }
    if (enc1.ciphertext.equals(enc2.ciphertext)) {
      throw new Error('ciphertexts should differ with different nonces');
    }
    status['TEST 1 - AES-256-GCM'] = 'OK';
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`ERREUR TEST 1 : ${message}`);
    process.exit(1);
  }

  let hkdfSessionKey = Buffer.alloc(0);
  try {
    const sharedSecret = crypto.randomBytes(32);
    const key1 = deriveSessionKey(sharedSecret);
    const key2 = deriveSessionKey(sharedSecret);
    if (key1.length !== 32) {
      throw new Error('derived key is not 32 bytes');
    }
    if (!key1.equals(key2)) {
      throw new Error('HKDF not deterministic for same input');
    }
    hkdfSessionKey = key1;
    status['TEST 2 - HKDF'] = 'OK';
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`ERREUR TEST 2 : ${message}`);
    process.exit(1);
  }

  try {
    const hmacKey = deriveHmacKey(hkdfSessionKey);
    const packet = Buffer.from('test packet', 'utf8');
    const signed = signPacket(packet, hmacKey);
    const verified = verifyPacket(signed, hmacKey);
    if (!verified.equals(packet)) {
      throw new Error('verified packet mismatch');
    }

    const tampered = Buffer.from(signed);
    tampered[0] = tampered[0] ^ 0xff;
    let tamperRejected = false;
    try {
      verifyPacket(tampered, hmacKey);
    } catch {
      tamperRejected = true;
    }
    if (!tamperRejected) {
      throw new Error('tampered packet was accepted');
    }
    status['TEST 3 - HMAC'] = 'OK';
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`ERREUR TEST 3 : ${message}`);
    process.exit(1);
  }

  try {
    const identity = await loadIdentity();
    const pub = getPublicIdentity(identity);
    await trustPeer(pub);
    const trustedAfterAdd = await isPeerTrusted(pub.nodeId);
    if (!trustedAfterAdd) {
      throw new Error('peer should be trusted after trustPeer');
    }

    await revokePeer(pub.nodeId);
    const trustedAfterRevoke = await isPeerTrusted(pub.nodeId);
    if (trustedAfterRevoke) {
      throw new Error('peer should not be trusted after revokePeer');
    }
    status['TEST 4 - TOFU Trust'] = 'OK';
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`ERREUR TEST 4 : ${message}`);
    process.exit(1);
  }

  try {
    const alice = await generateIdentity();
    const bob = await generateIdentity();
    const sharedSecret = crypto.randomBytes(32);
    const sessionKey = deriveSessionKey(sharedSecret);
    const hmacKey = deriveHmacKey(sessionKey);
    const aliceChat = new ChatSession(alice, sessionKey);
    const bobChat = new ChatSession(bob, sessionKey);

    const msgAlice = 'Salut Bob, message E2E';
    const payloadAlice = encrypt(sessionKey, Buffer.from(msgAlice, 'utf8'));
    const packetAlice = buildPacket(
      PacketType.MSG,
      Buffer.from(alice.sign.publicKey),
      Buffer.from(
        JSON.stringify({
          nonce: payloadAlice.nonce.toString('hex'),
          ciphertext: payloadAlice.ciphertext.toString('hex'),
          tag: payloadAlice.tag.toString('hex')
        }),
        'utf8'
      )
    );
    const signedAlice = signPacket(packetAlice, hmacKey);
    const receivedByBob = bobChat.receiveMessage(signedAlice);
    if (receivedByBob !== msgAlice) {
      throw new Error('Bob did not recover Alice message');
    }

    const msgBob = 'Salut Alice, recu cinq sur cinq';
    const payloadBob = encrypt(sessionKey, Buffer.from(msgBob, 'utf8'));
    const packetBob = buildPacket(
      PacketType.MSG,
      Buffer.from(bob.sign.publicKey),
      Buffer.from(
        JSON.stringify({
          nonce: payloadBob.nonce.toString('hex'),
          ciphertext: payloadBob.ciphertext.toString('hex'),
          tag: payloadBob.tag.toString('hex')
        }),
        'utf8'
      )
    );
    const signedBob = signPacket(packetBob, hmacKey);
    const receivedByAlice = aliceChat.receiveMessage(signedBob);
    if (receivedByAlice !== msgBob) {
      throw new Error('Alice did not recover Bob message');
    }

    const peerDummy: Peer = {
      nodeId: bob.nodeId,
      ip: '127.0.0.1',
      tcpPort: 7777,
      lastSeen: Date.now(),
      sharedFiles: [],
      reputation: 1
    };
    void peerDummy;
    status['TEST 5 - Integration E2E'] = 'OK';
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`ERREUR TEST 5 : ${message}`);
    process.exit(1);
  }

  console.log('ARCHIPEL - Test Crypto Sprint 2');
  console.log('-----------------------------------------');
  console.log(`TEST 1 - AES-256-GCM        : ${status['TEST 1 - AES-256-GCM']}`);
  console.log(`TEST 2 - HKDF               : ${status['TEST 2 - HKDF']}`);
  console.log(`TEST 3 - HMAC               : ${status['TEST 3 - HMAC']}`);
  console.log(`TEST 4 - TOFU Trust         : ${status['TEST 4 - TOFU Trust']}`);
  console.log(`TEST 5 - Integration E2E    : ${status['TEST 5 - Integration E2E']}`);
  console.log('-----------------------------------------');
  console.log('Tous les tests crypto passent - Sprint 2 OK');
}

void run();
