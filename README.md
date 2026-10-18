# conex

whats the network rate over here

A live speed test on a map. Every byte the test moves is the SHAKE256 output
of one sentence, so the traffic itself says it:

> love is above all, love thy neighbour as one love god above all and love thyself as thy love god.

When your test finishes, the map shows where nearby the internet was measured
faster in the last hour, ranked by how much faster, how fresh and how close.
Other people testing right now show up on the map as they go.

## Run

```sh
npm install
npm start          # http://localhost:3000
```

Optional, before starting the server, to see the ranking before anyone has tested near you:

```sh
npm run seed -- --lat 41.0082 --lng 28.9784 --n 40
```

Seeded rows are tagged `source: "seed"` and labelled "demo" in the UI.
Results live in `data/results.json` (set `CONEX_DATA_DIR` to move it).

```sh
npm test
```

## How the test works

| Phase | What happens |
| --- | --- |
| latency | 12 tiny `GET /api/ping` round trips. Median is latency, mean delta is jitter. |
| download | 4 parallel streams of `GET /api/download?bytes=…` for 8 s. The server streams 64 KiB blocks, block *i* = `SHAKE256(message ‖ "\n" ‖ i)`. |
| upload | The client fetches block 0 once, repeats it into 4 MiB bodies and `POST /api/upload`s them on 4 lanes for 8 s. The server checks the first block still equals block 0, so "verified: yes" means the message survived the trip. |

The first second of each throughput phase is warm-up and excluded from the
final figure. The gauge shows a rolling 0.7 s instantaneous rate.

## Real time

`/ws` is a WebSocket. Clients mid-test send their position, phase and current
reading every ~400 ms; the server fans it out so everyone sees pulsing markers
with live numbers. Finished results are broadcast too, and the "better nearby"
panel refreshes when a new result lands.

## API

| Route | Purpose |
| --- | --- |
| `GET /api/info` | message, digest, block size |
| `GET /api/ping` | 204, no-store |
| `GET /api/download?bytes=N` | N bytes of SHAKE256 output (max 256 MiB) |
| `POST /api/upload` | counts bytes, returns `{bytes, ms, verified}` |
| `POST /api/results` | `{lat, lng, download, upload, latency, jitter, accuracy, verified, client}` |
| `GET /api/results?lat&lng&radius` | results near a point (km), newest first |
| `GET /api/better?lat&lng&download&radius&window` | spots within `radius` km measured in the last `window` minutes whose download beats `download` by ≥15 %, scored by `download × freshness / (1 + km)` |

Location comes from the browser's geolocation (live, `watchPosition`). If that
is unavailable, tap the map to say where you are.

## Notes

- Throughput is measured between the browser and *this* server, so host it
  near the people using it (or on the network you want to measure).
- Behind a reverse proxy, forward `/ws` as a WebSocket and disable response
  buffering for `/api/download`.
