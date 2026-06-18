import { initPolygonSocket } from "@/lib/ws/polygon-socket";
import { initUwSocket } from "@/lib/ws/uw-socket";
import { initFlowEventBridge } from "@/lib/flow-events";

let initialized = false;

/** Initialize UW + Polygon WebSocket managers once per server process. */
export function ensureDataSockets() {
  if (initialized) return;
  initialized = true;
  void initFlowEventBridge();
  initUwSocket();
  initPolygonSocket();
}
