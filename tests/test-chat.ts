import crypto from 'crypto';
import { ArpelNode } from '../src/cli/node.js';

function demoSessionKey(): Buffer {
  return crypto.createHash('sha256').update('demo').digest().subarray(0, 32);
}

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

async function run(): Promise<void> {
  const nodeA = new ArpelNode();
  const nodeB = new ArpelNode();
  const portA = 7877;
  const portB = 7878;
  const key = demoSessionKey();

  try {
    await nodeA.start(portA);
    await nodeB.start(portB);

    // Bypass network discovery variability in tests: pin peers directly.
    nodeA.peerTable.upsert(nodeB.identity.nodeId, {
      ip: '127.0.0.1',
      tcpPort: portB,
      lastSeen: Date.now()
    });
    nodeB.peerTable.upsert(nodeA.identity.nodeId, {
      ip: '127.0.0.1',
      tcpPort: portA,
      lastSeen: Date.now()
    });

    const msgAB = `hello-from-a-${Date.now()}`;
    await nodeA.sendMessage(nodeB.identity.nodeId, msgAB, key);
    await new Promise<void>((resolve) => setTimeout(resolve, 350));

    const receivedByB = nodeB
      .getMessages(nodeA.identity.nodeId)
      .filter((m) => m.direction === 'received' && m.content === msgAB);
    assert(receivedByB.length > 0, 'Message A -> B non recu');

    const msgBA = `hello-from-b-${Date.now()}`;
    await nodeB.sendMessage(nodeA.identity.nodeId, msgBA, key);
    await new Promise<void>((resolve) => setTimeout(resolve, 350));

    const receivedByA = nodeA
      .getMessages(nodeB.identity.nodeId)
      .filter((m) => m.direction === 'received' && m.content === msgBA);
    assert(receivedByA.length > 0, 'Message B -> A non recu');

    console.log('ARCHIPEL - Test Chat');
    console.log('--------------------');
    console.log('A -> B : OK');
    console.log('B -> A : OK');
    console.log('Chat end-to-end : OK');
  } finally {
    await nodeA.stop().catch(() => undefined);
    await nodeB.stop().catch(() => undefined);
  }
}

void run().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`ERREUR TEST CHAT: ${message}`);
  process.exit(1);
});

