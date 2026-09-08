import { NextRequest, NextResponse } from "next/server";
import { authorizeMarketDeskApi } from "@/lib/market-api-auth";
import { fetchGexHeatmap } from "@/lib/providers/polygon-options-gex";
import { requireAnyToolApi } from "@/lib/tool-access-server";
import { subscribeMatrixDeltas } from "@/lib/gex-matrix-broadcast";
import { NO_STORE_HEADERS, NO_STORE_STREAM_HEADERS } from "@/lib/no-store-headers";
import { roundFloats, reconcileStrikeTotal, reconcileCellStrikeTotals } from "@/lib/round-floats";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * GET /api/market/gex-matrix-deltas?ticker=SPY
 *
 * Server-Sent Events (SSE) endpoint for real-time GEX matrix delta updates.
 *
 * Flow:
 * 1. Client connects and receives an initial full snapshot of the current heatmap
 * 2. Client keeps connection open to receive strike-level deltas as they broadcast
 * 3. Each delta includes only changed strikes (changes ≥ $100 notional threshold)
 * 4. Client merges deltas into local matrix for perceived real-time updates
 *
 * Connection management:
 * - Subscribers auto-remove after 30 min TTL (SUBSCRIBER_TTL_MS in broadcast module)
 * - Dead connections (write errors) are automatically removed from subscribers
 * - Server maintains up to MAX_SUBSCRIBERS (10000) to prevent memory leak
 * - SSE comment heartbeat every 15s (keeps ALB / proxies from idle-closing)
 */
export async function GET(req: NextRequest) {
  const auth = await authorizeMarketDeskApi(req);
  if (auth instanceof Response) return auth;

  // Launch gate — same as /api/market/gex-heatmap
  const locked = await requireAnyToolApi(["spx", "heatmap"]);
  if (locked) return locked;

  const ticker = (req.nextUrl.searchParams.get("ticker") || "SPY").toUpperCase();

  // Validate ticker
  if (!/^[A-Z0-9.\-]{1,8}$/.test(ticker)) {
    return NextResponse.json({ error: "Invalid ticker" }, { status: 400, headers: NO_STORE_HEADERS });
  }

  try {
    // Fetch the current heatmap snapshot to send as initial data
    const rawSnapshot = await fetchGexHeatmap(ticker);
    if (!rawSnapshot) {
      return NextResponse.json(
        { error: "Matrix not available for ticker", underlying: ticker },
        { status: 400, headers: NO_STORE_HEADERS }
      );
    }

    // BUG FIX (2026-09-03): this SSE initial snapshot served fetchGexHeatmap's raw
    // arithmetic output — the same dollar-gamma sums that carry IEEE-754 float noise
    // (e.g. 7499.360000000001) round-floats.ts exists to strip — while its sibling REST
    // route (gex-heatmap/route.ts) already rounds the same underlying heatmap object.
    // Scoped to just the numeric-precision fix (roundFloats + the same two-level
    // strike-total reconciliation gex-heatmap's route applies) — deliberately NOT
    // replicating that route's off-hours shift-gating/overlay/cross-validation logic,
    // which is presentation-layer scope this delta feed's snapshot doesn't carry.
    const snapshot = roundFloats(rawSnapshot);
    snapshot.gex = reconcileStrikeTotal(reconcileCellStrikeTotals(snapshot.gex, snapshot.near_term_expiries))!;
    snapshot.vex = reconcileStrikeTotal(reconcileCellStrikeTotals(snapshot.vex, snapshot.near_term_expiries))!;
    snapshot.dex = reconcileStrikeTotal(reconcileCellStrikeTotals(snapshot.dex, snapshot.near_term_expiries));
    snapshot.charm = reconcileStrikeTotal(reconcileCellStrikeTotals(snapshot.charm, snapshot.near_term_expiries));

    // Create an SSE response stream
    const encoder = new TextEncoder();
    let isClosed = false;
    let unsubscribe: (() => void) | null = null;
    let heartbeatInterval: ReturnType<typeof setInterval> | null = null;

    const cleanup = () => {
      if (isClosed) return;
      isClosed = true;
      if (heartbeatInterval) {
        clearInterval(heartbeatInterval);
        heartbeatInterval = null;
      }
      unsubscribe?.();
      unsubscribe = null;
    };

    const stream = new ReadableStream({
      start(controller) {
        // Send initial snapshot
        const snapshotEvent = `data: ${JSON.stringify({
          type: "snapshot",
          ticker,
          data: snapshot,
        })}\n\n`;
        controller.enqueue(encoder.encode(snapshotEvent));

        unsubscribe = subscribeMatrixDeltas({
          write: async (payload: string) => {
            if (isClosed) throw new Error("Stream closed");
            try {
              controller.enqueue(encoder.encode(payload));
            } catch (err) {
              cleanup();
              try {
                controller.close();
              } catch {
                /* already closed */
              }
              throw err;
            }
          },
        });

        // Periodic SSE comment heartbeat — same pattern as spx/pulse/stream + vector/stream.
        heartbeatInterval = setInterval(() => {
          if (isClosed) return;
          try {
            controller.enqueue(encoder.encode(": heartbeat\n\n"));
          } catch {
            cleanup();
          }
        }, 15_000);

        const originalClose = controller.close.bind(controller);
        controller.close = () => {
          cleanup();
          return originalClose();
        };
      },
      cancel() {
        cleanup();
      },
    });

    return new NextResponse(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        ...NO_STORE_STREAM_HEADERS,
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      },
    });
  } catch (err) {
    console.error("[market/gex-matrix-deltas] Error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500, headers: NO_STORE_HEADERS }
    );
  }
}
