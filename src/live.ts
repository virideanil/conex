// The live channel: who is testing where, right now, each result as it lands,
// and the ping: the sentence's SHAKE256 digest with a clock, sent as 40 bytes
// and echoed back as the same 40 bytes. It is checked on return. This
// connection is not one of the test's lanes, so it can be probed under load.
import type { ClientMsg, ServerMsg } from "../shared/types.ts";

export type Live = {
  send(m: ClientMsg): void;
  /** Round trip in ms over the channel, or a rejection when it is down or slow. */
  ping(timeoutMs?: number): Promise<number>;
  open(): boolean;
  close(): void;
};

export function connect(onMessage: (m: ServerMsg) => void, onState: (open: boolean) => void): Live {
  let ws: WebSocket | null = null, timer = 0, closed = false;
  let digest: Uint8Array | null = null; // from hello: what every ping carries
  const waiting = new Map<number, { t0: number; resolve: (ms: number) => void; reject: (e: Error) => void }>();
  const hex = (h: string) => Uint8Array.from(h.match(/../g)!.map((b) => parseInt(b, 16)));
  const open = () => {
    const proto = location.protocol === "https:" ? "wss" : "ws";
    ws = new WebSocket(`${proto}://${location.host}/ws`);
    ws.binaryType = "arraybuffer";
    ws.onopen = () => onState(true);
    ws.onclose = () => { onState(false); for (const w of waiting.values()) w.reject(new Error("closed")); waiting.clear(); if (!closed) timer = window.setTimeout(open, 2000); };
    ws.onerror = () => ws?.close();
    ws.onmessage = (ev) => {
      if (ev.data instanceof ArrayBuffer) {
        if (ev.data.byteLength !== 40) return;
        const t = new DataView(ev.data).getFloat64(0), w = waiting.get(t);
        if (!w) return;
        waiting.delete(t);
        const back = new Uint8Array(ev.data, 8), same = digest !== null && back.every((b, i) => b === digest![i]);
        if (same) w.resolve(performance.now() - w.t0); else w.reject(new Error("not the sentence"));
        return;
      }
      let m: ServerMsg;
      try { m = JSON.parse(ev.data); } catch { return; }
      if (m.type === "hello") digest = hex(m.digest);
      onMessage(m);
    };
  };
  open();
  return {
    send(m) { if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(m)); },
    ping(timeoutMs = 3000) {
      return new Promise((resolve, reject) => {
        if (ws?.readyState !== WebSocket.OPEN || !digest) { reject(new Error("down")); return; }
        const t = performance.now() + Math.random();
        const frame = new ArrayBuffer(40);
        new DataView(frame).setFloat64(0, t);
        new Uint8Array(frame, 8).set(digest);
        waiting.set(t, { t0: performance.now(), resolve, reject });
        setTimeout(() => { if (waiting.delete(t)) reject(new Error("slow")); }, timeoutMs);
        ws.send(frame);
      });
    },
    open: () => ws?.readyState === WebSocket.OPEN,
    close() { closed = true; clearTimeout(timer); ws?.close(); },
  };
}
