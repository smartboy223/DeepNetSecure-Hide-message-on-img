/**
 * Serves frontend/dist, local CNN analysis (/api/analyze), optional /api/diagnose, metrics JSON.
 */
import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';
import multer from 'multer';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

dotenv.config({ path: path.join(ROOT, 'backend', '.env') });
dotenv.config({ path: path.join(ROOT, 'backend', '.env.local') });
dotenv.config({ path: path.join(ROOT, 'frontend', '.env.local') });

// Use DEEPNET_PORT only — do not use generic PORT (often set globally to 3000/3002 by other tools).
const PORT = Number(process.env.DEEPNET_PORT || 4006);
const PUBLIC_DIR = path.join(ROOT, 'frontend', 'dist');
const UPLOAD_DIR = path.join(__dirname, 'uploads');

if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

const upload = multer({ dest: UPLOAD_DIR });

function pythonSpawnArgs(scriptPath, argsAfter) {
  const raw = (process.env.PYTHON_CMD || 'python').trim();
  const parts = raw.split(/\s+/).filter(Boolean);
  const cmd = parts[0] || 'python';
  const prefix = parts.slice(1);
  return { cmd, args: [...prefix, scriptPath, ...argsAfter] };
}

const app = express();
app.use(express.json({ limit: '2mb' }));

app.post('/api/analyze', upload.single('image'), (req, res) => {
  const filePath = req.file?.path;
  if (!filePath) {
    res.status(400).json({ ok: false, error: 'Missing multipart field "image".' });
    return;
  }

  const cap = String(req.body?.capacityBytes ?? '0');
  const pay = String(req.body?.payloadBytes ?? '0');

  const scriptPath = path.join(__dirname, 'analyze_image.py');
  const { cmd, args } = pythonSpawnArgs(scriptPath, [filePath, cap, pay]);

  const child = spawn(cmd, args, {
    cwd: ROOT,
    env: { ...process.env, PYTHONUTF8: '1' },
  });

  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (d) => {
    stdout += d.toString();
  });
  child.stderr.on('data', (d) => {
    stderr += d.toString();
  });
  child.on('close', (code) => {
    try {
      fs.unlinkSync(filePath);
    } catch {
      /* ignore */
    }

    if (code !== 0) {
      res.status(500).json({
        ok: false,
        error: 'analyze_failed',
        detail: stderr.slice(0, 800) || stdout.slice(0, 800) || `exit ${code}`,
      });
      return;
    }

    try {
      const line = stdout.trim().split(/\r?\n/).filter(Boolean).pop() || '{}';
      const parsed = JSON.parse(line);
      res.json(parsed);
    } catch {
      res.status(500).json({ ok: false, error: 'invalid_analyze_output', raw: stdout.slice(0, 300) });
    }
  });
});

app.post('/api/diagnose', upload.single('image'), (req, res) => {
  const filePath = req.file?.path;
  if (!filePath) {
    res.status(400).json({ error: 'Missing multipart field "image".' });
    return;
  }

  const inferencePy = path.join(__dirname, 'inference.py');
  const { cmd, args } = pythonSpawnArgs(inferencePy, [filePath]);

  const child = spawn(cmd, args, {
    cwd: ROOT,
    env: { ...process.env, PYTHONUTF8: '1' },
  });

  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (d) => {
    stdout += d.toString();
  });
  child.stderr.on('data', (d) => {
    stderr += d.toString();
  });
  child.on('close', (code) => {
    try {
      fs.unlinkSync(filePath);
    } catch {
      /* ignore */
    }

    if (code !== 0) {
      res.status(500).json({
        ok: false,
        error: 'inference_failed',
        detail: stderr.slice(0, 500) || `exit ${code}`,
      });
      return;
    }

    try {
      const line = stdout.trim().split(/\r?\n/).filter(Boolean).pop() || '{}';
      const parsed = JSON.parse(line);
      res.json(parsed);
    } catch {
      res.status(500).json({ ok: false, error: 'invalid_inference_output', raw: stdout.slice(0, 300) });
    }
  });
});

app.get('/api/metrics', (req, res) => {
  const p = path.join(ROOT, 'cnn_model', 'evaluation_metrics.json');
  if (fs.existsSync(p)) {
    res.type('application/json').sendFile(p);
    return;
  }
  res.status(404).json({ error: 'No cnn_model/evaluation_metrics.json. Run training or backend/evaluate.py' });
});

app.use(express.static(PUBLIC_DIR));

app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) {
    next();
    return;
  }
  const indexFile = path.join(PUBLIC_DIR, 'index.html');
  if (fs.existsSync(indexFile)) {
    res.sendFile(indexFile);
    return;
  }
  res
    .status(503)
    .type('text/plain')
    .send(
      'UI not built. From the project root (not frontend/), run: npm install && npm run build — or run.bat setup on Windows. Output must exist at frontend/dist/.',
    );
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`DeepNetSecure backend http://localhost:${PORT}/`);
});
