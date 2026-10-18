// What the page and the server say to each other. One file, both sides.

export type Phase = "idle" | "latency" | "download" | "upload" | "done";

export type LatLng = { lat: number; lng: number };

/** One finished measurement, where it was made. */
export type Result = LatLng & {
  id: string;
  ts: number;
  accuracy: number | null;
  download: number; // Mbps
  upload: number | null;
  latency: number | null; // ms
  jitter: number | null;
  verified: boolean; // the uploaded bytes still said the message
  source: "live" | "seed";
};

/** A place nearby where the internet was measured better, right now. */
export type Spot = LatLng & {
  download: number;
  upload: number;
  latency: number;
  samples: number;
  ageMs: number;
  distanceKm: number;
  bearing: number;
  gain: number | null; // spot.download / your download
  score: number;
};

export type BetterResponse = { baseline: number; radiusKm: number; windowMin: number; spots: Spot[] };

export type Info = { message: string; digest: string; blockSize: number; keptMin: number; serverTime: number };

/** Someone mid-test, as the live channel carries them. */
export type Presence = LatLng & { id: string; phase: Phase; value: number; ts: number };

export type ServerMsg =
  | { type: "hello"; digest: string; online: number; presence: Presence[] }
  | { type: "online"; online: number }
  | { type: "presence"; presence: Presence }
  | { type: "leave"; id: string }
  | { type: "result"; result: Result };

export type ClientMsg =
  | { type: "presence"; id: string; lat: number; lng: number; phase: Phase; value: number }
  | { type: "ping"; t: number };
