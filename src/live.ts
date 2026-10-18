// The live channel: who is testing where, right now, and each result as it lands.
import type { ClientMsg, ServerMsg } from "../shared/types.ts";

export function connect(onMessage: (m: ServerMsg) => void, onState: (open: boolean) => void) {
  let ws: WebSocket | null = null, timer = 0, closed = false;
  const open = () => {
    const proto = location.protocol === "https:" ? "wss" : "ws";
    ws = new WebSocket(`${proto}://${location.host}/ws`);
    ws.onopen = () => onState(true);
    ws.onclose = () => { onState(false); if (!closed) timer = window.setTimeout(open, 2000); };
    ws.onerror = () => ws?.close();
    ws.onmessage = (ev) => { try { onMessage(JSON.parse(ev.data)); } catch { /* not ours */ } };
  };
  open();
  return {
    send(m: ClientMsg) { if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(m)); },
    close() { closed = true; clearTimeout(timer); ws?.close(); },
  };
}
