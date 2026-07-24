// 0DTE Command live marks — SSE push (~1s) for the member's OPEN plays (B-9).
//
// The platform's established live-transport pattern (WS upgrades don't reach
// browsers through the proxy; SSE does — see vector/stream). Each tick pushes the
// bounded live-marks payload (src/lib/zerodte/live-marks.ts): per open contract
// {bid, ask, mid, last, mark, source, mark_as_of, live_pnl_pct} where P&L is
// computed server-side in ONE place against the PINNED ledger entry premium.
// Client fallback: GET /api/market/zerodte/marks polled at 2–3s.
import { NextRequest, NextResponse } from "next/server";
import { authorizeCronOrTierApi } from "@/lib/market-api-auth";
import { requireToolApi } from "@/lib/tool-access-server";
import { ensureZeroDteMarkPoller, getZeroDteLiveMarksFrame } from "@/lib/zerodte/live-marks";
import { ensureDataSockets } from "@/lib/ws/init-data-sockets";
import { sseBackpressureExceeded } from "@/lib/sse-backpressure";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TICK_MS = 1_000;
const MAX_STREAMS = Number(process.env.SSE_MAX_STREAMS ?? 2000);

// Atomic acquire/release so concurrent connects can't overshoot the cap (same
// discipline as vector/stream's tryAcquireVectorStreamConnection).
let activeStreams = 0;
function tryAcquireStream(): boolean {
  if (activeStreams >= MAX_STREAMS) return false;
  activeStreams += 1;
  return true;
}
function releaseStream(): void {
  activeStreams = Math.max(0, activeStreams - 1);
}

export async function GET(req: NextRequest) {
  const auth = await authorizeCronOrTierApi(req, "premium");
  if (auth instanceof Response) return auth;
  if (auth.via === "user") {
    // Same launch gate as the board route — 0DTE Command lives under Night Hawk.
    const denied = await requireToolApi("nighthawk");
    if (denied) return denied;
  }

  if (!tryAcquireStream()) {
    return new NextResponse("Too many active streams — try again shortly", { status: 503 });
  }

  ensureDataSockets();
  ensureZeroDteMarkPoller();

  const encoder = new TextEncoder();
  let interval: ReturnType<typeof setInterval> | null = null;
  let heartbeatInterval: ReturnType<typeof setInterval> | null = null;
  let closed = false;

  const cleanup = () => {
    if (closed) return;
    closed = true;
    releaseStream();
    if (interval) {
      clearInterval(interval);
      interval = null;
    }
    if (heartbeatInterval) {
      clearInterval(heartbeatInterval);
      heartbeatInterval = null;
    }
  };

  const stream = new ReadableStream({
    start(controller) {
      let lastSentKey: string | null = null;
      const send = async () => {
        if (closed) return;
        if (sseBackpressureExceeded(controller.desiredSize)) {
          cleanup();
          try {
            controller.close();
          } catch {
            /* already closed */
          }
          return;
        }
        try {
          const { json, contentKey } = await getZeroDteLiveMarksFrame();
          // Dedupe on the CONTENT key, not the JSON: every build stamps a fresh
          // `as_of` (and per-row `mark_age_ms`) from `now`, so the JSON string always
          // differs even when no quote moved — a raw-string compare here never fired.
          // The content key excludes those time-only fields, so an unchanged market
          // between ticks skips the re-send (real bandwidth save; mirrors vector/stream).
          if (contentKey === lastSentKey) return;
          controller.enqueue(encoder.encode(`data: ${json}\n\n`));
          lastSentKey = contentKey;
        } catch {
          cleanup();
          try {
            controller.close();
          } catch {
            /* already closed */
          }
        }
      };

      req.signal.addEventListener("abort", cleanup);
      interval = setInterval(() => {
        void send();
      }, TICK_MS);
      void send();

      heartbeatInterval = setInterval(() => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(": heartbeat\n\n"));
        } catch {
          cleanup();
        }
      }, 15_000);
    },
    cancel() {
      cleanup();
    },
  });

  return new NextResponse(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
