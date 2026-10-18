// How things move on conex, after d/ay's motion: cuts and decodes, no fades.
export const GLYPHS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
export const pick = () => GLYPHS[(Math.random() * GLYPHS.length) | 0];
export const reduced = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

/** The cut: for two frames the channels part, then the element stands whole. */
export function cut(el: Element, ms = 120) {
  if (reduced()) return;
  el.classList.add("is-cut");
  setTimeout(() => el.classList.remove("is-cut"), ms);
}

const timers = new WeakMap<Element, number>();
/** Text arrives as noise and settles left to right, in 60 ms ticks over ~400 ms. */
export function decode(el: HTMLElement, text: string, ms = 400) {
  const prev = timers.get(el);
  if (prev) clearInterval(prev);
  if (reduced() || !text) { el.textContent = text; return; }
  const chars = [...text], t0 = performance.now();
  const id = window.setInterval(() => {
    const p = (performance.now() - t0) / ms;
    el.textContent = chars.map((c, i) => (c === " " ? c : i / chars.length < p ? c : pick())).join("");
    if (p >= 1) { clearInterval(id); timers.delete(el); el.textContent = text; }
  }, 60);
  timers.set(el, id);
}
