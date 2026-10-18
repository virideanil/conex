// Demo measurements around a point, so the radar has light on it before anyone
// has tested there. Run with the server stopped. Rows are tagged source "seed".
// node scripts/seed.ts [--lat 41.0082] [--lng 28.9784] [--n 40] [--radius 1.5]
import * as store from "../server/store.ts";

const argv = process.argv.slice(2);
const arg = (k: string, d: number) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? Number(argv[i + 1]) : d; };
const lat = arg("lat", 41.0082), lng = arg("lng", 28.9784), n = arg("n", 40), radiusKm = arg("radius", 1.5);

const rnd = (a: number, b: number) => a + Math.random() * (b - a);
const kmPerDegLat = 111.32, kmPerDegLng = 111.32 * Math.cos((lat * Math.PI) / 180);

let added = 0;
for (let i = 0; i < n; i++) {
  const d = Math.sqrt(Math.random()) * radiusKm, b = rnd(0, 2 * Math.PI);
  const good = Math.random() < 0.25, download = good ? rnd(120, 400) : rnd(3, 60);
  const r = store.add({
    lat: lat + (Math.cos(b) * d) / kmPerDegLat, lng: lng + (Math.sin(b) * d) / kmPerDegLng,
    download, upload: download * rnd(0.1, 0.6), latency: good ? rnd(5, 25) : rnd(20, 120), jitter: rnd(1, 15),
    loaded: good ? rnd(10, 40) : rnd(40, 300), rpm: good ? rnd(1500, 4000) : rnd(150, 1200), late: good ? 0 : rnd(0, 0.2), net: Math.random() < 0.5 ? "wifi" : "cellular",
    accuracy: rnd(5, 40), source: "seed",
  });
  if (r) { r.ts = Date.now() - rnd(0, 50 * 60 * 1000); added += 1; }
}
store.replaceAll(store.all());
setTimeout(() => console.log(`seeded ${added} demo results around ${lat}, ${lng} → ${store.FILE}`), 300);
