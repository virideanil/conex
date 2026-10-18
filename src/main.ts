import "@fontsource/cormorant-garamond/500.css";
import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-mono/500.css";
import "./style.css";
import { runTest, type Tick, type TestResult } from "./test.ts";
import { askCompass, awake, tap, netKind, wantsLight } from "./sensors.ts";
import { fitness } from "../shared/stats.ts";
import { connect } from "./live.ts";
import { createRadar, type Activity } from "./radar.ts";
import { settings, lang, L, W, type Step } from "./words.ts";
import { cut, decode } from "./motion.ts";
import { arrow, distLabel } from "../shared/geo.ts";
import type { BetterResponse, LatLng, Phase, Presence, Result, Spot } from "../shared/types.ts";

const $ = <T extends HTMLElement>(s: string) => document.querySelector<T>(s)!;
const el = {
  field: $<HTMLCanvasElement>(".field"), n: $(".reading__n"), reading: $(".reading"), unit: $(".unit"), way: $(".way"), more: $(".more"),
  measure: $<HTMLButtonElement>(".door--tl"), langBtn: $<HTMLButtonElement>('[data-do="lang"]'), themeBtn: $<HTMLButtonElement>('[data-do="theme"]'),
  online: $(".online"), hint: $(".hint"), doors: $(".doors"), steps: $(".steps"), fit: $(".fit"),
};
const stepEl = (k: Step) => el.steps.querySelector<HTMLElement>(`[data-step="${k}"]`)!;
const STEPS: Step[] = ["locate", "latency", "download", "upload", "stream", "way"];

const CLIENT_ID = (() => {
  try { const k = "conex:client"; let v = localStorage.getItem(k); if (!v) { v = Math.random().toString(36).slice(2, 12); localStorage.setItem(k, v); } return v; }
  catch { return Math.random().toString(36).slice(2, 12); }
})();

const state = {
  me: null as (LatLng & { accuracy: number | null }) | null,
  testing: false,
  watch: 0 as number, // the geolocation watch, once asked
  asked: false, // whether the visitor has been asked for their location
  denied: false,
  heading: null as number | null,
  compassAsked: false,
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
const SIGN: Record<Phase, string> = { idle: "", latency: "·", download: "↓", upload: "↑", stream: "▶", done: "" };

function words() {
  document.documentElement.lang = lang();
  el.measure.textContent = state.testing ? L(W.stop) : state.last ? L(W.again) : L(W.measure);
  el.langBtn.textContent = lang();
  el.langBtn.setAttribute("aria-label", `${L({ tr: "dil", en: "language" })}: ${L(W.langName)}`);
  el.themeBtn.textContent = settings.get().theme === "dark" ? "☾" : "☀";
  el.themeBtn.setAttribute("aria-label", `${L({ tr: "tema", en: "theme" })}: ${W.theme[lang()][settings.get().theme]}`);
  el.doors.setAttribute("aria-label", L(W.doors));
  el.field.setAttribute("aria-label", L(W.radar));
  for (const k of STEPS) stepEl(k).dataset.word = W.step[lang()][k];
  renderWay();
  renderFit();
}
const bar5 = (n: number) => "▮".repeat(n) + "▯".repeat(5 - n);
/** How the line will do, as three bars; empty until measured. */
function renderFit() {
  const r = state.last;
  if (!r) { el.fit.textContent = ""; return; }
  const f = fitness({ download: r.download, upload: r.upload, latency: r.latency, jitter: r.jitter, loaded: r.loaded, late: r.stream?.late ?? null });
  const w = W.fit[lang()];
  el.fit.textContent = `${w.call} ${bar5(f.call)}  ${w.game} ${bar5(f.game)}  ${w.stream} ${bar5(f.stream)}`;
}
/** The small print after a test: up, idle→loaded ms, rpm, link, bytes. */
function renderMore() {
  const r = state.last;
  if (!r) return;
  const parts = [`↑ ${fmt(r.upload)}`, r.loaded !== null ? `${Math.round(r.latency)}→${Math.round(r.loaded)} ms` : `${Math.round(r.latency)} ms`];
  if (r.rpm !== null && Number.isFinite(r.rpm)) parts.push(`${Math.round(r.rpm)} rpm`);
  if (r.stream) parts.push(`▶ ${Math.round(r.stream.late * r.stream.frames)} ${L(W.late)}`);
  const n = W.net[lang()][netKind()];
  if (n) parts.push(n);
  parts.push(`⇅ ${r.bytes >= 1e9 ? `${(r.bytes / 1e9).toFixed(1)} gb` : `${Math.round(r.bytes / 1e6)} mb`}${r.verified ? " ✓" : ""}`);
  decode(el.more, parts.join(" · "));
}

/** The step line: `on` is the accent, everything before it ink, the rest dim. */
function showStep(on: Step | null, dead = false) {
  const i = on ? STEPS.indexOf(on) : STEPS.length;
  STEPS.forEach((k, j) => {
    const e = stepEl(k);
    e.classList.toggle("is-done", j < i);
    e.classList.toggle("is-on", j === i && !dead);
    e.classList.toggle("is-dead", j === i && dead);
  });
}
const ACT: Record<Step, Activity> = { locate: "locate", latency: "latency", download: "download", upload: "upload", stream: "stream", way: "none" };
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
// Asked once, on the first tap, as exactly as the phone can tell; watched
// while the page is open; kept nowhere. The server rounds what it stores to
// about 11 m and forgets it after an hour.
function setMe(lat: number, lng: number, accuracy: number | null) {
  const first = !state.me;
  state.me = { lat, lng, accuracy };
  state.denied = false;
  radar.set({ me: state.me });
  if (first) { refreshNearby(); refreshBetter(); }
  sendPresence(state.testing ? "download" : "idle", 0);
}
function askLocation(): Promise<boolean> {
  if (state.me) return Promise.resolve(true);
  if (!("geolocation" in navigator)) { state.denied = true; return Promise.resolve(false); }
  state.asked = true;
  showStep("locate");
  radar.set({ activity: "locate" });
  hint(L(W.notKept));
  return new Promise((resolve) => {
    let settled = false;
    const done = (ok: boolean) => { if (!settled) { settled = true; radar.set({ activity: "none" }); resolve(ok); } };
    state.watch = navigator.geolocation.watchPosition(
      (p) => { setMe(p.coords.latitude, p.coords.longitude, p.coords.accuracy); done(true); },
      () => { if (!state.me) { state.denied = true; done(false); } },
      { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 },
    );
  });
}
// a visitor who has already said yes is not asked again
navigator.permissions?.query({ name: "geolocation" }).then((p) => { if (p.state === "granted") askLocation(); }).catch(() => {});

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
    const rel = state.heading === null ? best.bearing : (best.bearing - state.heading + 360) % 360;
    const n = W.net[lang()][best.net];
    decode(el.way, `${arrow(rel)} ${distLabel(best.distanceKm)}${best.gain ? ` · ${best.gain.toFixed(1)}×` : ""}${n ? ` · ${n}` : ""}`);
    if (!state.last) decode(el.more, `${fmt(best.download)} mbps · ${L(W.ago)(Math.round(best.ageMs / 60000))}`);
  } else {
    el.way.classList.add("is-dim");
    decode(el.way, !state.me ? "" : state.last ? L(W.best) : L(W.none));
    if (!state.last) el.more.textContent = "";
  }
  if (!state.testing) {
    showStep(state.last ? null : state.me ? "latency" : "locate");
    if (state.me) hint(state.me.accuracy ? `◎ ±${Math.round(state.me.accuracy)} m` : "");
  }
}

// ── the test ─────────────────────────────────────────────────────────────
let shown: Phase = "idle";
function tick(t: Tick) {
  if (t.phase === "done") return;
  if (t.phase !== shown) { shown = t.phase; showStep(t.phase as Step); radar.set({ activity: ACT[t.phase as Step] }); }
  el.n.textContent = fmt(t.value);
  const lanes = t.phase === "latency" ? "" : t.phase === "stream" ? " 4k60" : ` ×${t.lanes}`;
  el.unit.innerHTML = `${SIGN[t.phase]} ${t.phase === "latency" ? "ms" : "mbps"}${lanes}  <b>${bar(t.progress)}</b>`;
  if (t.loaded !== null) el.more.textContent = `· ${Math.round(t.loaded)} ms ${L(W.loaded)}`;
  sendPresence(t.phase, t.value);
}
async function toggle() {
  if (state.testing) { state.ctl?.abort(); return; }
  state.testing = true;
  state.ctl = new AbortController();
  // the compass is asked from the tap itself (iOS allows nothing later); the heading turns the radar
  if (!state.compassAsked) {
    state.compassAsked = true;
    askCompass((deg) => { state.heading = deg; radar.set({ heading: deg }); if (!state.testing) renderWay(); }).catch(() => {});
  }
  words();
  el.reading.classList.add("is-live");
  cut(el.reading);
  el.way.textContent = ""; el.more.textContent = ""; el.fit.textContent = "";
  state.spots = [];
  radar.set({ testing: true, spots: [] });
  const located = await askLocation();
  hint(located ? "" : L(W.noLocation), !located);
  shown = "idle";
  try {
    const r = await awake(() => runTest({ ping: () => live.ping(), light: wantsLight(), maxBytes: netKind() === "cellular" ? 150e6 : undefined }, tick, state.ctl!.signal));
    state.last = r;
    el.n.textContent = fmt(r.download);
    cut(el.reading);
    tap();
    el.unit.textContent = "mbps";
    renderMore();
    renderFit();
    showStep("way");
    radar.set({ activity: "none" });
    if (state.me) {
      const body = { download: r.download, upload: r.upload, latency: r.latency, jitter: r.jitter, loaded: r.loaded, rpm: r.rpm && Number.isFinite(r.rpm) ? r.rpm : null, late: r.stream?.late ?? null, net: netKind(), lat: state.me.lat, lng: state.me.lng, accuracy: state.me.accuracy, verified: Boolean(r.verified) };
      const res = await fetch("/api/results", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (res.ok) addResult(await res.json());
    }
  } catch (err) {
    el.n.textContent = state.last ? fmt(state.last.download) : "—";
    el.unit.textContent = "mbps";
    if (!(err instanceof DOMException && err.name === "AbortError")) { hint(L(W.failed), true); showStep(shown === "idle" ? "latency" : (shown as Step), true); }
  } finally {
    state.testing = false;
    state.ctl = null;
    el.reading.classList.remove("is-live");
    radar.set({ testing: false, activity: "none" });
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
showStep("locate");
document.fonts.ready.then(() => radar.draw());
if (import.meta.env.PROD && "serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});
