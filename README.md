# Archipel

Protocole de communication P2P local, sans serveur central, conçu pour fonctionner hors Internet.

## Etat du projet

- Sprint 0: valide
  - Identite cryptographique (`Ed25519` + `X25519`)
  - Types et configuration globale
- Sprint 1: implemente
  - Format de paquet binaire
  - Table des pairs avec expiration
  - Discovery UDP multicast
  - Serveur TCP
  - Client TCP
  - Test reseau de base

## Prerequis

- Windows + PowerShell
- Node.js 20+
- npm

## Installation

```powershell
cd C:\Users\DELL\Desktop\archipel
npm.cmd install
```

## Scripts utiles

- Test identite:

```powershell
npx.cmd ts-node --esm tests/test-identity.ts
```

- Test reseau Sprint 1:

```powershell
npx.cmd ts-node --esm tests/test-network.ts
```

## Test discovery sur 2 machines

Conditions:
- Les 2 machines doivent etre sur le meme LAN/Wi-Fi
- Le pare-feu Windows doit autoriser `node.exe` sur reseau prive
- UDP `6000` et ports TCP utilises (ex: `7777`, `7778`) doivent etre autorises

Machine A:

```powershell
cd C:\Users\DELL\Desktop\archipel
$env:TCP_PORT=7777
npx.cmd ts-node --esm tests/test-network.ts
```

Machine B:

```powershell
cd C:\Users\DELL\Desktop\archipel
$env:TCP_PORT=7778
npx.cmd ts-node --esm tests/test-network.ts
```

Resultat attendu:
- Chaque machine detecte l'autre dans la sortie `Pairs decouverts`.

## Structure (Sprint 1)

- `src/network/packet.ts`: construction / parsing du paquet Archipel
- `src/network/peerTable.ts`: gestion des pairs actifs
- `src/network/discovery.ts`: decouverte multicast UDP
- `src/network/server.ts`: serveur TCP
- `src/network/client.ts`: client TCP
- `tests/test-network.ts`: test integrateur Sprint 1

## Notes techniques ESM

Le projet utilise des imports locaux en `.js` avec `ts-node --esm`.  
Des fichiers shim `.js` exportent les modules `.ts` pour assurer la compatibilite sous Windows.
