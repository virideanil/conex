'use strict';
process.env.CONEX_DATA_DIR = require('node:fs').mkdtempSync(require('node:path').join(require('node:os').tmpdir(), 'conex-test-'));
const test = require('node:test');
const assert = require('node:assert/strict');
const store = require('../server/store');

const here = { lat: 41.0, lng: 29.0 };
const shift = (km, dir) => ({ lat: here.lat + (dir === 'N' ? km / 111.32 : 0), lng: here.lng + (dir === 'E' ? km / (111.32 * Math.cos((here.lat * Math.PI) / 180)) : 0) });

test('distance and bearing are sane', () => {
  const n1 = shift(1, 'N');
  assert.ok(Math.abs(store.distanceKm(here, n1) - 1) < 0.01);
  assert.ok(Math.abs(store.bearingDeg(here, n1)) < 1);
  assert.ok(Math.abs(store.bearingDeg(here, shift(1, 'E')) - 90) < 1);
});

test('sanitize rejects junk and clamps values', () => {
  assert.equal(store.sanitize({ lat: 'x', lng: 1, download: 1 }), null);
  assert.equal(store.sanitize({ lat: 1, lng: 1 }), null);
  const r = store.sanitize({ lat: 1, lng: 1, download: -5, source: 'evil', client: 'a'.repeat(100) });
  assert.equal(r.download, 0);
  assert.equal(r.source, 'live');
  assert.equal(r.client.length, 40);
});

test('better() ranks fresh, close, faster spots and ignores the stale and the slow', () => {
  store.replaceAll([]);
  const now = Date.now();
  const fast = store.add({ ...shift(0.3, 'N'), download: 200, upload: 50, latency: 10 });
  const slow = store.add({ ...shift(0.2, 'E'), download: 20, upload: 5, latency: 50 });
  const far = store.add({ ...shift(5, 'N'), download: 500, upload: 50, latency: 10 });
  const stale = store.add({ ...shift(0.1, 'N'), download: 900, upload: 50, latency: 10 });
  stale.ts = now - 3 * 60 * 60 * 1000;
  assert.ok(fast && slow && far && stale);

  const spots = store.better(here, 50, { now, radiusKm: 2, windowMs: 60 * 60 * 1000 });
  assert.equal(spots.length, 1);
  assert.ok(Math.abs(spots[0].download - 200) < 1e-9);
  assert.equal(spots[0].direction, 'N');
  assert.ok(Math.abs(spots[0].distanceKm - 0.3) < 0.01);
  assert.ok(Math.abs(spots[0].gain - 4) < 1e-9);

  // With no baseline, anything fresh and nearby counts.
  assert.equal(store.better(here, 0, { now, radiusKm: 2 }).length, 2);
  // A fast baseline leaves nothing better.
  assert.equal(store.better(here, 1000, { now, radiusKm: 2 }).length, 0);
});

test('nearby returns newest first within radius', () => {
  store.replaceAll([]);
  const a = store.add({ ...shift(0.5, 'N'), download: 1 });
  const b = store.add({ ...shift(0.5, 'E'), download: 2 });
  b.ts = a.ts + 10;
  store.add({ ...shift(20, 'N'), download: 3 });
  const list = store.nearby(here, 5);
  assert.deepEqual(list.map((r) => r.download), [2, 1]);
});
