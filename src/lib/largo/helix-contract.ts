/**
 * Largo product-contract fields for the HELIX surface (C2 freshness, C3 absence, C4 identity,
 * C5 direction, C8 provenance).
 *
 * One implementation for all four HELIX tape tools, for the same reason they share one fetch
 * builder: the defects worth preventing here are DRIFT defects. Two tools disagreeing about
 * whether the same tape is "stale", or about whether SPXW is SPX, is worse than either answer
 * being imperfect.
 *
 * Deliberately NOT a general Largo contract module — this is `helix-*`, scoped to this lane, so
 * it cannot collide with whatever shared `largo/contract/` the coordinator lands. If that module
 * arrives, these become thin adapters onto it.
 */
import { canonicalTicker } from "@/lib/largo/core/entities";

/** C2 vocabulary. */
export type Freshness = "live" | "delayed" | "cached" | "snapshot" | "stale";

/**
 * The desk's OWN stale threshold, not a new one. `FlowFeed.tsx` flips its badge to STALE at
 * `dataAgeMs > 5 * 60_000`. Largo must not call a tape fresh that the member's screen is
 * simultaneously calling stale — that is a contradiction the member can see.
 */
export const TAPE_STALE_AFTER_SECONDS = 300;
/** Under a minute old is genuinely current; between that and the stale flip it is lagging. */
export const TAPE_LIVE_WITHIN_SECONDS = 60;

/**
 * C2 — freshness of a tape read, from the age of its newest REAL print.
 *
 * Returns null for both fields when age is unmeasurable, which on this tape is common rather than
 * exceptional: most prints are ingest-stamped (`tape_time_estimated`) and carry no UW time at all,
 * so a window can hold 500 prints and still have no measurable age. Reporting "stale" there would
 * be as wrong as reporting "live" — neither is measured. C6's rule applied to C2: if it cannot be
 * calculated, omit it rather than invent it.
 */
export function tapeFreshness(newestAgeMinutes: number | null | undefined): {
  freshness: Freshness | null;
  age_seconds: number | null;
} {
  if (newestAgeMinutes == null || !Number.isFinite(newestAgeMinutes)) {
    return { freshness: null, age_seconds: null };
  }
  const age_seconds = Math.max(0, Math.round(newestAgeMinutes * 60));
  const freshness: Freshness =
    age_seconds < TAPE_LIVE_WITHIN_SECONDS
      ? "live"
      : age_seconds < TAPE_STALE_AFTER_SECONDS
        ? "delayed"
        : "stale";
  return { freshness, age_seconds };
}

/**
 * C5 — a directional read from the call share of premium.
 *
 * Thresholds are the panel's own (`ExpiryConcentration.tsx`: bull at >=55, bear at <=45), so the
 * word Largo uses and the colour the member sees cannot disagree.
 *
 * **null, never "neutral", when `callPct` is null.** Neutral is a MEASUREMENT — it says the tape
 * was read and came back balanced. Absence is not that, and collapsing the two re-introduces
 * exactly the `call_pct: 50` defect this lane just removed. `direction` is omitted from the
 * payload entirely rather than serialised as null-meaning-neutral.
 */
export function tapeDirection(callPct: number | null | undefined): "bullish" | "bearish" | "neutral" | null {
  if (callPct == null || !Number.isFinite(callPct)) return null;
  if (callPct >= 55) return "bullish";
  if (callPct <= 45) return "bearish";
  return "neutral";
}

/**
 * C4 — identity, WITHOUT rewriting the tape's own ticker.
 *
 * `canonicalTicker` (core/entities.ts) is imported rather than reimplemented — it already carries
 * the verified index set and the SPXW→SPX collapse, and a second list would drift from it.
 *
 * The tape's `ticker` is returned UNCHANGED alongside the canonical root. On the HELIX tape the
 * ticker IS the option root, and SPX/SPXW are different settlement series that both trade live
 * (measured 2026-08-20: SPX 350 prints, SPXW 9, same window). Rewriting `ticker` in place would
 * merge two real instruments into one leaderboard row; `canonical_root` + `weekly_variant` give
 * a cross-product join key without destroying the distinction.
 */
export function helixTickerIdentity(ticker: string | null | undefined): {
  ticker: string | null;
  ticker_class: "equity" | "etf" | "index" | null;
  canonical_root: string | null;
  weekly_variant: boolean;
} {
  if (!ticker) return { ticker: null, ticker_class: null, canonical_root: null, weekly_variant: false };
  const c = canonicalTicker(ticker);
  return {
    ticker: ticker.toUpperCase(),
    // null, not a guessed "equity", when the input does not parse as a symbol at all.
    ticker_class: c?.kind ?? null,
    canonical_root: c?.key ?? null,
    weekly_variant: c?.weeklyVariant ?? false,
  };
}

/**
 * C3 — a real absence, distinguishable from a measured empty.
 *
 * Used ONLY when the read genuinely failed. A quiet tape is NOT unavailable: it is a successful
 * measurement whose answer is "nothing traded", and it keeps `available: true` with an
 * `empty_reason`. Collapsing the two would tell the model a working tool is broken every
 * off-hours evening, and would strip the one distinction `get_helix_derived`'s description
 * already teaches the model to preserve.
 */
export function unavailable(
  reason: string,
  whatIsMissing: string,
  retryable: boolean
): { available: false; unavailable: { reason: string; what_is_missing: string; retryable: boolean } } {
  return { available: false, unavailable: { reason, what_is_missing: whatIsMissing, retryable } };
}

/** C8 — where the numbers came from. The HELIX tape is the Postgres `flow_alerts` ingest. */
export const HELIX_TAPE_PROVENANCE = Object.freeze({
  source: "internal_db" as const,
  computed_by: "helix-tape-analytics",
});
