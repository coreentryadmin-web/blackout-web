import {
  HELIX_FLOW_DEFAULT_SINCE_HOURS,
} from "@/features/helix/lib/helix-flow-limits";

export type FlowsMemberQuery = {
  pageLimit: number;
  ticker?: string;
  min_premium?: number;
  since_hours?: number;
  max_dte?: number;
};

/** Shared cache key for HELIX `/api/market/flows` head pages (cursor pages are never cached). */
export function flowsMemberCacheKey(q: FlowsMemberQuery): string {
  const since = q.since_hours ?? HELIX_FLOW_DEFAULT_SINCE_HOURS;
  const minPrem = q.min_premium ?? 0;
  const ticker = q.ticker ?? "all";
  const maxDte = q.max_dte ?? "any";
  return `flows:pg:${since}:${minPrem}:${ticker}:${maxDte}:${q.pageLimit}`;
}

/** Keys probed by site-latency + the HELIX desk default tape page. */
export const FLOWS_WARM_LIMITS = [30, 500] as const;
