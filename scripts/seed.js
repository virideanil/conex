'use strict';
// Drops demo measurements around a point so the map and the "better nearby"
// ranking have something to show before real people have tested there.
// Usage: node scripts/seed.js [--lat 41.0082] [--lng 28.9784] [--n 40] [--radius 1.5]
// These rows are tagged source:"seed" and shown as "demo" in the UI.
process.env.CONEX_DATA_DIR = process.env.CONEX_DATA_DIR || require('node:path').join(__dirname, '..', 'data');
const store = require('../server/store');

const args = Object.fromEntries(process.argv.slice(2).map((a, i, arr) => (a.startsWith('--') ? [a.slice(2), arr[i + 1]] : [])).filter((x) => x.length));
const lat = Number(args.lat ?? 41.0082);
const lng = Number(args.lng ?? 28.9784);
const n = Number(args.n ?? 40);
const radiusKm = Number(args.radius ?? 1.5);

const rnd = (a, b) => a + Math.random() * (b - a);
const kmPerDegLat = 111.32;
const kmPerDegLng = 111.32 * Math.cos((lat * Math.PI) / 180);

let added = 0;
for (let i = 0; i < n; i++) {
  const d = Math.sqrt(Math.random()) * radiusKm;
  const bearing = rnd(0, 2 * Math.PI);
  const p = { lat: lat + (Math.cos(bearing) * d) / kmPerDegLat, lng: lng + (Math.sin(bearing) * d) / kmPerDegLng };
  // A handful of "good" hotspots, the rest ordinary.
  const good = Math.random() < 0.25;
  const download = good ? rnd(120, 400) : rnd(3, 60);
  const r = store.add({
    ...p,
    download,
    upload: download * rnd(0.1, 0.6),
    latency: good ? rnd(5, 25) : rnd(20, 120),
    jitter: rnd(1, 15),
    accuracy: rnd(5, 40),
    source: 'seed',
    client: 'seed',
  });
  if (r) { r.ts = Date.now() - rnd(0, 50 * 60 * 1000); added += 1; }
}
store.replaceAll(store.all());
setTimeout(() => console.log(`seeded ${added} demo results around ${lat}, ${lng} -> ${store.FILE}`), 300);
