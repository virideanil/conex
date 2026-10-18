'use strict';
// Result storage plus the geo queries behind "better spots nearby, right now".
const fs = require('node:fs');
const path = require('node:path');

const DATA_DIR = process.env.CONEX_DATA_DIR || path.join(__dirname, '..', 'data');
const FILE = path.join(DATA_DIR, 'results.json');
const MAX_RESULTS = 5000;

let results = [];

function load() {
  try {
    results = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    if (!Array.isArray(results)) results = [];
  } catch {
    results = [];
  }
}

let saveTimer = null;
function save() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(FILE, JSON.stringify(results));
  }, 250);
}

const num = (v, lo, hi) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : null;
};

// Normalises and validates an incoming result. Returns null when unusable.
function sanitize(input) {
  const lat = num(input.lat, -90, 90);
  const lng = num(input.lng, -180, 180);
  const download = num(input.download, 0, 100000);
  if (lat === null || lng === null || download === null) return null;
  return {
    id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    ts: Date.now(),
    lat,
    lng,
    accuracy: num(input.accuracy, 0, 100000),
    download,
    upload: num(input.upload, 0, 100000),
    latency: num(input.latency, 0, 100000),
    jitter: num(input.jitter, 0, 100000),
    verified: Boolean(input.verified),
    client: typeof input.client === 'string' ? input.client.slice(0, 40) : null,
    source: input.source === 'seed' ? 'seed' : 'live',
  };
}

function add(input) {
  const r = sanitize(input);
  if (!r) return null;
  results.push(r);
  if (results.length > MAX_RESULTS) results = results.slice(-MAX_RESULTS);
  save();
  return r;
}

const R_EARTH_KM = 6371;
const rad = (d) => (d * Math.PI) / 180;

function distanceKm(a, b) {
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R_EARTH_KM * Math.asin(Math.sqrt(s));
}

function bearingDeg(a, b) {
  const y = Math.sin(rad(b.lng - a.lng)) * Math.cos(rad(b.lat));
  const x =
    Math.cos(rad(a.lat)) * Math.sin(rad(b.lat)) -
    Math.sin(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.cos(rad(b.lng - a.lng));
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
const compass = (deg) => COMPASS[Math.round(deg / 45) % 8];

// Everything within `radiusKm` of a point, newest first.
function nearby(center, radiusKm = 5, limit = 500) {
  return results
    .filter((r) => distanceKm(center, r) <= radiusKm)
    .sort((a, b) => b.ts - a.ts)
    .slice(0, limit);
}

// A result is only evidence of "the internet right now" for a while. Weight
// decays linearly to zero over `windowMs`.
function freshness(ts, now, windowMs) {
  const age = now - ts;
  if (age < 0) return 1;
  return Math.max(0, 1 - age / windowMs);
}

// Places near `center` whose recent measurements beat `baseline` download
// speed. Scored by how much faster, how fresh and how close they are.
function better(center, baseline, opts = {}) {
  const radiusKm = opts.radiusKm ?? 2;
  const windowMs = opts.windowMs ?? 60 * 60 * 1000;
  const minGain = opts.minGain ?? 1.15; // must be at least 15% faster
  const limit = opts.limit ?? 5;
  const now = opts.now ?? Date.now();

  // Group measurements by ~50 m cells so one busy spot counts once.
  const cells = new Map();
  for (const r of results) {
    if (now - r.ts > windowMs) continue;
    const d = distanceKm(center, r);
    if (d > radiusKm || d < 0.02) continue; // ignore where the user already is
    const key = `${r.lat.toFixed(4)},${r.lng.toFixed(4)}`;
    const w = freshness(r.ts, now, windowMs);
    const cell = cells.get(key) || { key, lat: 0, lng: 0, wsum: 0, down: 0, up: 0, lat_ms: 0, n: 0, latest: 0, distanceKm: d, bearing: 0 };
    cell.lat += r.lat * w;
    cell.lng += r.lng * w;
    cell.down += r.download * w;
    cell.up += (r.upload ?? 0) * w;
    cell.lat_ms += (r.latency ?? 0) * w;
    cell.wsum += w;
    cell.n += 1;
    cell.latest = Math.max(cell.latest, r.ts);
    cells.set(key, cell);
  }

  const out = [];
  for (const c of cells.values()) {
    if (c.wsum <= 0) continue;
    const spot = {
      lat: c.lat / c.wsum,
      lng: c.lng / c.wsum,
      download: c.down / c.wsum,
      upload: c.up / c.wsum,
      latency: c.lat_ms / c.wsum,
      samples: c.n,
      ageMs: now - c.latest,
    };
    if (baseline > 0 && spot.download < baseline * minGain) continue;
    if (baseline <= 0 && spot.download <= 0) continue;
    spot.distanceKm = distanceKm(center, spot);
    spot.bearing = bearingDeg(center, spot);
    spot.direction = compass(spot.bearing);
    spot.gain = baseline > 0 ? spot.download / baseline : null;
    const fresh = freshness(c.latest, now, windowMs);
    spot.score = (spot.download * (0.5 + 0.5 * fresh)) / (1 + spot.distanceKm);
    out.push(spot);
  }
  out.sort((a, b) => b.score - a.score);
  return out.slice(0, limit);
}

function all() {
  return results;
}

function replaceAll(list) {
  results = list.slice(-MAX_RESULTS);
  save();
}

load();

module.exports = { add, nearby, better, all, replaceAll, distanceKm, bearingDeg, sanitize, FILE };
