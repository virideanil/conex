# conex

whats the network rate over here

The speed you are at, and where to go for the best, drawn in glyphs. One page,
in d/ay's form: a glyph radar above the horizon, the reading below it in the
serif, the way to the best spot in the one accent, a door in each corner.
Nothing else is shown.

Every byte the test moves is the SHAKE256 output of one sentence, so the
traffic itself says it:

> love is above all, love thy neighbour as one love god above all and love thyself as thy love god.

## The page

```text
┌─ the page ─────────────────────────────┐
│ ölç                            tr · ☾  │   doors: measure; language, look
│              · · 1.5 km · ·            │
│          ·   0101   ∂∫φ  ·             │   the radar: you at the centre (◎), north up,
│         ·  01  ◎ ····◉  01 ·           │   rings at golden steps, every fresh measurement
│          ·   010   #%@   ·             │   nearby as light on the material (binx ramp),
│              · · · · · ·               │   the best spot ◉ with the way to it
│                                        │
│                 142                    │   ← horizon, 61.8%: the reading, serif
│                mbps                    │      the unit, tagline role
│            ↗ 420 m · 2.3×              │      the way: direction, distance, gain (accent)
│         310 mbps · 6 dk önce           │      small print
│ conex                            ◎ 3   │   doors: the name; who is online
└────────────────────────────────────────┘
```

- **While measuring** you are the accent (◉ beating at the centre), the reading is
  live, the unit row shows the phase sign and a glyph bar: `↓ mbps ▮▮▮▯▯▯▯▯`.
- **Done**: the reading cuts into place (channels part for two frames, then it
  stands), the way decodes in. The best spot nearby in the last hour is the
  accent on the radar; the others measured better are `○`.
- **Others testing right now** show as `◎` beating where they stand; their result
  lands as light when they finish.
- Lowercase, in Turkish and English; the browser's language picks until you do.
  Koyu and açık (dark and light). Keys: Space measures, Esc stops.
- Phones: installable (manifest, icons, a shell service worker), 44 px doors,
  no horizontal scroll, the reading sized to the width.

## Run

```sh
npm install
npm run dev          # api on :3000, page on vite's port (proxied)
npm run build        # typecheck both sides, then vite build → dist/
npm start            # serves dist/ and the api on :3000
npm test             # node --test
npm run seed -- --lat 41.0082 --lng 28.9784   # demo light; run before start
```

Node ≥ 22.18: the server runs its TypeScript directly (`node server/index.ts`).
Results live in `data/results.json` (`CONEX_DATA_DIR` moves it).

## Design system

The look is the d/ay design system (Glyph): `src/tokens.css` carries its tokens
(ground, ink, ink-dim, frame, edge, glyph, accent, the cut's split colours; φ
spacing; square radii; motion as cuts). Faces are Cormorant Garamond 500 for
the reading and IBM Plex Mono 400/500 for everything else, self-hosted from
fontsource. The radar's material is binx's house ramp (binary in shadow,
mathematics in the half-light, dense where the light is full), re-stated in
`src/binx.ts`. Motion: `src/motion.ts` has the cut and the decode; nothing fades.

## How the test works

| phase | what happens |
| --- | --- |
| latency | 12 tiny `GET /api/ping` round trips; median is latency, mean delta is jitter |
| download | 4 parallel streams of `GET /api/download?bytes=…` for 8 s; block *i* = `SHAKE256(message ‖ "\n" ‖ i)`, 64 KiB each |
| upload | block 0 fetched once, repeated into 4 MiB bodies, `POST /api/upload` on 4 lanes for 8 s; the server checks the first block still equals block 0 (`✓` in the small print) |

The first second of each throughput phase is warm-up, excluded from the figure.
Throughput is between the browser and this server: host it where the people are.

## Where to go

`GET /api/better?lat&lng&download&radius&window` returns spots within `radius`
km measured in the last `window` minutes whose download beats yours by 15 % or
more, gathered by ~11 m cells, scored `download × freshness / (1 + km)`. The
page shows the first as the way: its arrow (eight winds), distance and gain.
The radar's scale follows the spots (0.25–2 km), rings at `R/φᵏ`.

## Layout

```text
index.html        the shell
src/main.ts       wires the page: doors, words, location, live channel, the test
src/radar.ts      the glyph radar (canvas, mono cells, binx ramp)
src/test.ts       the speed test engine
src/live.ts       the WebSocket client
src/words.ts      tr/en words and the two settings
src/motion.ts     cut, decode
src/binx.ts       the ramp
src/tokens.css    d/ay tokens, both looks
src/style.css     the page's roles
shared/types.ts   messages both sides agree on
shared/geo.ts     distance, bearing, arrows, the flat frame
server/index.ts   express + ws: bytes, results, live channel, dist/
server/payload.ts SHAKE256 stream
server/store.ts   results, nearby, better
public/           manifest, icons, service worker
```

Behind a reverse proxy, forward `/ws` as a WebSocket and disable response
buffering for `/api/download`.
