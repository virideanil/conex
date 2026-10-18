// conex: the test's bytes, the results, and the live channel. In production
// it also serves the built page from dist/.
import { createServer } from "node:http";
import { existsSync } from "node:fs";
import path from "node:path";
import express, { type Response } from "express";
import { WebSocketServer, WebSocket } from "ws";
import * as payload from "./payload.ts";
import * as store from "./store.ts";
import type { ClientMsg, Presence, ServerMsg } from "../shared/types.ts";

const PORT = Number(process.env.PORT) || 3000;
const MAX_DOWNLOAD = 256 * 1024 * 1024; // per request
const MAX_UPLOAD = 256 * 1024 * 1024;
const DIST = path.join(import.meta.dirname, "..", "dist");

// What one address may do: enough for people, not for a flood. Counted per hour, forgotten after.
const LIMITS = { results: 60, downloadBytes: 40 * 1024 ** 3, uploadBytes: 40 * 1024 ** 3 };
const buckets = new Map<string, { until: number; results: number; downloadBytes: number; uploadBytes: number }>();
function bucket(ip: string) {
  const now = Date.now();
  let b = buckets.get(ip);
  if (!b || b.until < now) { b = { until: now + 3600e3, results: 0, downloadBytes: 0, uploadBytes: 0 }; buckets.set(ip, b); }
  return b;
}
setInterval(() => { const now = Date.now(); for (const [k, b] of buckets) if (b.until < now) buckets.delete(k); }, 10 * 60e3).unref();

const app = express();
app.disable("x-powered-by");
app.set("trust proxy", true);

const noStore = (res: Response) => {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
  res.setHeader("Server-Timing", "app;dur=0"); // nothing is computed per request: the stream is precomputed
};

app.use(express.json({ limit: "64kb" }));

/** What this server sends and why. */
app.get("/api/info", (_req, res) => {
  noStore(res);
  res.json({ message: payload.MESSAGE, digest: payload.DIGEST_HEX, blockSize: payload.BLOCK_SIZE, keptMin: store.KEEP_MS / 60000, serverTime: Date.now() });
});

/** A stream, as a 4K60 player would pull one: frames of the sentence's bytes, paced at `fps`, `mbps` worth a second. */
app.get("/api/stream", (req, res) => {
  const mbps = Math.min(200, Math.max(1, Number(req.query.mbps) || 40));
  const fps = Math.min(120, Math.max(1, Math.round(Number(req.query.fps) || 60)));
  const seconds = Math.min(10, Math.max(1, Number(req.query.seconds) || 4));
  const frameBytes = Math.round((mbps * 1e6) / 8 / fps), frames = Math.round(seconds * fps), period = 1000 / fps;
  noStore(res);
  const b = bucket(req.ip ?? "?");
  if (b.downloadBytes > LIMITS.downloadBytes) { res.status(429).end(); return; }
  b.downloadBytes += frames * frameBytes;
  res.setHeader("Content-Type", "application/octet-stream");
  res.setHeader("Content-Length", String(frames * frameBytes));
  res.setHeader("X-Conex-Frame", `${frameBytes};${fps}`);
  let k = 0, closed = false;
  res.on("close", () => { closed = true; });
  const t0 = performance.now();
  const send = () => {
    if (closed) return;
    // every frame whose time has come goes now; a slow link falls behind here, and the page measures by how much
    while (k < frames && performance.now() >= t0 + k * period) {
      const ok = res.write(payload.bytesAt(k * frameBytes, frameBytes));
      k += 1;
      if (!ok) { res.once("drain", send); return; }
    }
    if (k >= frames) { res.end(); return; }
    setTimeout(send, Math.max(1, t0 + k * period - performance.now()));
  };
  send();
});

/** Download: `bytes` of SHAKE256 output of the message. */
app.get("/api/download", (req, res) => {
  const bytes = Math.min(MAX_DOWNLOAD, Math.max(1, Number(req.query.bytes) || 8 * 1024 * 1024));
  noStore(res);
  const b = bucket(req.ip ?? "?");
  if (b.downloadBytes > LIMITS.downloadBytes) { res.status(429).end(); return; }
  b.downloadBytes += bytes;
  res.setHeader("Content-Type", "application/octet-stream");
  res.setHeader("Content-Length", String(bytes));
  res.setHeader("X-Conex-Digest", payload.DIGEST_HEX);
  const it = payload.stream(bytes);
  let closed = false;
  res.on("close", () => { closed = true; });
  const pump = () => {
    while (!closed) {
      const { value, done } = it.next();
      if (done) { res.end(); return; }
      if (!res.write(value)) { res.once("drain", pump); return; }
    }
  };
  pump();
});

/** Upload: count what arrives; check the first block still says the message. */
app.post("/api/upload", (req, res) => {
  noStore(res);
  const b = bucket(req.ip ?? "?");
  if (b.uploadBytes > LIMITS.uploadBytes) { req.destroy(); res.status(429).end(); return; }
  let total = 0, head = Buffer.alloc(0);
  const started = Date.now();
  req.on("data", (chunk: Buffer) => {
    total += chunk.length;
    if (head.length < payload.BLOCK_SIZE) head = Buffer.concat([head, chunk.subarray(0, payload.BLOCK_SIZE - head.length)]);
    if (total > MAX_UPLOAD) req.destroy();
  });
  req.on("end", () => { b.uploadBytes += total; res.json({ bytes: total, ms: Date.now() - started, verified: payload.verifyFirstBlock(head) }); });
  req.on("error", () => { if (!res.headersSent) res.status(400).end(); });
});

app.post("/api/results", (req, res) => {
  noStore(res);
  const b = bucket(req.ip ?? "?");
  if (b.results >= LIMITS.results) { res.status(429).json({ error: "enough for this hour" }); return; }
  b.results += 1;
  const r = store.add({ ...(req.body as Record<string, unknown>), source: "live" });
  if (!r) { res.status(400).json({ error: "lat, lng and download are required" }); return; }
  broadcast({ type: "result", result: r });
  res.status(201).json(r);
});

app.get("/api/results", (req, res) => {
  noStore(res);
  const lat = Number(req.query.lat), lng = Number(req.query.lng);
  const radius = Math.min(500, Math.max(0.1, Number(req.query.radius) || 5));
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) { res.json(store.all().slice(-500)); return; }
  res.json(store.nearby({ lat, lng }, radius));
});

/** Better spots near a point, right now. */
app.get("/api/better", (req, res) => {
  noStore(res);
  const lat = Number(req.query.lat), lng = Number(req.query.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) { res.status(400).json({ error: "lat and lng are required" }); return; }
  const baseline = Math.max(0, Number(req.query.download) || 0);
  const radiusKm = Math.min(50, Math.max(0.1, Number(req.query.radius) || 2));
  const windowMin = Math.min(24 * 60, Math.max(1, Number(req.query.window) || 60));
  res.json({ baseline, radiusKm, windowMin, spots: store.better({ lat, lng }, baseline, { radiusKm, windowMs: windowMin * 60 * 1000 }) });
});

// the built page, when there is one (vite serves it in development)
if (existsSync(DIST)) {
  app.use(express.static(DIST, { index: "index.html", maxAge: "1h", setHeaders: (res, file) => { if (file.endsWith("index.html") || file.endsWith("sw.js")) noStore(res); } }));
}

// ── the live channel: who is testing where, and each result as it lands ──
const server = createServer(app);
const wss = new WebSocketServer({ server, path: "/ws" });
const presence = new Map<WebSocket, Presence>();
type Live = WebSocket & { isAlive?: boolean };

function broadcast(msg: ServerMsg, except?: WebSocket) {
  const data = JSON.stringify(msg);
  for (const c of wss.clients) if (c !== except && c.readyState === WebSocket.OPEN) c.send(data);
}

wss.on("connection", (ws: Live) => {
  ws.isAlive = true;
  ws.on("pong", () => { ws.isAlive = true; });
  ws.send(JSON.stringify({ type: "hello", digest: payload.DIGEST_HEX, online: wss.clients.size, presence: [...presence.values()] } satisfies ServerMsg));
  broadcast({ type: "online", online: wss.clients.size });

  ws.on("message", (raw, isBinary) => {
    // a binary frame is the sentence's digest with a clock: it goes straight back, the same bytes
    if (isBinary) { ws.send(raw, { binary: true }); return; }
    let msg: ClientMsg;
    try { msg = JSON.parse(String(raw)); } catch { return; }
    if (msg.type === "presence") {
      const p: Presence = {
        id: String(msg.id ?? "").slice(0, 40), lat: Number(msg.lat), lng: Number(msg.lng),
        phase: msg.phase ?? "idle", value: Number(msg.value) || 0, ts: Date.now(),
      };
      if (!p.id || !Number.isFinite(p.lat) || !Number.isFinite(p.lng)) return;
      presence.set(ws, p);
      broadcast({ type: "presence", presence: p }, ws);
    }
  });

  ws.on("close", () => {
    const p = presence.get(ws);
    presence.delete(ws);
    if (p) broadcast({ type: "leave", id: p.id });
    broadcast({ type: "online", online: wss.clients.size });
  });
});

const heartbeat = setInterval(() => {
  for (const c of wss.clients as Set<Live>) {
    if (!c.isAlive) { c.terminate(); continue; }
    c.isAlive = false;
    c.ping();
  }
}, 30000);
wss.on("close", () => clearInterval(heartbeat));

server.listen(PORT, () => {
  console.log(`conex · http://localhost:${PORT}${existsSync(DIST) ? "" : " (api only: run vite, or npm run build)"}`);
  console.log(`payload · shake256("${payload.MESSAGE}") → ${payload.DIGEST_HEX.slice(0, 16)}…`);
});
