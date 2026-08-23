import type { FlowAlert } from "@/lib/api";

/** Merge a sparse SSE row with a richer REST row (same print). Prefer non-null chain fields. */
export function mergeFlowAlerts(primary: FlowAlert, fallback?: FlowAlert | null): FlowAlert {
  if (!fallback) return primary;
  return {
    ...fallback,
    ...primary,
    fill_price: primary.fill_price ?? fallback.fill_price,
    ask_pct: primary.ask_pct ?? fallback.ask_pct,
    underlying_price: primary.underlying_price ?? fallback.underlying_price,
    open_interest: primary.open_interest ?? fallback.open_interest,
    implied_volatility: primary.implied_volatility ?? fallback.implied_volatility,
    otm_pct: primary.otm_pct ?? fallback.otm_pct,
    alert_rule: primary.alert_rule ?? fallback.alert_rule,
    gex_proximity: primary.gex_proximity ?? fallback.gex_proximity,
    score: primary.score > 0 ? primary.score : fallback.score,
    alerted_at: primary.alerted_at || fallback.alerted_at,
    event_at: primary.event_at ?? fallback.event_at,
    alert_id: primary.alert_id ?? fallback.alert_id,
  };
}

/** The minimum a print needs to be identified. Structural, so the key cannot be built from a
 *  richer type on one surface and a sparser one on another. */
export type FlowIdentity = {
  ticker: string;
  strike: number;
  option_type: string;
  alerted_at?: string | null;
};

/**
 * The seconds-precision composite that identifies ONE print across the SSE and REST paths.
 *
 * WHY THIS IS EXPORTED RATHER THAN WRITTEN OUT (extracted 2026-08-23). This exact expression
 * existed FOUR times in three files — twice inside `findMatchingFlow` itself, once in
 * `FlowFeed.tsx`'s `flowCompositeKey`, and once in `helix-flow-tape-merge.ts`'s key builder. All
 * four were byte-identical, so nothing was broken and no value test could have caught anything.
 * That is exactly the situation #2720 was written for: when every copy agrees, the defect is the
 * SHAPE of the lane, not any value in it.
 *
 * What made it worth removing is the blast radius if one copy ever moved. This key decides whether
 * two rows are the SAME PRINT, and the answer feeds tape dedup, SSE↔REST merging, and — through
 * `findMatchingFlow` — the Vector desk's own flow hook. A single edit to one copy (adding `expiry`,
 * widening the slice, trimming whitespace) would make one surface merge two rows while another
 * showed them twice. That does not fail loudly; it presents as duplicated prints on one page and
 * not the other, which reads as a data problem rather than a code one.
 *
 * SECONDS PRECISION IS DELIBERATE. `.slice(0, 19)` keeps `YYYY-MM-DDTHH:MM:SS` and drops
 * milliseconds and zone. SSE and REST can stamp the same print with different sub-second values, so
 * matching on the full ISO string would miss the pair this function exists to find. Since #2723,
 * every `alerted_at` is produced by `new Date(ms).toISOString()`, so the format is fixed and the
 * slice always lands on the same boundary.
 */
export function flowCompositeKey(a: FlowIdentity): string {
  return `${a.ticker}|${a.strike}|${a.option_type}|${String(a.alerted_at ?? "").slice(0, 19)}`;
}

export function findMatchingFlow(alerts: FlowAlert[], incoming: FlowAlert): number {
  const id = incoming.alert_id;
  if (id) {
    const byId = alerts.findIndex((a) => a.alert_id === id);
    if (byId >= 0) return byId;
  }
  const key = flowCompositeKey(incoming);
  return alerts.findIndex((a) => flowCompositeKey(a) === key);
}
