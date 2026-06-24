import { initPolygonSocket } from "@/lib/ws/polygon-socket";
import { initUwSocket } from "@/lib/ws/uw-socket";
import { initOptionsSocket } from "@/lib/ws/options-socket";
import { initFlowEventBridge } from "@/lib/flow-events";

let initialized = false;

/** Initialize UW + Polygon + options WebSocket managers once per server process. */
export function ensureDataSockets() {
  if (initialized) return;
  initialized = true;
  void initFlowEventBridge();
  initUwSocket();
  initPolygonSocket();
  // Night's Watch live option marks — env-gated + isolated. A strict no-op unless
  // OPTIONS_WS_ENABLED is set, so it can never destabilize the uw/polygon sockets
  // or the REST snapshot fallback. Wrapped so an init throw can't break the others.
  try {
    initOptionsSocket();
  } catch (err) {
    console.warn("[init-data-sockets] options socket init failed (non-fatal):", err);
  }
}
