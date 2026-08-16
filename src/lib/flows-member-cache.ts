import { fetchRecentFlows } from "@/lib/db";
import { enrichFlowsWithGex } from "@/lib/flow-gex-enrichment";
import {
  HELIX_FLOW_DEFAULT_SINCE_HOURS,
  HELIX_FLOW_MAX_LIMIT,
} from "@/features/helix/lib/helix-flow-limits";
import { flowPageCursor } from "@/features/helix/lib/helix-flow-tape-merge";
import { flowsCacheTtlMs, flowsMemberReadMaxBlockMs } from "@/lib/providers/config";
import { withServerCache, peekServerCache } from "@/lib/server-cache";
import {
  FLOWS_WARM_LIMITS,
  flowsMemberCacheKey,
  type FlowsMemberQuery,
} from "@/lib/flows-member-cache-key";

export { FLOWS_WARM_LIMITS, flowsMemberCacheKey, type FlowsMemberQuery };

export type FlowsMemberPayload = {
  source: "cache";
  flows: Awaited<ReturnType<typeof enrichFlowsWithGex>>;
  count: number;
  has_more: boolean;
  next_before: string | null;
  degraded?: boolean;
};

type FlowsMemberQueryWithCursor = FlowsMemberQuery & { before?: string };

function paginateRows<T extends { alerted_at: string; event_at?: string | null }>(
  rows: T[],
  pageLimit: number
) {
  const hasMore = rows.length > pageLimit;
  const page = hasMore ? rows.slice(0, pageLimit) : rows;
  const nextBefore = hasMore ? flowPageCursor(page) : null;
  return { page, hasMore, nextBefore };
}

/** Same PG + GEX enrichment path as the member flows route (no platform_refs — unused by HELIX UI). */
export async function buildFlowsMemberPayload(q: FlowsMemberQueryWithCursor): Promise<FlowsMemberPayload> {
  const pageLimit = Math.min(Math.max(q.pageLimit, 1), HELIX_FLOW_MAX_LIMIT);
  const since_hours = Math.min(
    Math.max(q.since_hours ?? HELIX_FLOW_DEFAULT_SINCE_HOURS, 1),
    720
  );

  const rawRows = await fetchRecentFlows({
    limit: pageLimit + 1,
    ticker: q.ticker,
    min_premium: q.min_premium,
    since_hours,
    order: "recent",
    before: q.before,
    max_dte: q.max_dte,
  });

  const { page, hasMore, nextBefore } = paginateRows(rawRows, pageLimit);
  const enrichedFlows = await enrichFlowsWithGex(page);

  return {
    source: "cache",
    flows: enrichedFlows,
    count: enrichedFlows.length,
    has_more: hasMore,
    next_before: nextBefore,
  };
}

let lastGoodFlowsPayload: FlowsMemberPayload | null = null;

export function emptyFlowsMemberPayload(): FlowsMemberPayload {
  return {
    source: "cache",
    flows: [],
    count: 0,
    has_more: false,
    next_before: null,
    degraded: true,
  };
}

/** Read flows with shared server cache + maxBlockMs stale handoff (member route + warmers). */
export async function readFlowsMemberCached(q: FlowsMemberQueryWithCursor): Promise<FlowsMemberPayload> {
  if (q.before) return buildFlowsMemberPayload(q);

  const cacheKey = flowsMemberCacheKey(q);
  const ttlMs = flowsCacheTtlMs();
  const opts = {
    maxBlockMs: flowsMemberReadMaxBlockMs(),
    staleOnInflight: true,
    fallback: async () => lastGoodFlowsPayload ?? emptyFlowsMemberPayload(),
  };

  const instant = await peekServerCache<FlowsMemberPayload>(cacheKey);
  if (instant) {
    void withServerCache(cacheKey, ttlMs, () => buildFlowsMemberPayload(q), opts).catch(
      () => undefined
    );
    return instant;
  }

  const payload = await withServerCache(cacheKey, ttlMs, () => buildFlowsMemberPayload(q), opts);
  if (payload.count > 0) lastGoodFlowsPayload = payload;
  return payload;
}

/** Pre-warm shared Redis/in-process flows caches so first member poll stays sub-second. */
export async function warmFlowsMemberCaches(): Promise<{ warmed: number; keys: string[] }> {
  const keys: string[] = [];
  let warmed = 0;
  for (const pageLimit of FLOWS_WARM_LIMITS) {
    try {
      await readFlowsMemberCached({ pageLimit });
      keys.push(flowsMemberCacheKey({ pageLimit }));
      warmed += 1;
    } catch (err) {
      console.warn(
        `[flows-member-cache] warm limit=${pageLimit} failed:`,
        err instanceof Error ? err.message : String(err)
      );
    }
  }
  return { warmed, keys };
}
