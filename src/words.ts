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

export type Step = "locate" | "latency" | "download" | "upload" | "stream" | "way";

export const W = {
  measure: { tr: "ölç", en: "measure" },
  again: { tr: "yeniden ölç", en: "measure again" },
  stop: { tr: "esc · durdur", en: "esc · stop" },
  doors: { tr: "kapılar", en: "doors" },
  radar: { tr: "yakındaki ölçümler, ışık olarak", en: "nearby measurements, as light" },
  step: {
    tr: { locate: "konum", latency: "gecikme", download: "indirme", upload: "yükleme", stream: "yayın", way: "yol" } as Record<Step, string>,
    en: { locate: "location", latency: "latency", download: "download", upload: "upload", stream: "stream", way: "way" } as Record<Step, string>,
  },
  fit: { tr: { call: "görüşme", game: "oyun", stream: "yayın" }, en: { call: "call", game: "game", stream: "stream" } },
  loaded: { tr: "yüklü", en: "loaded" },
  late: { tr: "geç", en: "late" },
  net: { tr: { wifi: "wifi", cellular: "hücresel", ethernet: "kablo", unknown: "" }, en: { wifi: "wifi", cellular: "cellular", ethernet: "wired", unknown: "" } },
  notKept: { tr: "konum tutulmaz · bir saatlik ışık", en: "location not kept · one hour of light" },
  noLocation: { tr: "konum yok · haritasız", en: "no location · no map" },
  best: { tr: "en iyisi burası", en: "the best is here" },
  none: { tr: "yakında taze ölçüm yok", en: "nothing fresh nearby" },
  failed: { tr: "ölçüm kesildi", en: "the test broke" },
  online: { tr: "çevrimiçi", en: "online" },
  theme: { tr: { dark: "koyu", light: "açık" } as Record<string, string>, en: { dark: "dark", light: "light" } as Record<string, string> },
  langName: { tr: "türkçe", en: "english" },
  ago: { tr: (m: number) => (m < 1 ? "şimdi" : `${m} dk önce`), en: (m: number) => (m < 1 ? "now" : `${m} min ago`) },
} as const;
