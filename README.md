# Archipel

Archipel est un protocole P2P local sans serveur central.
Le projet cible une execution hors Internet (LAN/Wi-Fi local).

## Etat du projet

- Sprint 0: valide
  - Identite cryptographique (Ed25519 + X25519)
  - Types et configuration protocole
- Sprint 1: valide
  - Discovery UDP multicast
  - Couche TCP client/serveur
  - Table des pairs
  - Format de paquet binaire
- Sprint 2: valide
  - Chiffrement AES-256-GCM
  - Derivation HKDF de session key
  - HMAC-SHA256 des paquets
  - Handshake AUTH/AUTH_OK
  - TOFU trust store
  - Chat E2E
- Sprint 3: valide
  - Chunking/reconstruction fichiers
  - Manifest (serialisation + chiffrement)
  - Download manager parallele
  - Serveur TCP etendu (CHUNK_REQ/MANIFEST/CHUNK_DATA)
  - Tests de transfert avec verification SHA-256

## Prerequis

- Windows + PowerShell
- Node.js 20+
- npm

## Installation

```powershell
cd C:\Users\DELL\Desktop\archipel
npm.cmd install
```

## Commandes de test

- Sprint 0 (identite):

```powershell
npx.cmd ts-node --esm tests/test-identity.ts
```

- Sprint 1 (reseau):

```powershell
npx.cmd ts-node --esm tests/test-network.ts
```

- Sprint 2 (crypto):

```powershell
npx.cmd ts-node --esm tests/test-crypto.ts
```

- Sprint 2 (handshake reel Alice/Bob):

Bob (server):
```powershell
npx.cmd ts-node --esm tests/test-handshake.ts --mode server
```

Alice (client):
```powershell
npx.cmd ts-node --esm tests/test-handshake.ts --mode client --peer 192.168.43.229:7777
```

- Sprint 3 (transfert simule):

```powershell
npx.cmd ts-node --esm tests/test-transfer.ts
```

- Generation fichier de demo 50 Mo:

```powershell
npx.cmd ts-node --esm demo/generate-test-file.ts
```

## Envoi/reception de fichier reel

Reception (PC2):

```powershell
npx.cmd ts-node --esm src/cli/index.ts recv --port 7778 --out demo\received
```

Envoi (PC1):

```powershell
npx.cmd ts-node --esm src/cli/index.ts send --ip 192.168.43.229 --port 7778 --file "C:\Users\DELL\Downloads\PPTX.pptx"
```

## Notes techniques

- Imports locaux en `.js` avec `ts-node --esm`.
- Les shims `.js` doivent rester dans le projet.
- Les binaires de test (`demo/*.bin`) sont ignores par Git.
