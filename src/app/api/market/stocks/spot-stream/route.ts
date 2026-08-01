// GET /api/market/stocks/spot-stream?tickers=AAPL,MSFT,TSLA
//
// Generalized push (SSE) stream for stock/ETF spot price + day-change%, reading
// tick-by-tick from stock-candle-store.ts (the site's WS-fed source of truth —
// see quote/route.ts). PR 2/3 of the sub-second-spot project (see FINDINGS.md):
// PR 1 added day-change tracking to the store; this PR exposes it as a push
// stream instead of 1-2s SWR polling; PR 3 migrates components onto it.
//
// One connection carries WHATEVER tickers are on that viewer's screen right
// now — NOT a broadcast of the whole ~8K-ticker universe. This mirrors the
// existing Vector stream's per-viewer model (features/vector/lib/vector-stream-hub.ts)
// rather than pushing data nobody asked for to every open tab.
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { authorizeMarketDeskApi } from "@/lib/market-api-auth";
import { ensureDataSockets } from "@/lib/ws/init-data-sockets";
import { shouldBootDataSockets } from "@/lib/process-role";
import { sseBackpressureExceeded } from "@/lib/sse-backpressure";
import { NO_STORE_STREAM_HEADERS } from "@/lib/no-store-headers";
import {
  MAX_TICKERS_PER_STREAM,
  parseTickerList,
  buildSpotFrame,
  encodeSpotFrame,
  tryAcquireSpotStreamConnection,
  releaseSpotStreamConnection,
} from "@/lib/ws/stocks-spot-stream-hub";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TICK_MS = 1_000;
const MAX_STREAMS = Number(process.env.SSE_MAX_STREAMS ?? 2000);

export async function GET(req: NextRequest) {
  const auth = await authorizeMarketDeskApi(req);
  if (auth instanceof Response) return auth;

  const { tickers, error } = parseTickerList(req.nextUrl.searchParams.get("tickers"), MAX_TICKERS_PER_STREAM);
  if (error) {
    return NextResponse.json({ error }, { status: 400, headers: NO_STORE_STREAM_HEADERS });
  }

  // Claim the slot atomically before any stream setup — same fix as Vector's
  // connection cap (a read-then-increment here would let concurrent connects
  // overshoot MAX_STREAMS).
  if (!tryAcquireSpotStreamConnection(MAX_STREAMS)) {
    return new NextResponse("Too many active streams — try again shortly", { status: 503 });
  }

  // Boot the WS ingest lazily on ingest only — web tier reads the cluster/Redis
  // fallback via stock-candle-store's on-demand mirror.
  if (shouldBootDataSockets()) {
    ensureDataSockets();
  }

  const encoder = new TextEncoder();
  let interval: ReturnType<typeof setInterval> | null = null;
  let heartbeatInterval: ReturnType<typeof setInterval> | null = null;
  let closed = false;

  const cleanup = () => {
    if (closed) return;
    closed = true;
    releaseSpotStreamConnection();
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
      let lastSent: string | null = null;

      const send = () => {
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
        const encoded = encodeSpotFrame(buildSpotFrame(tickers));
        // Identity compare against the last sent frame skips re-encoding an
        // unchanged tick (common off-hours / for slow-moving tickers).
        if (encoded === lastSent) return;
        try {
          controller.enqueue(encoder.encode(encoded));
          lastSent = encoded;
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

      interval = setInterval(send, TICK_MS);
      send();

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
      Connection: "keep-alive",
      ...NO_STORE_STREAM_HEADERS,
    },
  });
}
