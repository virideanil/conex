# conex

whats the network rate over here

The speed you are at, and where to go for the best, drawn in glyphs. One page in
d/ay's form. Every byte the test moves is the SHAKE256 output of one sentence:

> love is above all, love thy neighbour as one love god above all and love thyself as thy love god.

## The page

```text
┌─ the page ─────────────────────────────┐
│ ölç                            tr · ☾  │   doors: measure; language, look
│              · · 1.5 km · ·            │
│          ·   0101   ∂∫φ  ·             │   the radar: you at the centre (◎), north up,
│         ·  01  ◎ ····◉  01 ·           │   rings at golden steps, every fresh measurement
│          ·   010   #%@   ·             │   nearby as light on the material,
│              · · · · · ·               │   the best spot ◉ and the way to it
│                                        │
│                 142                    │   ← the reading
│                mbps                    │
│            ↗ 420 m · 2.3×              │   the way: direction, distance, gain
│         310 mbps · 6 dk önce           │
│          ◎  ·  ↓  ↑  ◉                 │   what is being done: location, ping, down, up, way
│ conex                            ◎ 3   │   the name; who is online
└────────────────────────────────────────┘
```

- The first tap asks for your location, as exactly as the phone can tell. It is
  watched while the page is open and kept nowhere: the server rounds what it
  stores to about 11 m and forgets everything after an hour. `◎ ±12 m` is the
  fix; a ring of `·` at that radius shows it on the radar. Without location
  the test still runs, without the map.
- While it works, the radar shows it: a sweep while locating, a ring leaving
  the centre for each ping, bytes falling in on download and leaving on upload.
  The step line lights the sign in action with its one word.
- Done: the reading cuts into place; the way decodes in. The best spot in the
  last hour is the accent on the radar, the others measured better are `○`.
  Others testing right now beat as `◎`.
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

## How it is built

- Vite + TypeScript page; Node runs `server/*.ts` directly; `shared/` is what
  both sides agree on.
- Tokens, faces, spacing, radii and motion are the d/ay design system
  (`src/tokens.css`): Cormorant Garamond for the reading, IBM Plex Mono for the
  rest, cuts and decodes, no fades. The radar's material is binx's ramp
  (`src/binx.ts`).
- The test: 12 pings (median, jitter), 8 s of download on 4 lanes, 8 s of
  upload on 4 lanes; block *i* of the stream is `SHAKE256(message ‖ "\n" ‖ i)`,
  and the upload sends block 0 back so the server can verify it (`✓`).
- The way: `GET /api/better` ranks spots within 2 km measured in the last hour
  that beat you by 15 % or more, by `download × freshness / (1 + km)`.
