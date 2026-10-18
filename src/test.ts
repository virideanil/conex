// The speed test, after how the serious ones measure.
//   latency   twenty round trips on the live channel (one connection, no HTTP
//             overhead); the median is latency, the mean step is jitter.
//   download  lanes of GET /api/download, starting with two and adding two each
//             second until adding stops helping, up to eight: working
//             conditions, as the IETF responsiveness draft reaches them. Rates
//             are sampled every 250 ms; the figure is their trimmed mean (the
//             lowest 30 % and highest 10 % dropped, as Ookla does, so slow
//             start and bursts do not count). It stops once four seconds in a
//             row agree within 5 %, at ten seconds, or at its byte cap, so a
//             phone plan is not spent on it.
//   upload    the same, with POST /api/upload lanes of SHAKE256 block 0
//             repeated; the server checks the message came back intact.
//   stream    four seconds of frames pulled as a 4K60 player would: 40 Mbit a
//             second in sixty frames, paced by the server. Each frame is timed
//             against its deadline; the share that came late, and the worst
//             stall, say whether the line can hold a live picture. The pings
//             keep going alongside.
//   under load a probe every 400 ms on the live channel while the lanes run
//             (Cloudflare's cadence): the median is loaded latency, and
//             60000 / the 95 % trimmed mean is responsiveness in round trips
//             per minute (the draft's figure).
// Nothing but the sentence crosses the wire: every byte of every phase, and
// every ping, is SHAKE256 of the message (server/payload.ts).
import type { Phase } from "../shared/types.ts";
import { median, jitterOf, trimmedMean, rpmOf, stable } from "../shared/stats.ts";

export type Tick = { phase: Phase; value: number; progress: number; lanes: number; loaded: number | null; bytes: number };
export type StreamResult = { mbps: number; frames: number; late: number; stall: number; got: number };
export type TestResult = {
  download: number; upload: number; latency: number; jitter: number;
  loadedDown: number | null; loadedUp: number | null; loaded: number | null; rpm: number | null;
  stream: StreamResult | null;
  bytes: number; verified: boolean | null; lanes: { down: number; up: number };
};
export type TestOpts = {
  /** A round trip on a connection that is not a lane; rejects when it cannot. */
  ping: () => Promise<number>;
  /** A short, light test: fewer lanes, fewer seconds (data saver, or a thin link). */
  light?: boolean;
  /** The most bytes one direction may move; a phase ends there once it has run three seconds. */
  maxBytes?: number;
};

const PING_COUNT = 20;
const SAMPLE_MS = 250, PROBE_MS = 400, WARMUP_MS = 1000;
const DOWN_REQ_BYTES = 32 * 1024 * 1024, UP_CHUNK_BYTES = 4 * 1024 * 1024, BLOCK = 65536;
const STREAM = { mbps: 40, fps: 60, seconds: 4, slackMs: 80 }; // a 4K60 picture, and the little buffer a live player keeps
const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
/** The fallback probe when the channel is down: 64 bytes of the sentence, fetched. */
const httpPing = async (signal?: AbortSignal) => { const t0 = performance.now(); await (await fetch(`/api/download?bytes=64&r=${Math.random()}`, { cache: "no-store", signal })).arrayBuffer(); return performance.now() - t0; };

async function measureLatency(opts: TestOpts, onTick: (t: Tick) => void, signal: AbortSignal) {
  const samples: number[] = [];
  let viaHttp = false;
  for (let i = 0; i < PING_COUNT; i++) {
    if (signal.aborted) throw new DOMException("stopped", "AbortError");
    let dt: number;
    try { dt = viaHttp ? await httpPing(signal) : await opts.ping(); } catch { viaHttp = true; dt = await httpPing(signal); }
    if (i > 0) samples.push(dt); // the first pays for whatever is cold
    onTick({ phase: "latency", value: dt, progress: (i + 1) / PING_COUNT, lanes: 1, loaded: null, bytes: 0 });
  }
  return { latency: median(samples), jitter: jitterOf(samples) };
}

type Lane = (signal: AbortSignal, onBytes: (n: number) => void) => Promise<void>;

/** Lanes of `lane` for a direction; returns the figure, the probes under load, the bytes moved and the lanes used. */
async function runLanes(phase: Phase, lane: Lane, opts: TestOpts, onTick: (t: Tick) => void, outer: AbortSignal) {
  const light = Boolean(opts.light);
  const START = light ? 1 : 2, MAX = light ? 2 : 8, MIN_MS = light ? 4000 : 5000, MAX_MS = light ? 5000 : 10000;
  const CAP = opts.maxBytes ?? (light ? 60e6 : 500e6), CAP_MIN_MS = 3000;
  const ctl = new AbortController();
  outer.addEventListener("abort", () => ctl.abort(), { once: true });
  const t0 = performance.now();
  let total = 0, lastTotal = 0, lastT = t0, lanes = 0;
  const samples: number[] = [], seconds: number[] = [], probes: number[] = [];
  const running: Promise<void>[] = [];
  const onBytes = (n: number) => { total += n; };
  const addLane = () => { lanes += 1; running.push(lane(ctl.signal, onBytes).catch(() => {})); };
  for (let i = 0; i < START; i++) addLane();

  // probes under load, on their own connection
  let probing = true;
  const probeLoop = (async () => {
    while (probing && !ctl.signal.aborted) {
      await wait(PROBE_MS);
      if (!probing) break;
      try { const ms = await opts.ping(); if (probing) probes.push(ms); } catch { /* the channel is down: no probe */ }
    }
  })();

  // rates every 250 ms; every second the lanes are judged
  let secondBytes = 0, secondT = t0, stopped = false, addedAt = 0; // the second lanes were last added
  while (!stopped && !ctl.signal.aborted) {
    await wait(SAMPLE_MS);
    const t = performance.now(), dt = (t - lastT) / 1000, rate = dt > 0 ? ((total - lastTotal) * 8) / dt / 1e6 : 0;
    if (t - t0 >= WARMUP_MS) samples.push(rate);
    lastTotal = total; lastT = t;
    const elapsed = t - t0;
    onTick({ phase, value: rate, progress: Math.min(1, elapsed / MAX_MS), lanes, loaded: probes.length ? median(probes.slice(-5)) : null, bytes: total });
    if (t - secondT >= 1000) {
      const perSecond = ((total - secondBytes) * 8) / ((t - secondT) / 1000) / 1e6;
      seconds.push(perSecond); secondBytes = total; secondT = t;
      const n = seconds.length;
      // more lanes each second, until the second after an addition did not climb: the link is full
      const helped = addedAt === 0 || n < 2 || seconds[n - 1] > seconds[n - 2] * 1.05;
      if (lanes < MAX && (addedAt === 0 || (addedAt === n - 1 && helped))) { addLane(); addLane(); addedAt = n; }
      if (elapsed >= MIN_MS && stable(seconds, 4, 0.05)) stopped = true;
    }
    if (elapsed >= MAX_MS || (elapsed >= CAP_MIN_MS && total >= CAP)) stopped = true;
  }
  probing = false;
  ctl.abort();
  await Promise.allSettled([...running, probeLoop]);
  if (outer.aborted) throw new DOMException("stopped", "AbortError");
  const figure = samples.length ? trimmedMean(samples, 0.3, 0.1) : 0;
  return { figure, probes, bytes: total, lanes };
}

const downloadLane: Lane = async (signal, onBytes) => {
  while (!signal.aborted) {
    const res = await fetch(`/api/download?bytes=${DOWN_REQ_BYTES}&r=${Math.random()}`, { cache: "no-store", signal });
    if (res.status === 429) throw new Error("limit");
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

/** The stream: frames against their deadlines, with the pings alongside. */
async function runStream(opts: TestOpts, onTick: (t: Tick) => void, signal: AbortSignal) {
  const frameBytes = Math.round((STREAM.mbps * 1e6) / 8 / STREAM.fps), frames = STREAM.seconds * STREAM.fps, period = 1000 / STREAM.fps;
  const probes: number[] = [];
  let probing = true;
  const probeLoop = (async () => {
    while (probing && !signal.aborted) { await wait(PROBE_MS); if (!probing) break; try { const ms = await opts.ping(); if (probing) probes.push(ms); } catch { /* no probe */ } }
  })();
  const res = await fetch(`/api/stream?mbps=${STREAM.mbps}&fps=${STREAM.fps}&seconds=${STREAM.seconds}&r=${Math.random()}`, { cache: "no-store", signal });
  if (res.status === 429) throw new Error("limit");
  const reader = res.body!.getReader();
  let got = 0, k = 0, late = 0, stall = 0, t0 = 0, lastTick = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    const now = performance.now();
    if (t0 === 0) t0 = now; // the clock starts with the first frame
    got += value.byteLength;
    while (got >= (k + 1) * frameBytes && k < frames) {
      const due = t0 + k * period, behind = now - due;
      if (behind > STREAM.slackMs) late += 1;
      stall = Math.max(stall, behind);
      k += 1;
    }
    if (now - lastTick >= SAMPLE_MS) {
      lastTick = now;
      const mbps = ((got * 8) / ((now - t0) / 1000 || 1)) / 1e6;
      onTick({ phase: "stream", value: mbps, progress: k / frames, lanes: 1, loaded: probes.length ? median(probes.slice(-5)) : null, bytes: got });
    }
  }
  probing = false;
  await probeLoop;
  if (signal.aborted) throw new DOMException("stopped", "AbortError");
  const seconds = (performance.now() - t0) / 1000 || 1;
  return { result: { mbps: (got * 8) / seconds / 1e6, frames: k, late: k ? late / k : 1, stall, got } as StreamResult, probes };
}

/** The whole test. Ticks arrive four times a second; abort with the signal. */
export async function runTest(opts: TestOpts, onTick: (t: Tick) => void, signal: AbortSignal): Promise<TestResult> {
  const { latency, jitter } = await measureLatency(opts, onTick, signal);
  const down = await runLanes("download", downloadLane, opts, onTick, signal);
  const verified = { value: null as boolean | null };
  const blob = await uploadPayload();
  const up = await runLanes("upload", uploadLane(blob, verified), opts, onTick, signal);
  let stream: StreamResult | null = null, streamProbes: number[] = [];
  try { const s = await runStream(opts, onTick, signal); stream = s.result; streamProbes = s.probes; }
  catch (e) { if (e instanceof DOMException && e.name === "AbortError") throw e; /* the stream could not be pulled: the bar falls back to the threshold */ }
  const loadedDown = down.probes.length ? median(down.probes) : null, loadedUp = up.probes.length ? median(up.probes) : null;
  const all = [...down.probes, ...up.probes];
  const loaded = all.length ? Math.max(loadedDown ?? 0, loadedUp ?? 0) : null;
  const rpm = all.length ? Math.min(down.probes.length ? rpmOf(down.probes) : Infinity, up.probes.length ? rpmOf(up.probes) : Infinity) : null;
  const bytes = down.bytes + up.bytes + (stream?.got ?? 0);
  void streamProbes;
  onTick({ phase: "done", value: down.figure, progress: 1, lanes: 0, loaded, bytes });
  return { download: down.figure, upload: up.figure, latency, jitter, loadedDown, loadedUp, loaded, rpm, stream, bytes, verified: verified.value, lanes: { down: down.lanes, up: up.lanes } };
}
