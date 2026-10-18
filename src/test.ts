// The speed test. Latency from small round trips, then download on parallel
// lanes, then upload on parallel lanes. The bytes are SHAKE256 of the message
// (server/payload.ts); the upload sends block 0 back so the server can see
// the message survived the trip.
import type { Phase } from "../shared/types.ts";

export type Tick = { phase: Phase; value: number; progress: number };
export type TestResult = { download: number; upload: number; latency: number; jitter: number; verified: boolean | null };

const PING_COUNT = 12;
const DOWN_MS = 8000, UP_MS = 8000, LANES = 4;
const DOWN_REQ_BYTES = 32 * 1024 * 1024;
const UP_CHUNK_BYTES = 4 * 1024 * 1024;
const BLOCK = 65536;
const WARMUP_MS = 1000;

const median = (a: number[]) => { const s = [...a].sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function measureLatency(onTick: (t: Tick) => void, signal: AbortSignal) {
  const samples: number[] = [];
  for (let i = 0; i < PING_COUNT; i++) {
    const t0 = performance.now();
    await fetch(`/api/ping?r=${Math.random()}`, { cache: "no-store", signal });
    const dt = performance.now() - t0;
    if (i > 0) samples.push(dt); // the first pays for the connection
    onTick({ phase: "latency", value: dt, progress: (i + 1) / PING_COUNT });
  }
  let jitter = 0;
  for (let i = 1; i < samples.length; i++) jitter += Math.abs(samples[i] - samples[i - 1]);
  return { latency: median(samples), jitter: samples.length > 1 ? jitter / (samples.length - 1) : 0 };
}

type Lane = (signal: AbortSignal, onBytes: (n: number) => void) => Promise<void>;

/** Runs `lane` LANES times for `ms`; reports a rolling rate; returns the Mbps after warm-up. */
async function runLanes(ms: number, phase: Phase, lane: Lane, onTick: (t: Tick) => void, outer: AbortSignal) {
  const ctl = new AbortController();
  outer.addEventListener("abort", () => ctl.abort(), { once: true });
  const t0 = performance.now();
  let total = 0, warmBytes = 0, warmT: number | null = null;
  const window: [number, number][] = [];
  const onBytes = (n: number) => {
    total += n;
    const t = performance.now();
    if (warmT === null && t - t0 >= WARMUP_MS) { warmT = t; warmBytes = total; }
    window.push([t, total]);
    while (window.length && t - window[0][0] > 700) window.shift();
  };
  const ticker = setInterval(() => {
    const elapsed = performance.now() - t0;
    let inst = 0;
    if (window.length > 1) {
      const [ta, ba] = window[0], [tb, bb] = window[window.length - 1];
      if (tb > ta) inst = ((bb - ba) * 8) / ((tb - ta) / 1000) / 1e6;
    }
    onTick({ phase, value: inst, progress: Math.min(1, elapsed / ms) });
  }, 200);
  const lanes = Array.from({ length: LANES }, () => lane(ctl.signal, onBytes).catch(() => {}));
  await wait(ms);
  ctl.abort();
  clearInterval(ticker);
  await Promise.allSettled(lanes);
  if (outer.aborted) throw new DOMException("stopped", "AbortError");
  const tEnd = performance.now();
  const bytes = warmT === null ? total : total - warmBytes;
  const secs = (warmT === null ? tEnd - t0 : tEnd - warmT) / 1000;
  return secs > 0 ? (bytes * 8) / secs / 1e6 : 0;
}

const downloadLane: Lane = async (signal, onBytes) => {
  while (!signal.aborted) {
    const res = await fetch(`/api/download?bytes=${DOWN_REQ_BYTES}&r=${Math.random()}`, { cache: "no-store", signal });
    const reader = res.body!.getReader();
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      onBytes(value.byteLength);
    }
  }
};

let uploadBlob: Blob | null = null;
async function uploadPayload(): Promise<Blob> {
  if (uploadBlob) return uploadBlob;
  const block = await (await fetch(`/api/download?bytes=${BLOCK}`, { cache: "no-store" })).arrayBuffer();
  uploadBlob = new Blob(Array.from({ length: UP_CHUNK_BYTES / BLOCK }, () => block), { type: "application/octet-stream" });
  return uploadBlob;
}

const uploadLane = (blob: Blob, verified: { value: boolean | null }): Lane => (signal, onBytes) =>
  new Promise<void>((resolve, reject) => {
    const next = () => {
      if (signal.aborted) { resolve(); return; }
      const xhr = new XMLHttpRequest();
      let seen = 0;
      xhr.open("POST", `/api/upload?r=${Math.random()}`);
      xhr.setRequestHeader("Content-Type", "application/octet-stream");
      xhr.upload.onprogress = (e) => { onBytes(e.loaded - seen); seen = e.loaded; };
      xhr.onload = () => { try { verified.value = Boolean(JSON.parse(xhr.responseText).verified); } catch { /* not json */ } next(); };
      xhr.onerror = () => reject(new Error("upload failed"));
      xhr.onabort = () => resolve();
      signal.addEventListener("abort", () => xhr.abort(), { once: true });
      xhr.send(blob);
    };
    next();
  });

/** The whole test. Ticks arrive ~5× a second; abort with the signal. */
export async function runTest(onTick: (t: Tick) => void, signal: AbortSignal): Promise<TestResult> {
  const { latency, jitter } = await measureLatency(onTick, signal);
  const download = await runLanes(DOWN_MS, "download", downloadLane, onTick, signal);
  const verified = { value: null as boolean | null };
  const blob = await uploadPayload();
  const upload = await runLanes(UP_MS, "upload", uploadLane(blob, verified), onTick, signal);
  onTick({ phase: "done", value: download, progress: 1 });
  return { download, upload, latency, jitter, verified: verified.value };
}
