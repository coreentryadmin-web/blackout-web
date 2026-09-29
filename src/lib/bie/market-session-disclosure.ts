// Shared "compute is fresh but the market is CLOSED" disclosure — the one misleading combination
// every compute-recency + market-session pair in Largo can produce, factored out so there is only
// ONE implementation of the "is this misleading" conditional (per `vector-state-freshness.ts`'s
// own module doc, which named the risk of a second, independently-drifting copy at the GEX-matrix
// call site — raised on #4076 comment 5750099882, fixed here rather than forked).
//
// A compute that finished moments ago (a weekend/holiday self-warm, off the last close) genuinely
// IS fresh by compute-recency — `freshness: "live"`/`"recent"` is not wrong. It is incomplete: the
// underlying tape has not moved since the market shut, so "fresh" alone overstates how current the
// number is. This module answers the orthogonal question ("is the market open") and phrases the
// disclosure only for the specific combination where it would otherwise be silently misleading.

import type { BieFreshness } from "@/lib/bie/answer-envelope";
import type { MarketPhase } from "@/lib/et-session-facts";

/** "42s" under 90s, else whole minutes, else whole-tenth hours — shared by every freshness note. */
export function formatFreshnessAge(sec: number): string {
  if (sec < 90) return `${sec}s`;
  const min = Math.round(sec / 60);
  return min < 60 ? `${min}m` : `${Math.round(min / 6) / 10}h`;
}

/**
 * Disclosure for exactly the misleading combination: compute is fresh (`freshness` is "live" or
 * "recent") but the market itself is CLOSED, so the freshness verdict alone would overstate how
 * current the underlying tape is. Null whenever that combination does not apply — including when
 * `freshness` is already "stale"/"unknown" (that verdict's own note already covers it) or when the
 * market is genuinely open (OPEN/PRE-MARKET/AFTER-HOURS all describe a session that has moved
 * today, so the compute's freshness claim is not misleading there).
 */
export function marketSessionDisclosure(
  freshness: BieFreshness,
  ageSec: number,
  marketSession: MarketPhase,
): string | null {
  if (marketSession !== "CLOSED") return null;
  if (freshness !== "live" && freshness !== "recent") return null;
  return `Computed ${formatFreshnessAge(ageSec)} ago, but the market is CLOSED as of this read — this reflects the last session's tape, not a live tick, however fresh the compute looks.`;
}
