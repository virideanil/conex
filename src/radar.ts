// The radar: where nearby the internet is, as light on the world's material.
// You stand at the centre, north up. Every fresh measurement nearby is a
// light whose brightness is its speed; the material renders that light as
// binx glyphs (binary in shadow, mathematics in the half-light, dense where
// it is full). Rings at golden steps give the scale. The one accent marks
// the one thing: you while you measure, else the best spot and the way to it.
import { glyph, BINX } from "./binx.ts";
import { PHI, localKm, distLabel } from "../shared/geo.ts";
import type { LatLng, Presence, Result, Spot } from "../shared/types.ts";

export type Activity = "none" | "locate" | "latency" | "download" | "upload" | "stream";

export type RadarState = {
  me: (LatLng & { accuracy?: number | null }) | null;
  testing: boolean;
  activity: Activity;
  results: Result[];
  spots: Spot[];
  others: Presence[];
  radiusKm: number;
  windowMs: number;
  /** Where the phone points, degrees from north, or null: then north is up. */
  heading: number | null;
};

const css = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

type V3 = [number, number, number];
const norm = (v: V3): V3 => { const l = Math.hypot(...v) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
/** Whether (x, y) lies inside the polygon, by ray casting. */
function inside(poly: [number, number][], x: number, y: number): boolean {
  let hit = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}

// The arrow's outline in its own frame: forward is +y, counter-clockwise, in units of its length.
const ARROW: [number, number][] = [[-0.16, -0.5], [0.16, -0.5], [0.16, 0.06], [0.44, 0.06], [0, 0.5], [-0.44, 0.06], [-0.16, 0.06]];
const TILT = 0.6; // how far the view leans from straight down: the arrow lies on the ground, seen from above and the south
const LIGHT = norm([-0.45, 0.35, 0.82]); // from the upper left, above
const VIEW: V3 = [0, -Math.sin(TILT), Math.cos(TILT)];
// quadrant blocks by bits: 1 top-left, 2 top-right, 4 bottom-left, 8 bottom-right (binx)
const QUAD = [" ", "▘", "▝", "▀", "▖", "▌", "▞", "▛", "▗", "▚", "▐", "▜", "▄", "▙", "▟", "█"];

export function createRadar(canvas: HTMLCanvasElement) {
  const ctx = canvas.getContext("2d")!;
  let st: RadarState = { me: null, testing: false, activity: "none", results: [], spots: [], others: [], radiusKm: 1, windowMs: 3600e3, heading: null };
  let step = 0; // the activity's clock: one jump every 420 ms
  let W = 0, H = 0, dpr = 1, cw = 6, ch = 10, cols = 0, rows = 0, cx = 0, cy = 0, pxPerKm = 1;
  let lum: Float32Array = new Float32Array(0), lumStale = true;
  let beat = false;

  function resize() {
    dpr = Math.min(2, devicePixelRatio || 1);
    W = innerWidth; H = innerHeight;
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ch = Math.max(5, Math.min(9, H / 96)); cw = ch * 0.6; // mono cells, never stretched
    cols = Math.ceil(W / cw); rows = Math.ceil(H / ch);
    // the centre at 1 − 1/φ of the height; the outer ring reaches the horizon, or the gutter
    cx = W / 2; cy = H * (1 - 1 / PHI);
    const R = Math.min(H / PHI - cy - ch, W / 2 - 16 - cw);
    pxPerKm = Math.max(1, R) / st.radiusKm;
    lum = new Float32Array(cols * rows);
    lumStale = true;
  }

  // the world turns so that where the phone points is up
  const turn = (x: number, y: number) => {
    if (st.heading === null) return { x, y };
    const h = (-st.heading * Math.PI) / 180, c = Math.cos(h), s = Math.sin(h);
    return { x: x * c - y * s, y: x * s + y * c };
  };
  const toCell = (p: LatLng) => {
    const l = localKm(st.me!, p), k = turn(l.x, l.y);
    return { x: (cx + k.x * pxPerKm) / cw, y: (cy - k.y * pxPerKm) / ch };
  };

  /** Each measurement is a light: its speed is its brightness, its age its reach. */
  function relight() {
    lum.fill(0);
    if (!st.me) { lumStale = false; return; }
    const now = Date.now();
    const maxDown = Math.max(1, ...st.results.map((r) => r.download));
    const sigma = 2.1;
    for (const r of st.results) {
      const fresh = Math.max(0, 1 - (now - r.ts) / st.windowMs);
      if (fresh <= 0) continue;
      // brightness: speed on a log scale against the brightest nearby, dimming slowly with age
      const w = Math.sqrt(fresh) * (Math.log10(1 + r.download) / Math.log10(1 + maxDown)) ** 0.7;
      const c = toCell(r);
      const x0 = Math.max(0, Math.floor(c.x - 5)), x1 = Math.min(cols - 1, Math.ceil(c.x + 5));
      const y0 = Math.max(0, Math.floor(c.y - 5)), y1 = Math.min(rows - 1, Math.ceil(c.y + 5));
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
        const dx = (x + 0.5 - c.x) * 0.6, dy = (y + 0.5 - c.y); // cells are 0.6 as wide as tall
        const d2 = (dx * dx + dy * dy) / 0.36;
        lum[y * cols + x] = Math.min(1, lum[y * cols + x] + w * Math.exp(-d2 / (2 * sigma * sigma)));
      }
    }
    lumStale = false;
  }

  const put = (text: string, x: number, y: number, color: string, weight = 400) => {
    ctx.fillStyle = color;
    ctx.font = `${weight} ${ch}px "IBM Plex Mono", Menlo, Consolas, monospace`;
    ctx.fillText(text, (x + 0.5) * cw, (y + 0.5) * ch);
  };

  function draw() {
    if (lumStale) relight();
    ctx.clearRect(0, 0, W, H);
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    const ink = css("--ink"), dim = css("--ink-dim"), frame = css("--frame"), accent = css("--accent"), mat = css("--glyph");
    const R = st.radiusKm * pxPerKm;

    // rings at golden steps, as dots; their distance written at the top
    for (let k = 0; k < 4; k++) {
      const r = R / PHI ** k, n = Math.max(24, Math.round((2 * Math.PI * r) / ch));
      for (let i = 0; i < n; i++) {
        const a = (i / n) * 2 * Math.PI;
        put("·", (cx + Math.cos(a) * r) / cw - 0.5, (cy + Math.sin(a) * r) / ch - 0.5, frame);
      }
      put(distLabel(st.radiusKm / PHI ** k), cx / cw - 0.5, (cy - r) / ch - 1.3, dim);
    }

    if (!st.me) return;

    // the light on the material
    for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
      const l = lum[y * cols + x];
      if (l < BINX.cuts[0]) continue;
      ctx.globalAlpha = 0.35 + 0.65 * l;
      put(glyph(BINX, l, x, y), x, y, mat);
    }
    ctx.globalAlpha = 1;

    // how exact the fix is: a ring of · at the accuracy radius, when it fits inside the outer ring
    const acc = st.me.accuracy ?? 0;
    if (acc > 0 && acc / 1000 < st.radiusKm) {
      const r = Math.max(ch, (acc / 1000) * pxPerKm), n = Math.max(8, Math.round((2 * Math.PI * r) / ch));
      for (let i = 0; i < n; i++) { const a = (i / n) * 2 * Math.PI; put("·", (cx + Math.cos(a) * r) / cw - 0.5, (cy + Math.sin(a) * r) / ch - 0.5, dim); }
    }

    // what is being done, as glyphs that jump
    if (st.activity === "locate") {
      // a sweep: one spoke of · turning a twelfth each step
      const a = (step % 12) * (Math.PI / 6) - Math.PI / 2, n = Math.round(R / ch);
      for (let i = 2; i <= n; i++) put("·", (cx + Math.cos(a) * i * ch) / cw - 0.5, (cy + Math.sin(a) * i * ch) / ch - 0.5, accent);
    } else if (st.activity === "latency") {
      // a ping: a ring leaving the centre, one of five radii each step
      const r = ((step % 5) + 1) * (R / 5.5), n = Math.max(12, Math.round((2 * Math.PI * r) / ch));
      for (let i = 0; i < n; i++) { const a = (i / n) * 2 * Math.PI; put("·", (cx + Math.cos(a) * r) / cw - 0.5, (cy + Math.sin(a) * r) / ch - 0.5, accent); }
    } else if (st.activity === "stream") {
      // frames: ▮ falling in on twelve spokes, one cell a step
      const n = Math.round(R / ch);
      for (let k = 0; k < 12; k++) {
        const a = (k / 12) * 2 * Math.PI;
        for (let j = 0; j < 2; j++) {
          const i = n - ((step * 2 + k * 2 + j * 7) % n);
          if (i < 2) continue;
          put("▮", (cx + Math.cos(a) * i * ch) / cw - 0.5, (cy + Math.sin(a) * i * ch) / ch - 0.5, accent);
        }
      }
    } else if (st.activity === "download" || st.activity === "upload") {
      // the bytes: 0 and 1 on sixteen spokes, falling in (download) or leaving (upload), one cell a step
      const inward = st.activity === "download", n = Math.round(R / ch);
      for (let k = 0; k < 16; k++) {
        const a = (k / 16) * 2 * Math.PI;
        for (let j = 0; j < 3; j++) {
          const t = (step + k * 3 + j * 5) % n, i = inward ? n - t : t;
          if (i < 2) continue;
          put((i + k + j) % 2 ? "1" : "0", (cx + Math.cos(a) * i * ch) / cw - 0.5, (cy + Math.sin(a) * i * ch) / ch - 0.5, accent);
        }
      }
    }

    // others, mid-test: ◎ that beats
    for (const o of st.others) {
      const c = toCell(o);
      if (Math.hypot((c.x * cw - cx), (c.y * ch - cy)) > R) continue;
      put(beat ? "◎" : "○", c.x - 0.5, c.y - 0.5, ink);
    }

    // the ranked spots: the best in the accent with the way to it, the rest as rings
    st.spots.forEach((s, i) => {
      const c = toCell(s);
      if (i === 0 && !st.testing) {
        const me = { x: cx / cw - 0.5, y: cy / ch - 0.5 }, n = Math.max(2, Math.round(Math.hypot((c.x - me.x) * 0.6, c.y - me.y)));
        for (let j = 1; j < n; j++) put("·", me.x + ((c.x - 0.5 - me.x) * j) / n, me.y + ((c.y - 0.5 - me.y) * j) / n, accent);
        put("◉", c.x - 0.5, c.y - 0.5, accent, 500);
      } else {
        put("○", c.x - 0.5, c.y - 0.5, dim);
      }
    });

    // you: a 3D arrow of glyphs at your feet, pointing the way, when there is one; else the sign
    const best = st.spots[0];
    if (best && !st.testing) arrow3d((best.bearing - (st.heading ?? 0) + 360) % 360, R * 0.72, accent, dim, css("--ground"));
    else put(st.testing ? (beat ? "◉" : "◎") : "◎", cx / cw - 0.5, cy / ch - 0.5, st.testing ? accent : ink, 500);
  }

  /** An arrow with volume: a solid top, flat-shaded sides, a shadow; each cell split in four (binx's quadrant material) so slanted edges stay crisp. */
  function arrow3d(yawDeg: number, L: number, accent: string, dim: string, ground: string) {
    const yaw = (yawDeg * Math.PI) / 180, T = 0.16 * L;
    const cy_ = Math.cos(yaw), sy_ = Math.sin(yaw);
    const w: [number, number][] = ARROW.map(([x, y]) => [(x * cy_ + y * sy_) * L, (-x * sy_ + y * cy_) * L]);
    const cell = (x: number, y: number, z: number): [number, number] => [(cx + x) / cw, (cy - y * Math.cos(TILT) - z * Math.sin(TILT)) / ch];
    const sx = -LIGHT[0] * T * 1.6, sy = -LIGHT[1] * T * 1.6;
    const shadow = w.map(([x, y]) => cell(x + sx, y + sy, 0));
    const top = w.map(([x, y]) => cell(x, y, T));
    const sides: { poly: [number, number][]; shade: number }[] = [];
    for (let i = 0; i < w.length; i++) {
      const a = w[i], b = w[(i + 1) % w.length], out = norm([b[1] - a[1], -(b[0] - a[0]), 0]);
      if (dot(out, VIEW) <= 0) continue;
      sides.push({ poly: [cell(a[0], a[1], 0), cell(b[0], b[1], 0), cell(b[0], b[1], T), cell(a[0], a[1], T)], shade: Math.max(0, dot(out, LIGHT)) });
    }
    const all = [...shadow, ...top, ...sides.flatMap((f) => f.poly)];
    const x0 = Math.max(0, Math.floor(Math.min(...all.map((p) => p[0])))), x1 = Math.min(cols - 1, Math.ceil(Math.max(...all.map((p) => p[0]))));
    const y0 = Math.max(0, Math.floor(Math.min(...all.map((p) => p[1])))), y1 = Math.min(rows - 1, Math.ceil(Math.max(...all.map((p) => p[1]))));
    const Q = [0.25, 0.75];
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      let tb = 0, sb = 0, hb = 0, shade = 0, n = 0;
      for (let j = 0; j < 2; j++) for (let i = 0; i < 2; i++) {
        const px = x + Q[i], py = y + Q[j], bit = 1 << (j * 2 + i);
        if (inside(top, px, py)) { tb |= bit; continue; }
        const side = sides.find((f) => inside(f.poly, px, py));
        if (side) { sb |= bit; shade += side.shade; n += 1; continue; }
        if (inside(shadow, px, py)) hb |= bit;
      }
      if (!(tb | sb | hb)) continue;
      ctx.globalAlpha = 1;
      ctx.fillStyle = ground;
      ctx.fillRect(x * cw, y * ch, cw + 0.5, ch + 0.5);
      if (hb) { ctx.globalAlpha = 0.9; put(QUAD[hb] === "█" ? "░" : QUAD[hb], x, y, dim, 500); }
      if (sb) { ctx.globalAlpha = 0.35 + 0.35 * (shade / n); put(QUAD[sb], x, y, accent, 500); }
      if (tb) { ctx.globalAlpha = 0.95; put(QUAD[tb], x, y, accent, 500); }
    }
    ctx.globalAlpha = 1;
  }

  // the beat: a step every 420 ms, never a fade
  const still = matchMedia("(prefers-reduced-motion: reduce)");
  setInterval(() => {
    if (still.matches && st.activity === "none" && !st.testing) return;
    beat = !beat; step += 1;
    if (st.testing || st.others.length || st.activity !== "none") draw();
  }, 420);

  addEventListener("resize", () => { resize(); draw(); });
  resize();

  return {
    set(p: Partial<RadarState>) {
      const scaleChanged = p.radiusKm !== undefined && p.radiusKm !== st.radiusKm;
      st = { ...st, ...p };
      if (scaleChanged) resize();
      if (p.me !== undefined || p.results || scaleChanged || p.windowMs || p.heading !== undefined) lumStale = true;
      draw();
    },
    draw,
  };
}
