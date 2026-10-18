// Distance, bearing and a flat local frame, shared by the ranking on the
// server and the glyph radar on the page.
import type { LatLng } from "./types.ts";

export const R_EARTH_KM = 6371;
export const PHI = (1 + Math.sqrt(5)) / 2;
const rad = (d: number) => (d * Math.PI) / 180;

export function distanceKm(a: LatLng, b: LatLng): number {
  const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R_EARTH_KM * Math.asin(Math.sqrt(s));
}

/** Degrees clockwise from north, 0..360. */
export function bearingDeg(a: LatLng, b: LatLng): number {
  const y = Math.sin(rad(b.lng - a.lng)) * Math.cos(rad(b.lat));
  const x = Math.cos(rad(a.lat)) * Math.sin(rad(b.lat)) - Math.sin(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.cos(rad(b.lng - a.lng));
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

/** Eight winds, as signs: the arrow is the direction, nothing else needs saying. */
export const ARROWS = ["↑", "↗", "→", "↘", "↓", "↙", "←", "↖"] as const;
export const windIndex = (deg: number) => Math.round(deg / 45) % 8;
export const arrow = (deg: number) => ARROWS[windIndex(deg)];

/** East and north of `center`, in km: a flat frame good to a few km. */
export function localKm(center: LatLng, p: LatLng): { x: number; y: number } {
  const kmPerDegLat = 111.32, kmPerDegLng = 111.32 * Math.cos(rad(center.lat));
  return { x: (p.lng - center.lng) * kmPerDegLng, y: (p.lat - center.lat) * kmPerDegLat };
}

/** The inverse of localKm. */
export function fromLocalKm(center: LatLng, x: number, y: number): LatLng {
  const kmPerDegLat = 111.32, kmPerDegLng = 111.32 * Math.cos(rad(center.lat));
  return { lat: center.lat + y / kmPerDegLat, lng: center.lng + x / kmPerDegLng };
}

/** A distance as a sign: `420 m`, `1.6 km`. */
export const distLabel = (km: number) => (km < 1 ? `${Math.round(km * 1000)} m` : `${km.toFixed(km < 10 ? 1 : 0)} km`);
