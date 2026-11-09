import type { SpxTapeItem } from "@/features/spx/lib/spx-desk";
import { spxTapeSkew } from "@/features/spx/lib/spx-tape-direction";

const TAPE_SKEW_MIN_TOTAL = 250_000;

/**
 * BUG FIX (round-480 DISCOVERY sweep): this used to bucket the top-8 flow prints by raw option
 * TYPE alone — every call print counted toward `bull`, every put toward `bear` — the exact rule
 * `spx-tape-direction.ts`'s own header documents replacing in the confluence tape factor, because
 * it never asked whether those calls/puts were BOUGHT or SOLD. That file's measurement (168h of
 * the real SPX tape, 993 8-print windows — the identical slice this badge scores) found the naive
 * rule SIGN-FLIPS the verdict in 16.8% of windows versus the aggressor-aware rule, because a block
 * of aggressively-SOLD calls is bearish conviction, not bullish, and the reverse for sold puts.
 *
 * `spx-signals.ts` (the real confluence factor) and `spx-lotto-catalyst.ts` both migrated to the
 * aggressor-aware `spxTapeSkew` (via `flowDirection`'s four-way bought/sold × call/put table) when
 * that defect was fixed — this member-facing "CALL skew / PUT skew" badge on the SPX Slayer matrix
 * strip was the one call site left behind on the old rule, so a member could watch this badge say
 * "CALL skew" while the desk's own confluence tape factor, scoring the identical 8 prints, called
 * it bearish. `SpxTapeItem.ask_pct` (the aggressor share) was already threaded onto this exact
 * type for that purpose — carried through from the flow brief — just never read here.
 *
 * Reusing `spxTapeSkew` (not re-deriving the table) is the fix, not a parallel patch: two lanes
 * reading the same 8 prints must not be able to drift into disagreeing about what "bullish" means
 * again. `bull`/`bear` here are the same two directional buckets that function already returns;
 * premium whose aggressor can't be read drops out of both (never guessed), same as every other
 * consumer of this table.
 */
export function computeTapeSkew(tape: SpxTapeItem[] | undefined): {
  bull: number;
  bear: number;
  skew: "call" | "put" | "neutral";
} {
  const { bull, bear } = spxTapeSkew(
    (tape ?? []).filter((x) => x.kind === "flow").slice(0, 8)
  );
  const total = bull + bear;
  let skew: "call" | "put" | "neutral" = "neutral";
  if (total >= TAPE_SKEW_MIN_TOTAL) {
    if (bull >= bear * 1.25) skew = "call";
    else if (bear >= bull * 1.25) skew = "put";
  }
  return { bull, bear, skew };
}

export function fmtTapePremium(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  // Round BEFORE promoting: anything that rounds up to 1000K (n in [999,500, 999,999]) must read
  // as "$1.0M", not "$1000K" — the same round-first-then-promote boundary bug already fixed
  // across this repo's other money formatters (fmt-money.ts, zerodte-board-format.ts, etc).
  // `flowCallPrem`/`flowPutPrem` on SpxMatrixTapeStrip are SPX 0DTE call/put flow AGGREGATES
  // (sums across prints), which routinely sit in the high hundred-thousands — this boundary is
  // hit in real production data, not a theoretical edge case.
  if (n >= 1_000) {
    const k = Math.round(n / 1_000);
    if (k >= 1000) return `$${(n / 1_000_000).toFixed(1)}M`;
    return `$${k}K`;
  }
  return `$${Math.round(n)}`;
}
