// The arithmetic of a measurement, shared by the page and the tests.
// After the IETF responsiveness draft (RPM over a trimmed mean of probes
// under load), Cloudflare's percentile reduction and Ookla's trimming of
// the slow-start floor.

export const median = (a: number[]): number => {
  if (!a.length) return 0;
  const s = [...a].sort((x, y) => x - y), m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/** The value below which `p` (0..1) of the samples lie. */
export function percentile(a: number[], p: number): number {
  if (!a.length) return 0;
  const s = [...a].sort((x, y) => x - y);
  return s[Math.min(s.length - 1, Math.max(0, Math.floor(p * (s.length - 1))))];
}

/** Mean after dropping the lowest `lo` and highest `hi` shares (Ookla trims 30 % and 10 %). */
export function trimmedMean(a: number[], lo = 0.3, hi = 0.1): number {
  if (!a.length) return 0;
  const s = [...a].sort((x, y) => x - y);
  const from = Math.floor(s.length * lo), to = Math.max(from + 1, s.length - Math.floor(s.length * hi));
  const kept = s.slice(from, to);
  return kept.reduce((t, v) => t + v, 0) / kept.length;
}

/** Single-sided trimmed mean: the mean of samples at or under the `p`th percentile (the draft uses 95 %). */
export function trimmedMeanBelow(a: number[], p = 0.95): number {
  if (!a.length) return 0;
  const cut = percentile(a, p), kept = a.filter((v) => v <= cut);
  return kept.reduce((t, v) => t + v, 0) / kept.length;
}

/** Mean distance between consecutive samples. */
export function jitterOf(a: number[]): number {
  if (a.length < 2) return 0;
  let d = 0;
  for (let i = 1; i < a.length; i++) d += Math.abs(a[i] - a[i - 1]);
  return d / (a.length - 1);
}

/** Round trips per minute from probe latencies (ms) taken under load. */
export const rpmOf = (loadedMs: number[]): number => (loadedMs.length ? 60000 / trimmedMeanBelow(loadedMs, 0.95) : 0);

/** Whether the last `n` interval samples sit within `tol` of their mean: working conditions reached. */
export function stable(samples: number[], n = 4, tol = 0.05): boolean {
  if (samples.length < n) return false;
  const last = samples.slice(-n), mean = last.reduce((t, v) => t + v, 0) / n;
  return mean > 0 && last.every((v) => Math.abs(v - mean) / mean <= tol);
}

export type Fitness = { call: number; game: number; stream: number }; // 0 unknown, 1 bad … 5 great

/** How the connection will do, as five levels per use. Our own rubric; the shape follows AIM. */
export function fitness(m: { download: number; upload: number; latency: number; jitter: number; loaded: number | null; late?: number | null }): Fitness {
  const bloat = m.loaded === null ? 0 : Math.max(0, m.loaded - m.latency);
  const bloatPenalty = bloat > 100 ? 2 : bloat > 50 ? 1 : 0;
  const level = (v: number, cuts: number[]) => 5 - cuts.filter((c) => v > c).length; // cuts ascending: ≤cuts[0] → 5
  const clamp = (v: number) => Math.max(1, Math.min(5, v));
  const call = clamp(level(m.latency, [30, 60, 100, 150]) - bloatPenalty - (m.jitter > 30 ? 1 : 0) - (m.upload < 1.5 ? 2 : m.upload < 3 ? 1 : 0));
  const game = clamp(level(m.latency, [20, 40, 70, 100]) - bloatPenalty - (m.jitter > 15 ? 1 : 0));
  // the stream, measured when it was: the share of 4K60 frames that came late
  const stream = m.late !== null && m.late !== undefined
    ? (m.late === 0 ? 5 : m.late < 0.01 ? 4 : m.late < 0.05 ? 3 : m.late < 0.15 ? 2 : 1)
    : clamp(5 - [5, 10, 25, 50].filter((c) => m.download < c).length - (bloat > 150 ? 1 : 0));
  return { call, game, stream };
}
