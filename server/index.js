'use strict';
const http = require('node:http');
const path = require('node:path');
const express = require('express');
const { WebSocketServer, WebSocket } = require('ws');
const payload = require('./payload');
const store = require('./store');

const PORT = Number(process.env.PORT) || 3000;
const MAX_DOWNLOAD = 256 * 1024 * 1024; // per request
const MAX_UPLOAD = 256 * 1024 * 1024;

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', true);

const noStore = (res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
};

app.use(express.json({ limit: '64kb' }));
app.use('/vendor/leaflet', express.static(path.join(require.resolve('leaflet'), '..'), { maxAge: '7d' }));
app.use(express.static(path.join(__dirname, '..', 'public'), { etag: false, maxAge: 0 }));

// What this server is sending and why.
app.get('/api/info', (req, res) => {
  noStore(res);
  res.json({
    message: payload.MESSAGE,
    digest: payload.DIGEST_HEX,
    blockSize: payload.BLOCK_SIZE,
    serverTime: Date.now(),
  });
});

// Latency probe: tiny response, no caching.
app.get('/api/ping', (req, res) => {
  noStore(res);
  res.setHeader('X-Server-Time', String(Date.now()));
  res.status(204).end();
});

// Download: stream SHAKE256 output of the message, `bytes` long.
app.get('/api/download', (req, res) => {
  const bytes = Math.min(MAX_DOWNLOAD, Math.max(1, Number(req.query.bytes) || 8 * 1024 * 1024));
  noStore(res);
  res.setHeader('Content-Type', 'application/octet-stream');
  res.setHeader('Content-Length', String(bytes));
  res.setHeader('X-Conex-Digest', payload.DIGEST_HEX);
  res.setHeader('X-Conex-Message', payload.MESSAGE);

  const it = payload.stream(bytes);
  let closed = false;
  res.on('close', () => { closed = true; });

  const pump = () => {
    while (!closed) {
      const { value, done } = it.next();
      if (done) { res.end(); return; }
      if (!res.write(value)) { res.once('drain', pump); return; }
    }
  };
  pump();
});

// Upload: count the bytes the client pushes to us, verify the first block
// still says the message.
app.post('/api/upload', (req, res) => {
  noStore(res);
  let total = 0;
  let head = Buffer.alloc(0);
  const started = Date.now();
  req.on('data', (chunk) => {
    total += chunk.length;
    if (head.length < payload.BLOCK_SIZE) {
      head = Buffer.concat([head, chunk.subarray(0, payload.BLOCK_SIZE - head.length)]);
    }
    if (total > MAX_UPLOAD) req.destroy();
  });
  req.on('end', () => {
    res.json({ bytes: total, ms: Date.now() - started, verified: payload.verifyFirstBlock(head) });
  });
  req.on('error', () => { if (!res.headersSent) res.status(400).end(); });
});

// Results: submit and query.
app.post('/api/results', (req, res) => {
  noStore(res);
  const r = store.add({ ...req.body, source: 'live' });
  if (!r) return res.status(400).json({ error: 'lat, lng and download are required' });
  broadcast({ type: 'result', result: r });
  res.status(201).json(r);
});

app.get('/api/results', (req, res) => {
  noStore(res);
  const lat = Number(req.query.lat);
  const lng = Number(req.query.lng);
  const radius = Math.min(500, Math.max(0.1, Number(req.query.radius) || 5));
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return res.json(store.all().slice(-500));
  }
  res.json(store.nearby({ lat, lng }, radius));
});

// Better spots near a point, right now.
app.get('/api/better', (req, res) => {
  noStore(res);
  const lat = Number(req.query.lat);
  const lng = Number(req.query.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return res.status(400).json({ error: 'lat and lng are required' });
  }
  const baseline = Math.max(0, Number(req.query.download) || 0);
  const radiusKm = Math.min(50, Math.max(0.1, Number(req.query.radius) || 2));
  const windowMin = Math.min(24 * 60, Math.max(1, Number(req.query.window) || 60));
  res.json({
    baseline,
    radiusKm,
    windowMin,
    spots: store.better({ lat, lng }, baseline, { radiusKm, windowMs: windowMin * 60 * 1000 }),
  });
});

// Real-time channel: presence of clients mid-test and finished results.
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });
const presence = new Map(); // ws -> last presence message

function broadcast(msg, except) {
  const data = JSON.stringify(msg);
  for (const client of wss.clients) {
    if (client !== except && client.readyState === WebSocket.OPEN) client.send(data);
  }
}

wss.on('connection', (ws) => {
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });
  ws.send(JSON.stringify({
    type: 'hello',
    digest: payload.DIGEST_HEX,
    online: wss.clients.size,
    presence: [...presence.values()],
  }));
  broadcast({ type: 'online', online: wss.clients.size });

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    if (msg.type === 'presence') {
      const p = {
        id: String(msg.id || '').slice(0, 40),
        lat: Number(msg.lat),
        lng: Number(msg.lng),
        phase: String(msg.phase || 'idle').slice(0, 16),
        value: Number(msg.value) || 0,
        ts: Date.now(),
      };
      if (!p.id || !Number.isFinite(p.lat) || !Number.isFinite(p.lng)) return;
      presence.set(ws, p);
      broadcast({ type: 'presence', presence: p }, ws);
    } else if (msg.type === 'ping') {
      ws.send(JSON.stringify({ type: 'pong', t: msg.t, serverTime: Date.now() }));
    }
  });

  ws.on('close', () => {
    const p = presence.get(ws);
    presence.delete(ws);
    if (p) broadcast({ type: 'leave', id: p.id });
    broadcast({ type: 'online', online: wss.clients.size });
  });
});

const heartbeat = setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) { ws.terminate(); continue; }
    ws.isAlive = false;
    ws.ping();
  }
}, 30000);
wss.on('close', () => clearInterval(heartbeat));

if (require.main === module) {
  server.listen(PORT, () => {
    console.log(`conex listening on http://localhost:${PORT}`);
    console.log(`payload: SHAKE256("${payload.MESSAGE}") -> ${payload.DIGEST_HEX.slice(0, 16)}…`);
  });
}

module.exports = { app, server };
