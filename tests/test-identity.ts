import { getPublicIdentity, loadIdentity, verifyIdentity } from '../src/crypto/identity.js';

async function run(): Promise<void> {
  try {
    const identity = await loadIdentity();

    if (identity.nodeId.length !== 64) {
      throw new Error('nodeId doit faire 64 caracteres hex');
    }

    if (identity.fingerprint.length !== 64) {
      throw new Error('fingerprint doit faire 64 caracteres hex');
    }

    if (identity.sign.publicKey.length !== 32) {
      throw new Error('sign.publicKey doit faire 32 bytes');
    }

    if (identity.kx.publicKey.length !== 32) {
      throw new Error('kx.publicKey doit faire 32 bytes');
    }

    const identity2 = await loadIdentity();
    if (identity.nodeId !== identity2.nodeId) {
      throw new Error('Persistance invalide: nodeId different entre deux chargements');
    }

    const pub = getPublicIdentity(identity);
    if ('sign' in (pub as unknown as Record<string, unknown>) || 'kx' in (pub as unknown as Record<string, unknown>)) {
      throw new Error('getPublicIdentity expose des cles privees');
    }

    if (!verifyIdentity(pub)) {
      throw new Error('verifyIdentity a retourne false');
    }

    console.log('ARCHIPEL - Test Identity');
    console.log('-----------------------------------------');
    console.log(`nodeId      : ${identity.nodeId}`);
    console.log(`fingerprint : ${identity.fingerprint}`);
    console.log(`sign.pub    : ${Buffer.from(identity.sign.publicKey).toString('hex')}`);
    console.log(`kx.pub      : ${Buffer.from(identity.kx.publicKey).toString('hex')}`);
    console.log('Persistance : OK');
    console.log('Public only : OK - pas de cles privees');
    console.log('Verify      : OK');
    console.log('-----------------------------------------');
    console.log('Tous les tests passent - Identity OK');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`ERREUR : ${message}`);
    process.exit(1);
  }
}

void run();