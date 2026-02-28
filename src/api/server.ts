import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import multer from 'multer';
import crypto from 'crypto';
import { buildManifest, splitFile } from '../transfer/chunker.js';
import { askGemini } from '../messaging/gemini.js';
import type { ArpelNode } from '../cli/node.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function parseSessionKey(input: string): Buffer {
  const trimmed = String(input ?? '').trim();
  if (/^[0-9a-fA-F]{64}$/.test(trimmed)) {
    return Buffer.from(trimmed, 'hex');
  }
  return Buffer.from(crypto.createHash('sha256').update(trimmed).digest().subarray(0, 32));
}

export async function startWebServer(node: ArpelNode, webPort = 8080): Promise<void> {
  const app = express();
  const upload = multer({
    dest: path.join(process.cwd(), 'uploads')
  });

  app.use(cors());
  app.use(express.json({ limit: '5mb' }));
  app.use(express.urlencoded({ extended: true }));

  app.get('/api/status', (_req, res) => {
    res.json(node.getStatus());
  });

  app.get('/api/peers', (_req, res) => {
    res.json(node.getPeers());
  });

  app.get('/api/messages', (req, res) => {
    const nodeId = typeof req.query.nodeId === 'string' ? req.query.nodeId : undefined;
    res.json(node.getMessages(nodeId));
  });

  app.post('/api/messages', async (req, res) => {
    try {
      const { targetNodeId, message, sessionKey } = req.body as {
        targetNodeId: string;
        message: string;
        sessionKey: string;
      };
      if (!targetNodeId || !message) {
        res.status(400).json({ error: 'targetNodeId and message are required' });
        return;
      }

      const key = parseSessionKey(sessionKey || 'demo');
      await node.sendMessage(targetNodeId, message, key);
      const last = node.getMessages().at(-1);
      res.json({ success: true, nonce: last?.nonce ?? '' });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      res.status(500).json({ error: message });
    }
  });

  app.get('/api/files', (_req, res) => {
    res.json({
      files: node.server.listFileIds()
    });
  });

  app.post('/api/files/share', upload.single('file'), async (req, res) => {
    try {
      if (!req.file) {
        res.status(400).json({ error: 'file is required' });
        return;
      }

      const uploadedPath = path.isAbsolute(req.file.path)
        ? req.file.path
        : path.join(process.cwd(), req.file.path);
      const targetNodeId = typeof req.body.targetNodeId === 'string' ? req.body.targetNodeId : '';

      const manifest = await buildManifest(uploadedPath, node.identity.nodeId, (data) => {
        return Buffer.from(crypto.createHash('sha256').update(data).digest());
      });

      for await (const chunk of splitFile(uploadedPath)) {
        node.server.storeChunk(manifest.fileId, chunk.index, chunk.data);
      }

      if (targetNodeId) {
        await node.sendFile(targetNodeId, uploadedPath);
      }

      res.json({
        fileId: manifest.fileId,
        filename: manifest.filename,
        size: manifest.size,
        nbChunks: manifest.nbChunks
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      res.status(500).json({ error: message });
    }
  });

  app.post('/api/files/download', async (req, res) => {
    try {
      const { fileId } = req.body as { fileId: string };
      if (!fileId) {
        res.status(400).json({ error: 'fileId is required' });
        return;
      }
      const outputPath = await node.downloadFile(fileId);
      res.json({ success: true, outputPath });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      res.status(500).json({ error: message });
    }
  });

  app.get('/api/trust', async (_req, res) => {
    const store = await node.getTrustStore();
    res.json(store);
  });

  app.post('/api/trust/approve', async (req, res) => {
    try {
      const { nodeId } = req.body as { nodeId: string };
      await node.trustNode(nodeId);
      res.json({ success: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      res.status(500).json({ error: message });
    }
  });

  app.post('/api/trust/revoke', async (req, res) => {
    try {
      const { nodeId } = req.body as { nodeId: string };
      await node.revokeNode(nodeId);
      res.json({ success: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      res.status(500).json({ error: message });
    }
  });

  app.post('/api/gemini', async (req, res) => {
    try {
      const { context, query } = req.body as { context: string[]; query: string };
      const response = await askGemini(Array.isArray(context) ? context : [], String(query ?? ''));
      res.json({ response });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      res.status(500).json({ error: message });
    }
  });

  app.use(express.static(path.join(__dirname, '../../public')));
  app.get(/.*/, (_req, res) => {
    res.sendFile(path.join(__dirname, '../../public/index.html'));
  });

  await new Promise<void>((resolve) => {
    app.listen(webPort, () => {
      console.log(`[API] Web server sur http://localhost:${webPort}`);
      resolve();
    });
  });
}
