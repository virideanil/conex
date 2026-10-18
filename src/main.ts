import "@fontsource/cormorant-garamond/500.css";
import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-mono/500.css";
import "./style.css";
import { runTest, type Tick, type TestResult } from "./test.ts";
import { connect } from "./live.ts";
import { createRadar } from "./radar.ts";
import { settings, lang, L, W } from "./words.ts";
import { cut, decode } from "./motion.ts";
import { arrow, distLabel } from "../shared/geo.ts";
import type { BetterResponse, LatLng, Phase, Presence, Result, Spot } from "../shared/types.ts";

const $ = <T extends HTMLElement>(s: string) => document.querySelector<T>(s)!;
const el = {
  field: $<HTMLCanvasElement>(".field"), n: $(".reading__n"), reading: $(".reading"), unit: $(".unit"), way: $(".way"), more: $(".more"),
  measure: $<HTMLButtonElement>(".door--tl"), langBtn: $<HTMLButtonElement>('[data-do="lang"]'), themeBtn: $<HTMLButtonElement>('[data-do="theme"]'),
  online: $(".online"), hint: $(".hint"), doors: $(".doors"),
};

const CLIENT_ID = (() => {
  try { const k = "conex:client"; let v = localStorage.getItem(k); if (!v) { v = Math.random().toString(36).slice(2, 12); localStorage.setItem(k, v); } return v; }
  catch { return Math.random().toString(36).slice(2, 12); }
})();

const state = {
  me: null as (LatLng & { accuracy: number | null }) | null,
  testing: false,
  ctl: null as AbortController | null,
  last: null as TestResult | null,
  results: new Map<string, Result>(),
  spots: [] as Spot[],
  others: new Map<string, Presence>(),
};
const radar = createRadar(el.field);

// ── signs ────────────────────────────────────────────────────────────────
const fmt = (v: number) => (v >= 100 ? Math.round(v).toString() : v >= 10 ? v.toFixed(1) : v.toFixed(2));
const bar = (p: number, n = 8) => { const k = Math.round(p * n); return "▮".repeat(k) + "▯".repeat(n - k); };
const SIGN: Record<Phase, string> = { idle: "", latency: "·", download: "↓", upload: "↑", done: "" };

function words() {
  document.documentElement.lang = lang();
  el.measure.textContent = state.testing ? L(W.stop) : state.last ? L(W.again) : L(W.measure);
  el.langBtn.textContent = lang();
  el.langBtn.setAttribute("aria-label", `${L({ tr: "dil", en: "language" })}: ${L(W.langName)}`);
  el.themeBtn.textContent = settings.get().theme === "dark" ? "☾" : "☀";
  el.themeBtn.setAttribute("aria-label", `${L({ tr: "tema", en: "theme" })}: ${W.theme[lang()][settings.get().theme]}`);
  el.doors.setAttribute("aria-label", L(W.doors));
  el.field.setAttribute("aria-label", L(W.radar));
  renderWay();
}
function theme() {
  document.documentElement.dataset.theme = settings.get().theme;
  $('meta[name="theme-color"]').setAttribute("content", getComputedStyle(document.documentElement).getPropertyValue("--ground").trim());
  cut(document.body);
  radar.draw();
}
settings.on(() => { words(); theme(); });
el.langBtn.addEventListener("click", () => settings.set({ lang: lang() === "tr" ? "en" : "tr" }));
el.themeBtn.addEventListener("click", () => settings.set({ theme: settings.get().theme === "dark" ? "light" : "dark" }));

const hint = (text: string, dead = false) => { el.hint.classList.toggle("is-dead", dead); decode(el.hint, text); };

// ── where you are ────────────────────────────────────────────────────────
function setMe(lat: number, lng: number, accuracy: number | null) {
  const first = !state.me;
  state.me = { lat, lng, accuracy };
  radar.set({ me: state.me });
  if (first) { hint(state.last ? "" : L(W.ready)); refreshNearby(); refreshBetter(); }
  sendPresence(state.testing ? "download" : "idle", 0);
}
if ("geolocation" in navigator) {
  hint(L(W.locating));
  navigator.geolocation.watchPosition(
    (p) => setMe(p.coords.latitude, p.coords.longitude, p.coords.accuracy),
    () => { if (!state.me) hint(L(W.noLocation), true); },
    { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 },
  );
} else hint(L(W.noLocation), true);

// ── the live channel ─────────────────────────────────────────────────────
let lastPresence = 0;
const live = connect((m) => {
  if (m.type === "hello") { setOnline(m.online); m.presence.forEach(upsertOther); }
  else if (m.type === "online") setOnline(m.online);
  else if (m.type === "presence") upsertOther(m.presence);
  else if (m.type === "leave") { state.others.delete(m.id); radar.set({ others: [...state.others.values()] }); }
  else if (m.type === "result") { addResult(m.result); if (!state.testing) refreshBetter(); }
}, (open) => { if (!open) { el.online.textContent = "---"; el.online.classList.add("is-dead"); } });

function setOnline(n: number) {
  el.online.classList.remove("is-dead");
  el.online.textContent = `◎ ${n}`;
  el.online.parentElement!.setAttribute("aria-label", `${n} ${L(W.online)}`);
}
function sendPresence(phase: Phase, value: number, force = false) {
  if (!state.me) return;
  const now = Date.now();
  if (!force && now - lastPresence < 400) return;
  lastPresence = now;
  live.send({ type: "presence", id: CLIENT_ID, lat: state.me.lat, lng: state.me.lng, phase, value });
}
function upsertOther(p: Presence) {
  if (p.id === CLIENT_ID) return;
  if (p.phase === "idle" || p.phase === "done") state.others.delete(p.id); else state.others.set(p.id, p);
  radar.set({ others: [...state.others.values()] });
}
setInterval(() => {
  const before = state.others.size;
  for (const [id, o] of state.others) if (Date.now() - o.ts > 20000) state.others.delete(id);
  if (state.others.size !== before) radar.set({ others: [...state.others.values()] });
}, 5000);

// ── the light nearby, and the way ────────────────────────────────────────
function addResult(r: Result) {
  if (state.results.has(r.id)) return;
  state.results.set(r.id, r);
  radar.set({ results: [...state.results.values()] });
}
async function refreshNearby() {
  if (!state.me) return;
  try {
    const list: Result[] = await (await fetch(`/api/results?lat=${state.me.lat}&lng=${state.me.lng}&radius=3`, { cache: "no-store" })).json();
    list.forEach((r) => state.results.set(r.id, r));
    radar.set({ results: [...state.results.values()] });
  } catch { /* no signal: the radar stays as it was */ }
}
async function refreshBetter() {
  if (!state.me) return;
  const baseline = state.last?.download ?? 0;
  try {
    const data: BetterResponse = await (await fetch(`/api/better?lat=${state.me.lat}&lng=${state.me.lng}&download=${baseline}&radius=2&window=60`, { cache: "no-store" })).json();
    state.spots = data.spots;
    const far = Math.max(0, ...state.spots.map((s) => s.distanceKm));
    radar.set({ spots: state.spots, radiusKm: far > 0 ? Math.min(2, Math.max(0.25, far * 1.3)) : 1, windowMs: data.windowMin * 60e3 });
  } catch { state.spots = []; }
  renderWay();
}
function renderWay() {
  const best = state.spots[0];
  if (state.testing) return;
  if (best) {
    el.way.classList.remove("is-dim");
    decode(el.way, `${arrow(best.bearing)} ${distLabel(best.distanceKm)}${best.gain ? ` · ${best.gain.toFixed(1)}×` : ""}`);
    decode(el.more, `${fmt(best.download)} mbps · ${L(W.ago)(Math.round(best.ageMs / 60000))}`);
  } else {
    el.way.classList.add("is-dim");
    decode(el.way, !state.me ? "" : state.last ? L(W.best) : L(W.none));
    if (!state.last) el.more.textContent = "";
  }
}

// ── the test ─────────────────────────────────────────────────────────────
function tick(t: Tick) {
  if (t.phase === "done") return;
  el.n.textContent = fmt(t.value);
  el.unit.innerHTML = `${SIGN[t.phase]} ${t.phase === "latency" ? "ms" : "mbps"}  <b>${bar(t.progress)}</b>`;
  sendPresence(t.phase, t.value);
}
async function toggle() {
  if (state.testing) { state.ctl?.abort(); return; }
  state.testing = true;
  state.ctl = new AbortController();
  words();
  el.reading.classList.add("is-live");
  cut(el.reading);
  el.way.textContent = ""; el.more.textContent = ""; hint("");
  state.spots = [];
  radar.set({ testing: true, spots: [] });
  try {
    const r = await runTest(tick, state.ctl.signal);
    state.last = r;
    el.n.textContent = fmt(r.download);
    cut(el.reading);
    el.unit.textContent = "mbps";
    decode(el.more, `↑ ${fmt(r.upload)} · ${Math.round(r.latency)} ms${r.verified ? " · ✓" : ""}`);
    if (state.me) {
      const body = { ...r, lat: state.me.lat, lng: state.me.lng, accuracy: state.me.accuracy, verified: Boolean(r.verified), client: CLIENT_ID };
      const res = await fetch("/api/results", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (res.ok) addResult(await res.json());
    }
  } catch (err) {
    el.n.textContent = state.last ? fmt(state.last.download) : "—";
    el.unit.textContent = "mbps";
    if (!(err instanceof DOMException && err.name === "AbortError")) hint(L(W.failed), true);
  } finally {
    state.testing = false;
    state.ctl = null;
    el.reading.classList.remove("is-live");
    radar.set({ testing: false });
    words();
    sendPresence("idle", 0, true);
    await refreshBetter();
  }
}
el.measure.addEventListener("click", toggle);
addEventListener("keydown", (e) => {
  if (e.key === "Escape" && state.testing) state.ctl?.abort();
  if (e.key === " " && e.target === document.body) { e.preventDefault(); toggle(); }
});

// ── boot ─────────────────────────────────────────────────────────────────
words();
theme();
document.fonts.ready.then(() => radar.draw());
if (import.meta.env.PROD && "serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});
