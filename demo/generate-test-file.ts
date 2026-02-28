import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';

const SIZE = 50 * 1024 * 1024;
const OUTPUT = path.join(process.cwd(), 'demo', 'test-50mb.bin');

async function run(): Promise<void> {
  await fs.mkdir(path.join(process.cwd(), 'demo'), { recursive: true });
  await fs.writeFile(OUTPUT, Buffer.alloc(0));

  const chunkSize = 1024 * 1024;
  const chunks = Math.ceil(SIZE / chunkSize);

  for (let i = 0; i < chunks; i += 1) {
    const remaining = SIZE - i * chunkSize;
    const currentSize = Math.min(chunkSize, remaining);
    const random = crypto.randomBytes(currentSize);
    await fs.appendFile(OUTPUT, random);
  }

  const fileData = await fs.readFile(OUTPUT);
  const hash = crypto.createHash('sha256').update(fileData).digest('hex');

  console.log('Fichier test généré : 50 Mo  test-50mb.bin');
  console.log(`SHA-256 : ${hash}`);
}

void run().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`ERREUR : ${message}`);
  process.exit(1);
});
