// The radar: where nearby the internet is, as light on the world's material.
// You stand at the centre, north up. Every fresh measurement nearby is a
// light whose brightness is its speed; the material renders that light as
// binx glyphs (binary in shadow, mathematics in the half-light, dense where
// it is full). Rings at golden steps give the scale. The one accent marks
// the one thing: you while you measure, else the best spot and the way to it.
import { glyph, BINX } from "./binx.ts";
import { PHI, localKm, distLabel } from "../shared/geo.ts";
import type { LatLng, Presence, Result, Spot } from "../shared/types.ts";

export type RadarState = {
  me: LatLng | null;
  testing: boolean;
  results: Result[];
  spots: Spot[];
  others: Presence[];
  radiusKm: number;
  windowMs: number;
};

const css = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

export function createRadar(canvas: HTMLCanvasElement) {
  const ctx = canvas.getContext("2d")!;
  let st: RadarState = { me: null, testing: false, results: [], spots: [], others: [], radiusKm: 1, windowMs: 3600e3 };
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

  const toCell = (p: LatLng) => {
    const k = localKm(st.me!, p);
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

    // you
    put(st.testing ? (beat ? "◉" : "◎") : "◎", cx / cw - 0.5, cy / ch - 0.5, st.testing ? accent : ink, 500);
  }

  // the beat: a step every 420 ms, never a fade
  const still = matchMedia("(prefers-reduced-motion: reduce)");
  setInterval(() => { if (still.matches && !st.testing) return; beat = !beat; if (st.testing || st.others.length) draw(); }, 420);

  addEventListener("resize", () => { resize(); draw(); });
  resize();

  return {
    set(p: Partial<RadarState>) {
      const scaleChanged = p.radiusKm !== undefined && p.radiusKm !== st.radiusKm;
      st = { ...st, ...p };
      if (scaleChanged) resize();
      if (p.me !== undefined || p.results || scaleChanged || p.windowMs) lumStale = true;
      draw();
    },
    draw,
  };
}
