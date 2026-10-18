// The house material, after binx's ramp (d/ay): binary in the shadow,
// mathematics in the half-light, dense where the light is full. A cell's
// character is steady for its place, so a still picture does not flicker.
export type Ramp = { bands: string[]; cuts: number[] };
export const BINX: Ramp = { bands: [" ", "01", "∂∫∑φπ∞√∆λ", "#%@"], cuts: [0.05, 0.5, 0.8] };

const at = (set: string, x: number, y: number) => { const cs = [...set]; return cs[(x * 7 + y * 13 + 1e5) % cs.length]; };

/** The character for luminance l at cell (x, y). */
export function glyph(m: Ramp, l: number, x: number, y: number): string {
  let b = 0;
  while (b < m.cuts.length && l >= m.cuts[b]) b++;
  return at(m.bands[b], x, y);
}
