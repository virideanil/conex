// Results on disk, and the question behind the page: where nearby is it better, right now?
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { bearingDeg, distanceKm } from "../shared/geo.ts";
import type { LatLng, Net, Result, Spot } from "../shared/types.ts";

const DATA_DIR = process.env.CONEX_DATA_DIR || path.join(import.meta.dirname, "..", "data");
export const FILE = path.join(DATA_DIR, "results.json");
const MAX_RESULTS = 5000;
/** How long a measurement is kept, on disk and in memory. After this it is gone: nothing is held. */
export const KEEP_MS = 60 * 60 * 1000;
/** Positions are kept to four decimals (about 11 m): enough to light the radar, not enough to find a door. */
const coarse = (v: number) => Math.round(v * 1e4) / 1e4;

let results: Result[] = [];

function load() {
  try {
    const got: unknown = JSON.parse(readFileSync(FILE, "utf8"));
    results = Array.isArray(got) ? (got as Result[]) : [];
    purge();
  } catch {
    results = [];
  }
}

let saveTimer: NodeJS.Timeout | null = null;
function save() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    purge();
    mkdirSync(DATA_DIR, { recursive: true });
    writeFileSync(FILE, JSON.stringify(results));
  }, 250);
}

/** Forgets everything older than KEEP_MS. */
export function purge(now = Date.now()) {
  results = results.filter((r) => now - r.ts <= KEEP_MS);
}
setInterval(() => { const n = results.length; purge(); if (results.length !== n) save(); }, 5 * 60 * 1000).unref();

const NETS: Net[] = ["wifi", "cellular", "ethernet", "unknown"];
const net = (v: unknown): Net => (NETS.includes(v as Net) ? (v as Net) : "unknown");

const num = (v: unknown, lo: number, hi: number): number | null => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : null;
};

/** Normalises and validates an incoming result; null when unusable. */
export function sanitize(input: Record<string, unknown>): Result | null {
  const lat = num(input.lat, -90, 90), lng = num(input.lng, -180, 180), download = num(input.download, 0, 100000);
  if (lat === null || lng === null || download === null) return null;
  return {
    id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    ts: Date.now(),
    lat: coarse(lat), lng: coarse(lng), download,
    accuracy: num(input.accuracy, 0, 100000),
    upload: num(input.upload, 0, 100000),
    latency: num(input.latency, 0, 100000),
    jitter: num(input.jitter, 0, 100000),
    loaded: num(input.loaded, 0, 100000),
    rpm: num(input.rpm, 0, 1000000),
    late: num(input.late, 0, 1),
    net: net(input.net),
    verified: Boolean(input.verified),
    source: input.source === "seed" ? "seed" : "live",
  };
}

export function add(input: Record<string, unknown>): Result | null {
  const r = sanitize(input);
  if (!r) return null;
  results.push(r);
  if (results.length > MAX_RESULTS) results = results.slice(-MAX_RESULTS);
  save();
  return r;
}

/** Everything within `radiusKm` of a point, newest first. */
export function nearby(center: LatLng, radiusKm = 5, limit = 500): Result[] {
  return results.filter((r) => distanceKm(center, r) <= radiusKm).sort((a, b) => b.ts - a.ts).slice(0, limit);
}

/** A result is evidence of "the internet right now" for a while: its weight falls to zero over `windowMs`. */
export function freshness(ts: number, now: number, windowMs: number): number {
  const age = now - ts;
  return age < 0 ? 1 : Math.max(0, 1 - age / windowMs);
}

type BetterOpts = { radiusKm?: number; windowMs?: number; minGain?: number; limit?: number; now?: number };

/** Places near `center` whose recent measurements beat `baseline`, scored by how much faster, how fresh and how close. */
export function better(center: LatLng, baseline: number, opts: BetterOpts = {}): Spot[] {
  const radiusKm = opts.radiusKm ?? 2, windowMs = opts.windowMs ?? 60 * 60 * 1000, minGain = opts.minGain ?? 1.15;
  const limit = opts.limit ?? 5, now = opts.now ?? Date.now();

  // measurements gather by ~11 m cells, so one busy spot counts once
  type Cell = { lat: number; lng: number; wsum: number; down: number; up: number; ms: number; loaded: number; lsum: number; net: Net; n: number; latest: number };
  const cells = new Map<string, Cell>();
  for (const r of results) {
    if (now - r.ts > windowMs) continue;
    const d = distanceKm(center, r);
    if (d > radiusKm || d < 0.02) continue; // not where you already stand
    const key = `${r.lat.toFixed(4)},${r.lng.toFixed(4)}`, w = freshness(r.ts, now, windowMs);
    const c = cells.get(key) ?? { lat: 0, lng: 0, wsum: 0, down: 0, up: 0, ms: 0, loaded: 0, lsum: 0, net: "unknown" as Net, n: 0, latest: 0 };
    c.lat += r.lat * w; c.lng += r.lng * w; c.down += r.download * w; c.up += (r.upload ?? 0) * w; c.ms += (r.latency ?? 0) * w;
    if (r.loaded !== null) { c.loaded += r.loaded * w; c.lsum += w; }
    if (r.ts >= c.latest) c.net = r.net;
    c.wsum += w; c.n += 1; c.latest = Math.max(c.latest, r.ts);
    cells.set(key, c);
  }

  const out: Spot[] = [];
  for (const c of cells.values()) {
    if (c.wsum <= 0) continue;
    const p = { lat: c.lat / c.wsum, lng: c.lng / c.wsum }, download = c.down / c.wsum;
    if (baseline > 0 ? download < baseline * minGain : download <= 0) continue;
    const fresh = freshness(c.latest, now, windowMs), dist = distanceKm(center, p);
    out.push({
      ...p, download, upload: c.up / c.wsum, latency: c.ms / c.wsum, loaded: c.lsum > 0 ? c.loaded / c.lsum : null, net: c.net, samples: c.n, ageMs: now - c.latest,
      distanceKm: dist, bearing: bearingDeg(center, p), gain: baseline > 0 ? download / baseline : null,
      score: (download * (0.5 + 0.5 * fresh)) / (1 + dist),
    });
  }
  return out.sort((a, b) => b.score - a.score).slice(0, limit);
}

export const all = (): Result[] => results;

export function replaceAll(list: Result[]) {
  results = list.slice(-MAX_RESULTS);
  save();
}

load();
