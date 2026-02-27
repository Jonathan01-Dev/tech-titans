// Identité cryptographique d'un noeud
export interface KeyPair {
  publicKey: Uint8Array;
  privateKey: Uint8Array;
}

export interface Identity {
  nodeId: string;         // Ed25519 pubkey en hex (64 chars)
  fingerprint: string;    // SHA-256 des deux pubkeys en hex
  sign: KeyPair;          // Paire Ed25519
  kx: KeyPair;            // Paire X25519
  createdAt: number;      // timestamp Date.now()
}

export interface PublicIdentity {
  nodeId: string;
  fingerprint: string;
  signPublicKey: string;  // hex
  kxPublicKey: string;    // hex
}

// Pair sur le réseau
export interface Peer {
  nodeId: string;
  ip: string;
  tcpPort: number;
  lastSeen: number;
  sharedFiles: string[];
  reputation: number;
  publicIdentity?: PublicIdentity;
}

// Format paquet Archipel
export interface Packet {
  magic: Buffer;
  type: number;
  nodeId: Buffer;
  payload: Buffer;
  signature?: Buffer;
}

// Types de paquets
export enum PacketType {
  HELLO      = 0x01,
  PEER_LIST  = 0x02,
  MSG        = 0x03,
  CHUNK_REQ  = 0x04,
  CHUNK_DATA = 0x05,
  MANIFEST   = 0x06,
  ACK        = 0x07
}

// Chunk de fichier
export interface Chunk {
  index: number;
  data: Buffer;
  hash: string;
  size: number;
}

// Manifest de fichier
export interface FileManifest {
  fileId: string;
  filename: string;
  size: number;
  chunkSize: number;
  nbChunks: number;
  chunks: Array<{ index: number; hash: string; size: number }>;
  senderId: string;
  signature: string;
}

// Résultat chiffrement AES-GCM
export interface EncryptedPayload {
  nonce: Buffer;      // 12 bytes
  ciphertext: Buffer;
  tag: Buffer;        // 16 bytes
}