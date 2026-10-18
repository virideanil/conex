// conex's words, in d/ay's voice: lowercase, Turkish and English, every string in both.
// The visitor's language picks until they do; the look is koyu until they switch it.
export type Lang = "tr" | "en";
export type Words<T = string> = { tr: T; en: T };
export type Settings = { lang: "" | Lang; theme: "dark" | "light" };

const KEY = "conex:settings";
const DEFAULTS: Settings = { lang: "", theme: "dark" };

function read(): Settings {
  try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) ?? "{}") }; } catch { return { ...DEFAULTS }; }
}
let s = read();
const subs = new Set<(s: Settings) => void>();
export const settings = {
  get: () => s,
  set(p: Partial<Settings>) {
    s = { ...s, ...p };
    try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* kept for this page only */ }
    subs.forEach((f) => f(s));
  },
  on(f: (s: Settings) => void) { subs.add(f); },
};

export const lang = (): Lang => s.lang || (navigator.language.toLowerCase().startsWith("tr") ? "tr" : "en");
export const L = <T>(w: Words<T>): T => w[lang()];

export const W = {
  measure: { tr: "ölç", en: "measure" },
  again: { tr: "yeniden ölç", en: "measure again" },
  measuring: { tr: "ölçülüyor", en: "measuring" },
  stop: { tr: "esc · durdur", en: "esc · stop" },
  doors: { tr: "kapılar", en: "doors" },
  radar: { tr: "yakındaki ölçümler, ışık olarak", en: "nearby measurements, as light" },
  locating: { tr: "konum aranıyor", en: "finding you" },
  noLocation: { tr: "konum izni yok · ölçüm haritasız", en: "no location · measuring without the map" },
  located: { tr: "konum canlı", en: "location live" },
  ready: { tr: "ölçmek için ölç'e dokun", en: "tap measure to begin" },
  best: { tr: "en iyisi burası", en: "the best is here" },
  none: { tr: "yakında taze ölçüm yok", en: "nothing fresh measured nearby" },
  failed: { tr: "ölçüm kesildi", en: "the test broke" },
  online: { tr: "çevrimiçi", en: "online" },
  phase: { tr: { latency: "gecikme", download: "indirme", upload: "yükleme" }, en: { latency: "latency", download: "download", upload: "upload" } },
  theme: { tr: { dark: "koyu", en: "açık" } as Record<string, string>, en: { dark: "dark", light: "light" } as Record<string, string> },
  langName: { tr: "türkçe", en: "english" },
  faster: { tr: "kat", en: "faster" },
  samples: { tr: "ölçüm", en: "samples" },
  ago: { tr: (m: number) => (m < 1 ? "şimdi" : `${m} dk önce`), en: (m: number) => (m < 1 ? "now" : `${m} min ago`) },
} as const;
