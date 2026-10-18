// What the phone can add: which way it points, keeping the screen on while it
// works, a tap you can feel, and what kind of link it is on.
import type { Net } from "../shared/types.ts";

type OrientationCtor = typeof DeviceOrientationEvent & { requestPermission?: () => Promise<"granted" | "denied"> };
type CompassEvent = DeviceOrientationEvent & { webkitCompassHeading?: number };

/** Asks for the compass, from inside a tap, and reports the heading in 15° cuts; false when there is none. */
export async function askCompass(onHeading: (deg: number | null) => void): Promise<boolean> {
  if (typeof DeviceOrientationEvent === "undefined") return false;
  const ctor = DeviceOrientationEvent as OrientationCtor;
  let last: number | null = null;
  const emit = (raw: number | null) => {
    if (raw === null || !Number.isFinite(raw)) return;
    const screenTurn = (screen.orientation?.angle ?? 0);
    const deg = Math.round((((raw + screenTurn) % 360) + 360) % 360 / 15) * 15 % 360;
    if (deg !== last) { last = deg; onHeading(deg); }
  };
  if (ctor.requestPermission) {
    // iOS: the permission must be asked from the tap itself, and the heading comes on deviceorientation
    try { if ((await ctor.requestPermission()) !== "granted") return false; } catch { return false; }
    addEventListener("deviceorientation", (e) => emit((e as CompassEvent).webkitCompassHeading ?? null));
    return true;
  }
  // elsewhere: the absolute event, alpha counter-clockwise from north
  if (!("ondeviceorientationabsolute" in window)) return false;
  addEventListener("deviceorientationabsolute", (e) => { const o = e as DeviceOrientationEvent; emit(o.absolute && o.alpha !== null ? (360 - o.alpha) % 360 : null); });
  return true;
}

/** Keeps the screen on while `work` runs; harmless where it cannot. */
export async function awake<T>(work: () => Promise<T>): Promise<T> {
  const held: { lock: WakeLockSentinel | null } = { lock: null };
  const grab = async () => { try { held.lock = (await navigator.wakeLock?.request("screen")) ?? null; } catch { held.lock = null; } };
  const back = () => { if (document.visibilityState === "visible") grab(); };
  await grab();
  document.addEventListener("visibilitychange", back);
  try { return await work(); } finally { document.removeEventListener("visibilitychange", back); try { await held.lock?.release(); } catch { /* gone */ } }
}

/** One short tap you can feel, where the phone allows it. */
export const tap = () => { try { navigator.vibrate?.(40); } catch { /* none */ } };

type Connection = { type?: string; effectiveType?: string; saveData?: boolean };
const conn = (): Connection | undefined => (navigator as Navigator & { connection?: Connection }).connection;

/** The kind of link, where the phone tells (Chrome on Android); unknown elsewhere. */
export function netKind(): Net {
  const t = conn()?.type;
  return t === "wifi" || t === "cellular" || t === "ethernet" ? t : "unknown";
}
/** The visitor has asked for less data, or the link is thin: a light test. */
export const wantsLight = () => Boolean(conn()?.saveData) || ["slow-2g", "2g"].includes(conn()?.effectiveType ?? "");
