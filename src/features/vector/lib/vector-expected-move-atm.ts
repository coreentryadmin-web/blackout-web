/**
 * Derive the REAL inputs the expected-move engine needs — an ATM implied vol and a time-to-expiry —
 * from the options chain, scoped to a DTE horizon. Pure (the chain fetch lives in the server shell),
 * so the ATM-selection + horizon logic is unit-tested without a network.
 *
 * Expected move is a PER-EXPIRY quote, but the horizon toggle can span several expiries. We quote the
 * horizon's NEAREST (front) expiry — the dominant, most-liquid one a desk reads first — using the
 * same `expiriesForHorizon` scoping the GEX walls / max-pain use (so a 0DTE horizon over a weekend
 * honestly snaps to the next live expiry instead of returning nothing).
 *
 * ATM IV = the implied vol at the strike nearest spot for that expiry, averaged across the call and
 * put legs when both are present (the two ATM legs quote near-identical IV; averaging smooths a
 * one-sided quote gap). Only real, positive IVs count — a strike with no usable IV is skipped, and if
 * nothing usable remains the function returns null rather than inventing a vol.
 */

import { expiriesForHorizon, type VectorDteHorizon } from "./vector-dte-horizon";
import type { ReconstructContract } from "./vector-gex-reconstruct";
import type { ExpectedMoveInput } from "./vector-expected-move";

const DAYS_PER_YEAR = 365;

/** Remaining wall-clock time to expiry in ACT/365 years — options expire ~16:00 ET (20:00 UTC).
 *  Unlike yearsToExpiry (anchored at session open for stable GEX gamma), this shrinks through the
 *  trading day so 0DTE expected-move bands narrow as expiry approaches. */
function remainingYearsToExpiry(expiry: string, nowMs: number): number {
  const exp = Date.parse(`${expiry}T20:00:00Z`);
  if (!Number.isFinite(exp)) return 0;
  return Math.max((exp - nowMs) / (365 * 86_400_000), 1 / (365 * 24 * 60));
}

/** True once an expiry's ~16:00 ET (20:00 UTC) close has passed, relative to `nowMs`. */
function isExpirySettled(expiry: string, nowMs: number): boolean {
  const close = Date.parse(`${expiry}T20:00:00Z`);
  return Number.isFinite(close) && close <= nowMs;
}

/**
 * Pick the nearest NOT-YET-SETTLED expiry from a sorted (chronological) list, falling back to the
 * latest entry when every scoped expiry has already closed (never empty-handed on a non-empty list).
 *
 * BUG FOUND (Ask Largo standing mandate, 2026-10-07, live repro: INTC swing HOLD play-brief
 * post-close, horizon "all") — `expiriesForHorizon` only drops a PAST CALENDAR DAY (dte < 0), so
 * today's own listed expiry stays in the scoped set through the entire evening even hours after its
 * 20:00 UTC close. The old code always took `scoped[0]` as "front", so once the market closed for
 * the day it kept quoting TODAY's already-dead contract: `remainingYearsToExpiry` floors a
 * negative/zero time-to-expiry at ~1 minute, producing a near-zero band (live repro: INTC
 * ±$0.03 on a 9DTE swing position, spot $113.18, real ATM IV 20.78%) that the UI narrates as
 * "Inside band — mid-band — room to run inside envelope" — reading as "calm, contained market"
 * when the true state is "nothing live left to quote today." Same shape as the FINDINGS 2026-08-11
 * settled-expiry GEX-walls bug (`liveExpiries` dropping settled expiries for walls/max-pain), here
 * hitting the expected-move cone instead, which that earlier fix never touched.
 */
function nearestLiveExpiry(sortedScoped: readonly string[], nowMs: number): string {
  return sortedScoped.find((e) => !isExpirySettled(e, nowMs)) ?? sortedScoped[sortedScoped.length - 1]!;
}

export type ExpectedMoveDerived = ExpectedMoveInput & {
  /** The front expiry the quote is scoped to (YYYY-MM-DD). */
  expiry: string;
};

/**
 * Pick the ATM IV + time-to-expiry for the horizon's front expiry from a chain snapshot.
 * Returns null when there's no scoped expiry or no usable ATM IV — never a fabricated vol.
 *
 * @param contracts banded chain snapshot (all horizons) — needs strike/expiry/iv/type.
 * @param spot       live underlying, used to find the ATM strike.
 * @param horizon    the member's DTE selection.
 * @param todayYmd   session date (YYYY-MM-DD) for horizon scoping + time-to-expiry.
 * @param nowMs      wall-clock instant, for the settled-expiry roll-forward below. Defaults to
 *                   `Date.now()` so every existing call site keeps working unchanged; tests inject
 *                   a fixed instant to exercise the post-close path deterministically.
 */
export function deriveExpectedMoveInputs(
  contracts: readonly ReconstructContract[],
  spot: number,
  horizon: VectorDteHorizon,
  todayYmd: string,
  nowMs: number = Date.now()
): ExpectedMoveDerived | null {
  if (!(spot > 0) || contracts.length === 0) return null;

  const allExpiries = [...new Set(contracts.map((c) => c.expiry))].sort();
  const scoped = expiriesForHorizon(allExpiries, horizon, todayYmd);
  if (scoped.length === 0) return null;

  // Nearest expiry of the scoped set that hasn't already settled (see nearestLiveExpiry's doc
  // comment) — expiries sort lexicographically = chronologically.
  const frontExpiry = nearestLiveExpiry([...scoped].sort(), nowMs);
  const atExpiry = contracts.filter((c) => c.expiry === frontExpiry && c.iv > 0);
  if (atExpiry.length === 0) return null;

  // The ATM strike: the strike with a usable IV nearest to spot.
  let atmStrike = atExpiry[0]!.strike;
  let bestDist = Math.abs(atmStrike - spot);
  for (const c of atExpiry) {
    const d = Math.abs(c.strike - spot);
    if (d < bestDist) {
      bestDist = d;
      atmStrike = c.strike;
    }
  }

  // Average the call + put IV at that ATM strike (whichever legs are present with real IV).
  const atmLegs = atExpiry.filter((c) => c.strike === atmStrike);
  const ivs = atmLegs.map((c) => c.iv).filter((v) => v > 0);
  if (ivs.length === 0) return null;
  const atmIv = ivs.reduce((s, v) => s + v, 0) / ivs.length;

  // Remaining wall-clock time to expiry so 0DTE bands shrink through the session (not pinned
  // at session-open like the GEX gamma helper). Floored at ~1 min to avoid a zero/negative DTE —
  // the roll-forward above means this floor is now only ever hit in the last minute before a
  // still-live expiry's own close, not hours after a dead one's.
  const dteDays = remainingYearsToExpiry(frontExpiry, nowMs) * DAYS_PER_YEAR;

  return { spot, atmIv, dteDays, expiry: frontExpiry };
}

/**
 * Earnings-scoped expected move: quote the nearest listed expiry ON OR AFTER the print date
 * (the weekly/monthly bracketing the event). Falls back to the latest expiry before the print
 * when the chain has no future-dated series (honest last resort). Returns null when no usable IV.
 */
export function deriveExpectedMoveInputsForEarningsDate(
  contracts: readonly ReconstructContract[],
  spot: number,
  earningsDateYmd: string,
  _todayYmd: string,
  nowMs: number = Date.now()
): ExpectedMoveDerived | null {
  if (!(spot > 0) || contracts.length === 0 || !/^\d{4}-\d{2}-\d{2}$/.test(earningsDateYmd)) {
    return null;
  }

  const allExpiries = [...new Set(contracts.map((c) => c.expiry))].sort();
  const onOrAfter = allExpiries.filter((e) => e >= earningsDateYmd);
  // Same settled-expiry roll-forward as deriveExpectedMoveInputs above: a print dated TODAY can
  // have onOrAfter[0] be today's own already-closed expiry hours after the bell — prefer the
  // nearest still-live one in that set before falling back to the honest before-print expiry.
  const frontExpiry =
    (onOrAfter.length ? nearestLiveExpiry(onOrAfter, nowMs) : null) ??
    allExpiries.filter((e) => e <= earningsDateYmd).at(-1) ??
    null;
  if (!frontExpiry) return null;

  const atExpiry = contracts.filter((c) => c.expiry === frontExpiry && c.iv > 0);
  if (atExpiry.length === 0) return null;

  let atmStrike = atExpiry[0]!.strike;
  let bestDist = Math.abs(atmStrike - spot);
  for (const c of atExpiry) {
    const d = Math.abs(c.strike - spot);
    if (d < bestDist) {
      bestDist = d;
      atmStrike = c.strike;
    }
  }

  const atmLegs = atExpiry.filter((c) => c.strike === atmStrike);
  const ivs = atmLegs.map((c) => c.iv).filter((v) => v > 0);
  if (ivs.length === 0) return null;
  const atmIv = ivs.reduce((s, v) => s + v, 0) / ivs.length;

  const dteDays = remainingYearsToExpiry(frontExpiry, nowMs) * DAYS_PER_YEAR;

  return { spot, atmIv, dteDays, expiry: frontExpiry };
}
