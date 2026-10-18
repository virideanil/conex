// Results on disk, and the question behind the page: where nearby is it better, right now?
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { bearingDeg, distanceKm } from "../shared/geo.ts";
import type { LatLng, Result, Spot } from "../shared/types.ts";

const DATA_DIR = process.env.CONEX_DATA_DIR || path.join(import.meta.dirname, "..", "data");
export const FILE = path.join(DATA_DIR, "results.json");
const MAX_RESULTS = 5000;

let results: Result[] = [];

function load() {
  try {
    const got: unknown = JSON.parse(readFileSync(FILE, "utf8"));
    results = Array.isArray(got) ? (got as Result[]) : [];
  } catch {
    results = [];
  }
}

let saveTimer: NodeJS.Timeout | null = null;
function save() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    mkdirSync(DATA_DIR, { recursive: true });
    writeFileSync(FILE, JSON.stringify(results));
  }, 250);
}

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
    lat, lng, download,
    accuracy: num(input.accuracy, 0, 100000),
    upload: num(input.upload, 0, 100000),
    latency: num(input.latency, 0, 100000),
    jitter: num(input.jitter, 0, 100000),
    verified: Boolean(input.verified),
    client: typeof input.client === "string" ? input.client.slice(0, 40) : null,
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
  type Cell = { lat: number; lng: number; wsum: number; down: number; up: number; ms: number; n: number; latest: number };
  const cells = new Map<string, Cell>();
  for (const r of results) {
    if (now - r.ts > windowMs) continue;
    const d = distanceKm(center, r);
    if (d > radiusKm || d < 0.02) continue; // not where you already stand
    const key = `${r.lat.toFixed(4)},${r.lng.toFixed(4)}`, w = freshness(r.ts, now, windowMs);
    const c = cells.get(key) ?? { lat: 0, lng: 0, wsum: 0, down: 0, up: 0, ms: 0, n: 0, latest: 0 };
    c.lat += r.lat * w; c.lng += r.lng * w; c.down += r.download * w; c.up += (r.upload ?? 0) * w; c.ms += (r.latency ?? 0) * w;
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
      ...p, download, upload: c.up / c.wsum, latency: c.ms / c.wsum, samples: c.n, ageMs: now - c.latest,
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
