# ARCHIPEL
> Protocole P2P Chiffre et Decentralise a Zero-Connexion

## Description
Archipel est un protocole P2P local qui fonctionne sans Internet, sans serveur central et sans autorite de certification.
Chaque noeud agit comme client et serveur pour decouvrir ses pairs, echanger des messages et transferer des fichiers.
Le projet combine chiffrement E2E (AES-GCM), authentification sans CA (TOFU + signatures Ed25519) et transfert par chunks inspires de BitTorrent.
L'objectif est une demo end-to-end locale en moins de 5 minutes devant jury.

## Architecture
```text
+------------------------------------------------------+
|  Couche Web/UX (Sprint 4)                           |
|  - Interface locale (http://localhost:8080)         |
|  - API REST Express                                 |
+------------------------------------------------------+
|  Couche Messaging (Sprint 2/4)                      |
|  - ChatSession                                      |
|  - Gemini (optionnel, mode hors-ligne possible)     |
+------------------------------------------------------+
|  Couche Crypto (Sprint 2)                           |
|  - Handshake X25519 + signatures Ed25519            |
|  - AES-256-GCM + HKDF                               |
|  - HMAC-SHA256 + TOFU trust store                   |
+------------------------------------------------------+
|  Couche Reseau (Sprint 1)                           |
|  - Discovery UDP multicast                          |
|  - TCP server/client + framing binaire              |
+------------------------------------------------------+
|  Couche Transfert (Sprint 3)                        |
|  - Chunker, Manifest, DownloadManager               |
|  - Reconstruction + verification SHA-256            |
+------------------------------------------------------+
```

## Interface Web
Captures attendues:
- Dashboard: etat noeud, pairs actifs, activite recente.
- Messages: conversations chiffrees, chat individuel, envoi.
- Fichiers: partage, progression de chunks, hash SHA-256.
- Web of Trust: statuts verifies/TOFU/revoques, approbation/revocation.

## Stack Technique
| Composant | Technologie | Justification |
|---|---|---|
| Runtime | Node.js + TypeScript ESM | Execution rapide, typage strict |
| Reseau local | dgram + net | UDP multicast discovery + TCP data |
| Crypto | libsodium + crypto natif | X25519/Ed25519 + AES-GCM/HMAC/HKDF |
| API | Express + CORS + Multer | REST simple + upload de fichiers |
| Frontend | HTML/CSS/JS vanilla | Interface legere sans build complexe |

## Installation
```powershell
git clone <repo>
cd archipel
npm install
npx.cmd ts-node --esm src/cli/index.ts
# Ouvre http://localhost:8080
```

## Guide Demo Jury
1. Lancer le noeud A:
```powershell
npx.cmd ts-node --esm src/cli/index.ts
```
2. Ouvrir `http://localhost:8080`.
3. Lancer le noeud B:
```powershell
$env:TCP_PORT="7778"; $env:WEB_PORT="8081"
npx.cmd ts-node --esm src/cli/index.ts
```
4. Ouvrir `http://localhost:8081`.
5. Attendre ~30s pour la decouverte automatique des pairs.
6. Envoyer un message chiffre depuis l'interface Messages.
7. Partager un fichier et verifier le hash final.

Option 3 noeuds:
```powershell
powershell -ExecutionPolicy Bypass -File .\demo\run_demo.ps1
```

## Primitives Cryptographiques
| Primitive | Usage | Justification |
|---|---|---|
| X25519 | Secret partage handshake | Echange de cle moderne |
| Ed25519 | Signature handshake | Authentification sans CA |
| AES-256-GCM | Chiffrement messages/chunks | Confidentialite + integrite |
| HKDF-SHA256 | Derivation de session keys | Separation de contexte |
| HMAC-SHA256 | Signature de paquets | Detection de modification |
| SHA-256 | Hash chunks/fichiers | Verification d'integrite |

## Limitations Connues + Pistes d'Amelioration
- Certaines configurations Wi-Fi filtrent multicast/broadcast.
- Gestion des reprises de transfert perfectible (resume avancé).
- HMAC interne present, mais unification du framing peut etre encore simplifiee.
- Gemini depend d'une cle API et d'Internet (optionnel).
- Pistes:
  - routage resilient multi-sources,
  - chiffrement de metadata plus strict,
  - observabilite/metrics en temps reel.

## Equipe
| Membre | Role | Contributions |
|---|---|---|
| Membre 1 | Reseau | Discovery UDP, TCP framing |
| Membre 2 | Crypto | Handshake, AES-GCM, HMAC, TOFU |
| Membre 3 | Transfert | Chunking, manifest, downloader |
| Membre 4 | UX/API | Interface web, API Express, demo |

## Licence
MIT
