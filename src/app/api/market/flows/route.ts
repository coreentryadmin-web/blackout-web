import { NextRequest, NextResponse } from "next/server";
import { authorizePremiumDeskApi } from "@/lib/market-api-auth";
import { dbConfigured } from "@/lib/db";
import { fetchMarketFlowAlerts } from "@/lib/providers/unusual-whales";
import { uwConfigured } from "@/lib/providers/config";
import { maybeRunFlowIngest } from "@/lib/providers/flow-ingest";
import { serverCache, TTL } from "@/lib/server-cache";
import {
  HELIX_FLOW_DEFAULT_SINCE_HOURS,
  HELIX_FLOW_MAX_LIMIT,
  HELIX_FLOW_MAX_SINCE_HOURS,
} from "@/features/helix/lib/helix-flow-limits";
import { registerVectorUniverseView } from "@/features/vector/lib/vector-universe";
import { NO_STORE_HEADERS } from "@/lib/no-store-headers";
import { enforceFlowsRestRateLimit } from "@/lib/market-user-rate-limit";
import { ensureDataSockets } from "@/lib/ws/init-data-sockets";
import { readFlowsMemberCached } from "@/lib/flows-member-cache";
import { roundFloats } from "@/lib/round-floats";

export const dynamic = "force-dynamic";

// nodejs runtime is required: ensureDataSockets (and the pg/UW providers used below)
// pull node-only modules (ioredis / ws / node:crypto) that the edge runtime rejects.
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const auth = await authorizePremiumDeskApi(req);
  if (auth instanceof Response) return auth;

  const limited = await enforceFlowsRestRateLimit(auth.userId);
  if (limited) return limited;

  ensureDataSockets();

  const sp = req.nextUrl.searchParams;
  const pageLimit = Math.min(
    Math.max(Number(sp.get("limit") ?? 500) || 500, 1),
    HELIX_FLOW_MAX_LIMIT
  );
  const ticker = sp.get("ticker") ?? undefined;
  if (ticker) registerVectorUniverseView(ticker);
  const min_premium = Number(sp.get("min_premium") ?? 0) || undefined;
  const since_hours = Math.min(
    Math.max(Number(sp.get("since_hours") ?? HELIX_FLOW_DEFAULT_SINCE_HOURS) || HELIX_FLOW_DEFAULT_SINCE_HOURS, 1),
    HELIX_FLOW_MAX_SINCE_HOURS
  );
  const beforeRaw = sp.get("before")?.trim();
  const before =
    beforeRaw && Number.isFinite(new Date(beforeRaw).getTime()) ? beforeRaw : undefined;
  const maxDteRaw = sp.get("max_dte");
  const max_dte =
    maxDteRaw != null && maxDteRaw !== "" && Number.isFinite(Number(maxDteRaw))
      ? Math.max(0, Math.floor(Number(maxDteRaw)))
      : undefined;

  if (dbConfigured()) {
    maybeRunFlowIngest().catch((err) => console.error("[flows] lazy ingest error:", err));

    try {
      const payload = await readFlowsMemberCached({
        pageLimit,
        ticker,
        min_premium,
        since_hours,
        max_dte,
        before,
      });
      console.log(
        `[market/flows] postgres ok — ${payload.count} rows (min_premium=${min_premium}, since_hours=${since_hours}, max_dte=${max_dte ?? "any"}, before=${before ? "yes" : "no"})`
      );
      return NextResponse.json(roundFloats(payload), { headers: NO_STORE_HEADERS });
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      console.error("[market/flows] postgres ERROR:", detail);
      return NextResponse.json(
        { source: "cache", flows: [], count: 0, has_more: false, error: "Flow fetch failed" },
        { status: 503 }
      );
    }
  }

  if (!uwConfigured()) {
    return NextResponse.json(
      { error: "Flow data unavailable", flows: [], count: 0, has_more: false },
      { status: 503 }
    );
  }

  try {
    const cacheKey = `flows:uw:${pageLimit}:${ticker ?? "all"}:${min_premium ?? 0}:${before ?? "head"}`;
    const rawRows = await serverCache(cacheKey, TTL.DARK_POOL, () =>
      fetchMarketFlowAlerts({ limit: pageLimit + 1, ticker, min_premium })
    );
    const hasMore = rawRows.length > pageLimit;
    const page = hasMore ? rawRows.slice(0, pageLimit) : rawRows;
    const nextBefore = hasMore ? page[page.length - 1]?.alerted_at ?? null : null;
    return NextResponse.json(
      roundFloats({
        source: "live",
        flows: page,
        count: page.length,
        has_more: hasMore,
        next_before: nextBefore,
      }),
      { headers: NO_STORE_HEADERS }
    );
  } catch (error) {
    console.error("[market/flows]", error);
    return NextResponse.json({ error: "Flow fetch failed" }, { status: 503 });
  }
}
