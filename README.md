# conex

whats the network rate over here

The speed you are at, and where to go for the best, drawn in glyphs. One page in
d/ay's form. Nothing but one sentence crosses the wire: every byte of every
phase, and every ping, is the SHAKE256 output of it:

> love is above all, love thy neighbour as one love god above all and love thyself as thy love god.

## The page

```text
┌─ the page ─────────────────────────────┐
│ ölç                            tr · ☾  │   doors: measure; language, look
│              · · 1.5 km · ·            │
│          ·   0101   ∂∫φ  ·             │   the radar: you at the centre (◎), north up,
│         ·  01  ➤ ····◉  01 ·           │   rings at golden steps, every fresh measurement
│          ·   010   #%@   ·             │   nearby as light on the material,
│              · · · · · ·               │   the best spot ◉ and, at your feet, a 3D glyph
│                                        │   arrow pointing to it, turning with the compass
│                                        │
│                 142                    │   ← the reading
│                mbps                    │
│            ↗ 420 m · 2.3×              │   the way: direction, distance, gain
│         310 mbps · 6 dk önce           │
│          ◎  ·  ↓  ↑  ▶  ◉              │   what is being done: location, ping, down, up, stream, way
│ conex                            ◎ 3   │   the name; who is online
└────────────────────────────────────────┘
```

- The first tap asks for your location, as exactly as the phone can tell. It is
  watched while the page is open and kept nowhere: the server rounds what it
  stores to about 11 m and forgets everything after an hour. `◎ ±12 m` is the
  fix; a ring of `·` at that radius shows it on the radar. Without location
  the test still runs, without the map.
- While it works, the radar shows it: a sweep while locating, a ring leaving
  the centre for each ping, bytes falling in on download and leaving on upload,
  frames falling in on the stream. The step line lights the sign in action with
  its one word.
- The arrow has volume: a top face and sides lit from the upper left, a shadow
  on the ground, laid in glyph cells by their light (binx's ramp). It points
  to the best spot and turns with the phone.
- Done: the reading cuts into place; the way decodes in. The best spot in the
  last hour is the accent on the radar, the others measured better are `○`.
  Others testing right now beat as `◎`.
- Under the way: `↑ 38 · 12→38 ms · 1900 rpm · wifi · ⇅ 84 mb ✓` and three
  bars, `call ▮▮▮▮▯ game ▮▮▮▯▯ stream ▮▮▮▮▮`.
- Lowercase, Turkish and English; koyu and açık. Space measures, Esc stops.

## On a phone

```sh
npm install
npm run phone
```

Builds, starts the server, opens an HTTPS tunnel (location needs https) and
prints the address as a QR code. Scan it; share → add to home screen. It
installs as an app (manifest, icons, a shell service worker).

To host it: the `Dockerfile` builds and runs it on port 3000; or `npm run build`
then `npm start` on any Node ≥ 22.18. Behind a proxy, pass `/ws` as a
WebSocket and do not buffer `/api/download`.

## Develop

```sh
npm run dev      # api on :3000, page on vite's port
npm run check    # typecheck page and server
npm test
npm run seed -- --lat 41.0082 --lng 28.9784   # demo light; run before start
```

## How it measures

After how the serious tests do it: the IETF responsiveness draft, Cloudflare's
test and M-Lab's ndt7.

| step | what happens |
| --- | --- |
| latency | twenty pings on the live channel: 40 bytes, the sentence's digest with a clock, echoed back and checked on return; median is latency, mean step is jitter |
| download | lanes of `GET /api/download`: two to start, two more each second until adding stops helping, up to eight. Rates sampled every 250 ms; the figure is their trimmed mean (lowest 30 % and highest 10 % dropped, so slow start and bursts do not count). Stops when four seconds agree within 5 %, at ten seconds, or at the byte cap |
| upload | the same with `POST /api/upload` lanes of SHAKE256 block 0 repeated; the server checks the message came back intact (`✓`) |
| stream | four seconds of frames pulled as a 4K60 player would: 40 Mbit a second in sixty frames of the sentence, paced by the server. Each frame is timed against its deadline (80 ms of slack, a live player's buffer); the share that came late and the worst stall say whether the line holds a live picture. The pings keep going alongside |
| under load | a probe every 400 ms on the live channel while the lanes run: the median is loaded latency (`12→38 ms`), and 60000 over the 95 % trimmed mean is responsiveness in round trips per minute (`rpm`) |
| bytes | a direction ends at 500 MB once it has run three seconds (150 MB on cellular, 60 MB with data saver on); what moved is shown (`⇅ 84 mb`) |

Block *i* of the stream is `SHAKE256(message ‖ "\n" ‖ i)`, 64 KiB each.
Throughput is between the phone and this server: host it where the people are.

### Fitness

Three bars say how the line will do, from our own rubric (the shape is
Cloudflare's AIM; the numbers are ours):

| use | five when | loses a step for |
| --- | --- | --- |
| call | latency ≤ 30 ms | each of 60 / 100 / 150 ms; loaded − idle over 50 ms (one) or 100 ms (two); jitter over 30 ms; upload under 3 Mbps (one) or 1.5 (two) |
| game | latency ≤ 20 ms | each of 40 / 70 / 100 ms; the same bloat steps; jitter over 15 ms |
| stream | no 4K60 frame late | late frames: under 1 % four, under 5 % three, under 15 % two, else one. Without a stream measurement: download ≥ 50 Mbps is five, each of 25 / 10 / 5 loses one |

### The phone

- Compass: asked from the same tap as location (iOS allows nothing later);
  the radar turns so where the phone points is up, `n` marks north, and the
  way's arrow is relative to you. Android reads `deviceorientationabsolute`,
  iOS `webkitCompassHeading`; headings move in 15° cuts.
- The screen stays on while it measures (Wake Lock), a short tap marks the
  cut (where the phone allows), and the link kind (wifi, cellular) is shown
  and stored where Chrome tells it.

## Where to go

`GET /api/better?lat&lng&download&radius&window` returns spots within `radius`
km measured in the last `window` minutes whose download beats yours by 15 % or
more, gathered by ~11 m cells, scored `download × freshness / (1 + km)`. The
page shows the first as the way: its arrow, distance, gain and link kind.
The radar's scale follows the spots (0.25–2 km), rings at `R/φᵏ`.

## Server

- Nothing is held past the hour; positions are rounded to ~11 m; no client id.
- One address may post 60 results and move 40 GB each way per hour; past that
  it gets 429. `Server-Timing` is sent on every api answer.
- `/ws` carries presence, results, and the ping: a binary frame goes back as
  it came. `/api/stream?mbps&fps&seconds` paces frames of the sentence.

## How it is built

- Vite + TypeScript page; Node runs `server/*.ts` directly; `shared/` is what
  both sides agree on: types, geo, and the arithmetic of a measurement
  (`shared/stats.ts`, tested).
- Tokens, faces, spacing, radii and motion are the d/ay design system
  (`src/tokens.css`): Cormorant Garamond for the reading, IBM Plex Mono for the
  rest, cuts and decodes, no fades. The radar's material is binx's ramp
  (`src/binx.ts`).
