import { NextRequest, NextResponse } from "next/server";
import { authorizePremiumDeskApi } from "@/lib/market-api-auth";
import { dbConfigured, fetchRecentFlows } from "@/lib/db";
import { fetchMarketFlowAlerts } from "@/lib/providers/unusual-whales";
import { uwConfigured } from "@/lib/providers/config";
import { maybeRunFlowIngest } from "@/lib/providers/flow-ingest";
import { marketPlatform } from "@/lib/platform";
import { serverCache, withServerCache, peekServerCache, TTL } from "@/lib/server-cache";
import { flowsMemberReadMaxBlockMs, flowsCacheTtlMs } from "@/lib/providers/config";
import { ensureDataSockets } from "@/lib/ws/init-data-sockets";
import { enrichFlowsWithGex } from "@/lib/flow-gex-enrichment";
import { roundFloats } from "@/lib/round-floats";
import {
  HELIX_FLOW_DEFAULT_SINCE_HOURS,
  HELIX_FLOW_MAX_LIMIT,
  HELIX_FLOW_MAX_SINCE_HOURS,
} from "@/features/helix/lib/helix-flow-limits";
import { flowPageCursor } from "@/features/helix/lib/helix-flow-tape-merge";
import { registerVectorUniverseView } from "@/features/vector/lib/vector-universe";
import { NO_STORE_HEADERS } from "@/lib/no-store-headers";
import { enforceFlowsRestRateLimit } from "@/lib/market-user-rate-limit";

export const dynamic = "force-dynamic";

// nodejs runtime is required: ensureDataSockets (and the pg/UW providers used below)
// pull node-only modules (ioredis / ws / node:crypto) that the edge runtime rejects.
export const runtime = "nodejs";

type FlowsPayload = {
  source: "cache" | "live";
  flows: Awaited<ReturnType<typeof enrichFlowsWithGex>>;
  count: number;
  has_more: boolean;
  next_before: string | null;
  platform_refs?: { spx: unknown; nighthawk: unknown } | null;
  degraded?: boolean;
};

let lastGoodFlowsPayload: FlowsPayload | null = null;

function emptyFlowsPayload(): FlowsPayload {
  return { source: "cache", flows: [], count: 0, has_more: false, next_before: null, degraded: true };
}

function paginateRows<T extends { alerted_at: string; event_at?: string | null }>(
  rows: T[],
  pageLimit: number
) {
  const hasMore = rows.length > pageLimit;
  const page = hasMore ? rows.slice(0, pageLimit) : rows;
  const nextBefore = hasMore ? flowPageCursor(page) : null;
  return { page, hasMore, nextBefore };
}

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

    const runQuery = async () => {
      const [rawRows, platform] = await Promise.all([
        fetchRecentFlows({
          limit: pageLimit + 1,
          ticker,
          min_premium,
          since_hours,
          order: "recent",
          before,
          max_dte,
        }),
        before
          ? Promise.resolve(null)
          : Promise.all([
              marketPlatform.spx.getSpxDeskSummary().catch(() => null),
              marketPlatform.nighthawk.getLatestNightHawkSummary().catch(() => null),
            ]).then(([spx, nighthawk]) => ({ spx, nighthawk })),
      ]);

      const { page, hasMore, nextBefore } = paginateRows(rawRows, pageLimit);
      // See enrichFlowsWithGex's doc comment — default maxTickers (100) now covers realistic
      // per-page ticker diversity instead of the old hardcoded 8.
      const enrichedFlows = await enrichFlowsWithGex(page);

      console.log(
        `[market/flows] postgres ok — ${page.length} rows (min_premium=${min_premium}, since_hours=${since_hours}, max_dte=${max_dte ?? "any"}, before=${before ? "yes" : "no"})`
      );

      return {
        source: "cache" as const,
        flows: enrichedFlows,
        count: enrichedFlows.length,
        has_more: hasMore,
        next_before: nextBefore,
        platform_refs: platform,
      } satisfies FlowsPayload;
    };

    try {
      // Cursor pages are never cached — each `before` is a distinct slice.
      const cacheKey = `flows:pg:${since_hours}:${min_premium ?? 0}:${ticker ?? "all"}:${max_dte ?? "any"}:${pageLimit}`;
      const flowsTtlMs = flowsCacheTtlMs();
      if (!before) {
        const instant = await peekServerCache<FlowsPayload>(cacheKey);
        if (instant) {
          void withServerCache(cacheKey, flowsTtlMs, runQuery, {
            maxBlockMs: flowsMemberReadMaxBlockMs(),
            staleOnInflight: true,
            fallback: async () => lastGoodFlowsPayload ?? emptyFlowsPayload(),
          }).catch(() => undefined);
          return NextResponse.json(roundFloats(instant), { headers: NO_STORE_HEADERS });
        }
      }
      const payload = before
        ? await runQuery()
        : await withServerCache(cacheKey, flowsTtlMs, runQuery, {
            maxBlockMs: flowsMemberReadMaxBlockMs(),
            staleOnInflight: true,
            fallback: async () => lastGoodFlowsPayload ?? emptyFlowsPayload(),
          });
      if (payload.count > 0) lastGoodFlowsPayload = payload as FlowsPayload;
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
    const { page, hasMore, nextBefore } = paginateRows(rawRows, pageLimit);
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
