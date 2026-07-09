import { NextRequest, NextResponse } from "next/server";
import { authorizeMarketDeskApi } from "@/lib/market-api-auth";
import { dbConfigured, fetchRecentFlows } from "@/lib/db";
import { fetchMarketFlowAlerts } from "@/lib/providers/unusual-whales";
import { uwConfigured } from "@/lib/providers/config";
import { maybeRunFlowIngest } from "@/lib/providers/flow-ingest";
import { getFlowPlatformRefs } from "@/lib/flow-platform-refs";
import { ensureDataSockets } from "@/lib/ws/init-data-sockets";
import { enrichFlowsWithGex } from "@/lib/flow-gex-enrichment";
import { roundFloats } from "@/lib/round-floats";
import { flowTapeCacheTtlMs } from "@/lib/providers/config";
import { withServerCache } from "@/lib/server-cache";

export const dynamic = "force-dynamic";

// nodejs runtime is required: ensureDataSockets (and the pg/UW providers used below)
// pull node-only modules (ioredis / ws / node:crypto) that the edge runtime rejects.
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const auth = await authorizeMarketDeskApi(req);
  if (auth instanceof Response) return auth;

  // Boot the UW WebSocket (idempotent) so a replica that only ever serves the /flows
  // poll route still initializes uwSocket and keeps the live tape fed (audit gap #4).
  ensureDataSockets();

  const sp = req.nextUrl.searchParams;
  const limit = Math.min(Number(sp.get("limit") ?? 500), 1000); // cap at 1000 to keep payload lean
  const ticker = sp.get("ticker") ?? undefined;
  const min_premium = Number(sp.get("min_premium") ?? 0) || undefined;
  // §3.5: clamp 1h–720h (30-day ceiling) so a caller can't pass since_hours=10000000 and scan the
  // entire flow_alerts table (+ mint a distinct cache key per value). limit is already capped at 1000.
  const since_hours = Math.min(Math.max(Number(sp.get("since_hours") ?? 168) || 168, 1), 720);

  if (dbConfigured()) {
    maybeRunFlowIngest().catch((err) => console.error("[flows] lazy ingest error:", err));
    const cacheKey = `flows:pg:${since_hours}:${min_premium ?? 0}:${ticker ?? "all"}`;
    try {
      const payload = await withServerCache(
        cacheKey,
        flowTapeCacheTtlMs(),
        async () => {
          const [flows, platform_refs] = await Promise.all([
            fetchRecentFlows({ limit, ticker, min_premium, since_hours, order: "recent" }),
            getFlowPlatformRefs(),
          ]);

          const enrichedFlows = await enrichFlowsWithGex(flows, 8);

          console.log(
            `[market/flows] postgres ok — ${flows.length} rows (min_premium=${min_premium}, since_hours=${since_hours})`
          );
          return {
            source: "cache" as const,
            flows: enrichedFlows,
            count: enrichedFlows.length,
            platform_refs,
          };
        },
        { staleWhileRevalidate: true }
      );
      return NextResponse.json(roundFloats(payload));
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      console.error("[market/flows] postgres ERROR:", detail);
      return NextResponse.json({ source: "cache", flows: [], count: 0, error: "Flow fetch failed" }, { status: 503 });
    }
  }

  if (!uwConfigured()) {
    return NextResponse.json(
      { error: "Flow data unavailable", flows: [], count: 0 },
      { status: 503 }
    );
  }

  try {
    const cacheKey = `flows:uw:${limit}:${ticker ?? "all"}:${min_premium ?? 0}`;
    const flows = await withServerCache(
      cacheKey,
      flowTapeCacheTtlMs(),
      () => fetchMarketFlowAlerts({ limit, ticker, min_premium }),
      { staleWhileRevalidate: true }
    );
    return NextResponse.json(roundFloats({ source: "live", flows, count: flows.length }));
  } catch (error) {
    console.error("[market/flows]", error);
    return NextResponse.json({ error: "Flow fetch failed" }, { status: 503 });
  }
}
