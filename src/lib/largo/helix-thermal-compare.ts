/**
 * HELIX + Thermal side-by-side — deterministic parallel read, not model-merged prose.
 * Powers the compare card UI and the conflict chip on the status strip.
 *
 * Two card modes:
 * - `helix_thermal` — one ticker, HELIX flow vs Thermal gamma (SPX default)
 * - `peer_tickers` — 2–3 tickers, flow + gamma per name (earnings / peer days)
 */

import { roundFloats } from "@/lib/round-floats";
// ONE definition of "what session is it" across every lane. A local Intl call here would be a
// second definition, and two tools that disagree about today is exactly the failure #2418/#2420
// were opened for.
import { etSessionDate, etStamp } from "@/lib/largo/temporal/bar-session-date";
import { marketPhaseFromEt } from "@/lib/largo/core/system-status";
// ONE tape-selection definition, shared with get_helix_tape_analytics. `helixTapeFetchOptions`
// is the load-bearing `order: "recent"` selection — see its own doc in helix-tape-analytics.ts.
// Importing it here is how this card stops being the third HELIX consumer that quietly disagreed
// with the other two about which prints the tape even contains (see fetchTickerFlowAndGamma).
import { helixTapeFetchOptions, tapeWindowCoverage } from "@/lib/largo/helix-tape-analytics";
import { directionLabel, directionalPremium } from "@/features/helix/lib/helix-flow-aggression";
import type { FlowAlert } from "@/lib/api";
import {
  HELIX_FLOW_PAGE_SIZE,
  HELIX_FLOW_MAX_LIMIT,
  HELIX_FLOW_DEFAULT_SINCE_HOURS,
  HELIX_FLOW_MAX_SINCE_HOURS,
} from "@/features/helix/lib/helix-flow-limits";

// Shapes and guards live in the CLIENT-SAFE module — see compare-card-types.ts for why a client
// component importing them from HERE breaks the webpack build. Re-exported so existing server
// callers keep their import paths unchanged.
import {
  DEFAULT_PEER_COMPARE_TICKERS,
  type CompareFreshness,
  type CompareGammaPosture,
  type CompareRegimeInteraction,
  type CompareVolatilityRegime,
  type LargoCompareCard,
  type HelixThermalCompareCard,
  type HelixThermalSide,
  type PeerTickerCompareCard,
  type PeerTickerRow,
} from "@/lib/largo/compare-card-types";

export type {
  CompareFreshness,
  CompareGammaPosture,
  CompareRegimeInteraction,
  CompareVolatilityRegime,
  HelixThermalSide,
  HelixThermalCompareCard,
  PeerTickerRow,
  PeerTickerCompareCard,
  LargoCompareCard,
} from "@/lib/largo/compare-card-types";
export {
  DEFAULT_PEER_COMPARE_TICKERS,
  isHelixThermalCompareCard,
  isPeerTickerCompareCard,
} from "@/lib/largo/compare-card-types";

/**
 * Bias off the AGGRESSOR-AWARE read (`directionalPremium`/`directionLabel`,
 * `helix-flow-aggression.ts`), not a naive call/put premium share. Call-share alone conflates a
 * BOUGHT call with a SOLD one — the exact rule this card used to run, before its own comment above
 * the removed `flowBiasFromPremiums` explained the tie-break band as if a bigger call share always
 * meant more bullish conviction. It doesn't: a sold call is bearish regardless of size. Mapped onto
 * this card's local vocabulary (`"unknown"` = insufficient/unreadable data, `"mixed"` = genuinely
 * split rather than unreadable) so callers checking `bias === "unknown"` for "nothing to show" keep
 * working.
 */
function flowBiasFromDirectionalPremium(
  premium: ReturnType<typeof directionalPremium>
): HelixThermalSide["bias"] {
  const label = directionLabel(premium);
  if (label === "undetermined") return "unknown";
  if (label === "mixed") return "mixed";
  return label;
}

/**
 * Map dealer gamma posture onto the two axes it genuinely has.
 *
 * WHY THIS IS NOT A REGEX OVER `gamma_regime_read` ANY MORE
 * --------------------------------------------------------
 * It used to be, and it inverted the read on every ticker measured. The old form tested
 * `/positive|long gamma|support|pin/` FIRST and returned "bullish" on a hit — but
 * `gamma_regime_read` is PROSE that ends with a levels list ("… Resistance 780, support
 * 765."), so the word "support" matched on tapes that the very same sentence described as
 * "dealers are net short gamma at EVERY strike … moves accelerate". Live 2026-08-21,
 * SPY/SPX/QQQ all classified `bullish` off a short-gamma matrix — 3 of 3 inverted.
 *
 * The ordering was only the proximate cause. The real defect is that the prose was being
 * scraped at all: `GexPositioning` already carries `gamma_posture` as a TYPED enum
 * ("long" | "short" | null), set from `gex.regime.posture`, sitting directly beside the
 * prose the code was parsing. Reading the enum makes the classification exact and immune
 * to any future rewording of the sentence.
 *
 * And the axis itself was wrong. Dealer gamma is not directional: short gamma amplifies a
 * move in EITHER direction, so calling it "bearish" asserts a direction the matrix never
 * measured. The gamma side therefore never claims bullish/bearish. It reports:
 *   long  gamma -> bias "neutral" (dealers fade both ways: mean-reverting), vol "suppressing"
 *   short gamma -> bias "mixed"   (dealers hedge with the move: both ways), vol "amplifying"
 *   null        -> bias "unknown", vol null
 */
function thermalReadFromPosture(posture: CompareGammaPosture): {
  bias: HelixThermalSide["bias"];
  volatility_regime: CompareVolatilityRegime;
} {
  if (posture === "long") return { bias: "neutral", volatility_regime: "suppressing" };
  if (posture === "short") return { bias: "mixed", volatility_regime: "amplifying" };
  return { bias: "unknown", volatility_regime: null };
}

/**
 * Directional opposition between two sides. Only "bullish" vs "bearish" counts: every other
 * pairing either involves a non-directional read ("neutral"/"mixed") or an absent one
 * ("unknown"), and neither is a disagreement.
 *
 * Callers must NOT treat a `false` here as "the two sides agree" — see `describeConflict`,
 * which distinguishes "compared, no conflict" from "nothing to compare".
 */
function biasesConflict(a: HelixThermalSide["bias"], b: HelixThermalSide["bias"]): boolean {
  return (a === "bullish" && b === "bearish") || (a === "bearish" && b === "bullish");
}

/** A side carries a real directional reading (as opposed to absent or non-directional). */
function isDirectional(bias: HelixThermalSide["bias"]): boolean {
  return bias === "bullish" || bias === "bearish";
}

/**
 * Resolve the conflict flag AND the note together, so the payload can never say `false`
 * without saying WHY it is false.
 *
 * The bug this closes: with both sides cold the card served `conflict: false,
 * conflict_note: null` — indistinguishable from a genuine all-clear. A reader (member or
 * model) takes that as "flow and gamma were checked and they agree", when in fact neither
 * side produced a reading. Two absences are not an agreement.
 *
 * Note the gamma side is never directional by construction now, so a flow-vs-gamma
 * DIRECTION conflict can no longer fire on the helix_thermal card. That is the honest
 * outcome, not a regression: the old `true`s were manufactured by the inverted prose
 * classifier. The conflict machinery is retained because `peer_tickers` rows compare two
 * FLOW biases against each other, where opposition is real and directional.
 */
function describeConflict(
  aLabel: string,
  a: HelixThermalSide,
  bLabel: string,
  b: HelixThermalSide
): { conflict: boolean; conflict_note: string | null } {
  if (!isDirectional(a.bias) || !isDirectional(b.bias)) {
    const missing = [!isDirectional(a.bias) ? aLabel : null, !isDirectional(b.bias) ? bLabel : null]
      .filter(Boolean)
      .join(" and ");
    return {
      conflict: false,
      conflict_note: `Not compared — ${missing} has no directional reading`,
    };
  }
  if (biasesConflict(a.bias, b.bias)) {
    return {
      conflict: true,
      conflict_note: `${aLabel} reads ${a.bias} while ${bLabel} reads ${b.bias}`,
    };
  }
  return { conflict: false, conflict_note: `${aLabel} and ${bLabel} both read ${a.bias}` };
}

/**
 * Name the flow-vs-regime INTERACTION — the honest replacement for the direction "conflict" the
 * broken classifier used to manufacture. Never a direction call on the gamma side; it says what
 * the volatility regime does TO the flow's directional thesis.
 *
 * Null unless both sides produced a real reading, matching describeConflict's "nothing was
 * compared" honesty.
 */
export function regimeInteractionFor(
  flowBias: HelixThermalSide["bias"],
  vol: CompareVolatilityRegime
): CompareRegimeInteraction {
  if (vol == null) return null;
  if (flowBias !== "bullish" && flowBias !== "bearish" && flowBias !== "neutral") return null;
  const side = flowBias === "neutral" ? "Balanced flow" : `${flowBias[0].toUpperCase()}${flowBias.slice(1)} flow`;
  const read =
    vol === "amplifying"
      ? `${side} into an amplifying regime — dealers hedge WITH the move, so it accelerates in ` +
        `either direction. Higher variance than the flow alone implies.`
      : `${side} into a suppressing regime — dealers fade the move toward heavy strikes, so ` +
        `follow-through is damped.`;
  return { flow_bias: flowBias, volatility_regime: vol, read };
}

/** Whole seconds between an ISO stamp and `now`, or null when the stamp is unusable. */
function ageSecondsFromIso(iso: string | null | undefined, now: number): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  return Math.max(0, Math.round((now - t) / 1000));
}

/**
 * The window phrase the flow one-liner appends — and the window it names must be the ANALYSED span
 * of the prints, not the requested lookback.
 *
 * "Net call premium leads on the tape" reads as today. The old phrase named the REQUESTED window
 * (168h), but on an index name the 500-print limit binds long before that window does — a 168h /
 * limit-500 request returned 54 minutes of tape live 2026-08-20 — so "(last 168h)" described under
 * an hour of prints. The requested bound is an intent; only the prints are evidence. When the limit
 * bound, the phrase says so, because the honest description is then "the most recent N prints".
 *
 * Rounds to 1dp for the STRING only (the numeric window_hours field stays raw for roundFloats);
 * sub-hour spans are named in minutes so a 40-minute burst is not printed as "0h" — the same
 * zero-hour trap tapeWindowCoverage carries actual_minutes to avoid.
 */
export function flowWindowPhrase(
  actualHours: number | null | undefined,
  actualMinutes: number | null | undefined,
  limitReached: boolean | null | undefined
): string {
  // No print carried a usable time — we cannot name a MEASURED span. Do NOT fall back to the
  // requested window here: naming a window the prints do not support is the fabrication this fixes.
  if (actualHours == null) return limitReached ? " (most recent prints)" : "";
  const span =
    actualHours < 1 && actualMinutes != null
      ? `${actualMinutes}m`
      : `${Math.round(actualHours * 10) / 10}h`;
  return limitReached ? ` (last ${span}, print-capped)` : ` (last ${span})`;
}

function flowSummary(bias: HelixThermalSide["bias"], win: string): string {
  if (bias === "bullish") return `Net call premium leads on the tape${win}`;
  if (bias === "bearish") return `Net put premium leads on the tape${win}`;
  if (bias === "neutral") return `Flow is balanced call vs put${win}`;
  return `Insufficient flow${win || " in window"}`;
}

function gammaSummary(gammaRegime: string | null, flip: number | null | undefined): string {
  if (gammaRegime != null && String(gammaRegime).trim()) return String(gammaRegime);
  if (flip != null) return `Flip ${flip}`;
  return "Positioning unavailable";
}

type FlowTapeRow = { ticker?: string; premium?: number; option_type?: string; ask_pct?: number | null };

/**
 * The subset of `GexPositioning` this card reads. Declared structurally (rather than
 * importing the full server-only type) so the PURE derivation below can be unit-tested
 * without dragging the provider graph — and so a test can feed it a REAL captured
 * production snapshot verbatim.
 */
export type ComparePositioningInput = {
  gamma_posture?: "long" | "short" | null;
  gamma_regime_read?: string | null;
  /** ISO time the underlying matrix was computed — NOT the time this card was built. */
  asof?: string | null;
  flip?: number | null;
  call_wall?: number | null;
  put_wall?: number | null;
  spot?: number | null;
} | null;

/**
 * PURE derivation: positioning snapshot + flow rows -> the two compare sides.
 *
 * Split out of `fetchTickerFlowAndGamma` so the classification can be tested against real
 * captured payloads with no network, no DB and no module mocking. That matters here
 * specifically: the `@/` tsconfig alias does not resolve under
 * `--experimental-test-module-mocks` (same tsx resolver-hook interaction that bit #2073),
 * so a test that tried to mock the aliased dynamic imports below could not run at all.
 * Keeping the judgement pure sidesteps that entirely.
 */
export function compareSidesFrom(
  pos: ComparePositioningInput,
  flow: {
    rows: readonly FlowTapeRow[];
    available: boolean;
    /** The ANALYSED span of the prints (evidence), in hours — NOT the requested lookback. */
    windowHours?: number | null;
    /** The same span in whole minutes, so a sub-hour burst is named in minutes, not rounded to 0h. */
    windowMinutes?: number | null;
    /** The REQUESTED lookback (intent), carried through as provenance. */
    requestedWindowHours?: number | null;
    /** TRUE when the print limit bound before the window did — the tell window_hours is capped. */
    windowLimitReached?: boolean | null;
  },
  nowMs = Date.now()
): {
  flow: HelixThermalSide;
  gamma: HelixThermalSide;
  conflict: boolean;
  conflict_note: string | null;
} {
  let callPrem = 0;
  let putPrem = 0;
  for (const row of flow.rows) {
    const prem = Number(row.premium ?? 0);
    if (!Number.isFinite(prem)) continue;
    if (/call/i.test(String(row.option_type ?? ""))) callPrem += prem;
    else if (/put/i.test(String(row.option_type ?? ""))) putPrem += prem;
  }

  // `call_premium`/`put_premium` above stay a plain option-type sum (a legitimate "how much of
  // each type traded" metric, unchanged) but `bias` — the field that drives the conflict chip and
  // `regimeInteractionFor`'s narrative prose — comes from the aggressor-aware read, not call share.
  const directionalPrem = directionalPremium(
    flow.rows.map((r) => ({ option_type: r.option_type, ask_pct: r.ask_pct, premium: Number(r.premium ?? 0) }))
  );
  const flowBias = flowBiasFromDirectionalPremium(directionalPrem);
  const gammaRegime = pos?.gamma_regime_read ?? null;
  // Structured posture off the positioning contract — NOT a regex over `gamma_regime_read`.
  // See thermalReadFromPosture() for the inversion that cost us.
  const gammaPosture: CompareGammaPosture = pos?.gamma_posture ?? null;
  const { bias: gammaBias, volatility_regime } = thermalReadFromPosture(gammaPosture);

  // NOTHING MEASURED IS NULL, NOT ZERO.
  //
  // `net_premium` used to be `callPrem - putPrem` unconditionally, so a card built with an empty
  // tape served `net_premium: 0` beside `bias: "unknown"`. Zero is a real, quotable reading —
  // "SPX net premium is flat" — manufactured out of no data. Live payload 2026-08-21 showed
  // exactly that pairing, and note `call_premium`/`put_premium` were ALREADY correctly null: only
  // the DERIVED net was fabricated, which is the one a reader is least likely to question.
  const priced = callPrem > 0 || putPrem > 0;
  const flowSide: HelixThermalSide = {
    available: flow.available,
    bias: flowBias,
    summary: flowSummary(
      flowBias,
      flowWindowPhrase(flow.windowHours ?? null, flow.windowMinutes ?? null, flow.windowLimitReached ?? null)
    ),
    net_premium: priced ? callPrem - putPrem : null,
    call_premium: callPrem || null,
    put_premium: putPrem || null,
    print_count: flow.rows.length || null,
    // The ANALYSED span of the prints (evidence), NOT the requested window: on an index name the
    // 500-print limit binds before the 168h window does, so echoing the request read "last 168h"
    // over ~1h of tape. window_hours_requested keeps the intent; window_limit_reached is the tell.
    window_hours: flow.windowHours ?? null,
    window_hours_requested: flow.requestedWindowHours ?? null,
    window_limit_reached: flow.windowLimitReached ?? null,
    freshness: flow.available ? "live" : null,
    age_seconds: null,
  };

  const gamma: HelixThermalSide = {
    available: pos != null,
    bias: gammaBias,
    summary: gammaSummary(gammaRegime != null ? String(gammaRegime) : null, pos?.flip),
    flip: pos?.flip ?? null,
    call_wall: pos?.call_wall ?? null,
    put_wall: pos?.put_wall ?? null,
    spot: pos?.spot ?? null,
    gamma_regime: gammaRegime != null ? String(gammaRegime) : null,
    gamma_posture: gammaPosture,
    volatility_regime,
    // getGexPositioning is a documented STRICT CACHE READER — it never hits a second upstream —
    // so "cached" is the honest steady state here, not a degraded one. Null when there is no read.
    // WHEN the matrix behind this read was computed, with an ET anchor beside the raw instant —
    // a UTC ISO rolls its calendar date at 20:00 ET, so the session must be given in ET terms.
    matrix_asof: pos?.asof ?? null,
    matrix_asof_et: pos?.asof ? etStamp(Date.parse(pos.asof)) : null,
    matrix_session_date: pos?.asof ? etSessionDate(Date.parse(pos.asof)) : null,
    freshness: (pos != null ? "cached" : null) as CompareFreshness,
    // Age of the matrix COMPUTATION, not of the price it models — read with `freshness` and
    // `market_session`, never on its own.
    age_seconds: pos?.asof ? ageSecondsFromIso(pos.asof, nowMs) : null,
  };

  const { conflict, conflict_note } = describeConflict("Flow", flowSide, "gamma", gamma);

  return { flow: flowSide, gamma, conflict, conflict_note };
}

/** I/O wrapper: fetch the flow tape + GEX positioning, then hand both to the pure derivation. */
async function fetchTickerFlowAndGamma(ticker: string, nowMs = Date.now()): Promise<{
  flow: HelixThermalSide;
  gamma: HelixThermalSide;
  conflict: boolean;
  conflict_note: string | null;
}> {
  const t = String(ticker).trim().toUpperCase();
  const [{ marketPlatform }, { getGexPositioning }] = await Promise.all([
    import("@/lib/platform"),
    import("@/lib/providers/gex-positioning"),
  ]);

  // SELECT THE SAME POPULATION get_helix_tape_analytics reads — this was the defect.
  //
  // The old call was `getFlowTapeSummary({ limit: 50, ticker: t })`: no `order`, so
  // fetchRecentFlows fell to `ORDER BY total_premium DESC` — the 50 BIGGEST prints of the default
  // 48h window. On an index name those are LEAP/whale blocks, so the call/put sum below was a bias
  // read off the largest prints, not the session. Measured live 2026-08-21 on SPX: this card read
  // "$3.06B calls vs $0.88B puts → bullish" while get_helix_tape_analytics.session (recent-ordered,
  // the AUTHORITATIVE skew per #2520) read the same session at 60% call over $370M — the card's
  // "bullish" was carried almost entirely by ONE $368M SPXW 12/31 LEAP call. Two HELIX tools, same
  // ticker, same instant, incompatible directional reads.
  //
  // `helixTapeFetchOptions` is the exact selection get_helix_tape_analytics and get_flow_brief
  // issue (order:"recent", session limit + window). Routing through it — rather than re-inlining a
  // literal — means the tape-analytics fix (its long doc on why order is load-bearing) cannot drift
  // away from this card again: the file comment there already claimed "BOTH HELIX Largo tools issue"
  // this request when in fact this was a THIRD consumer it had never covered.
  const flowFetch = helixTapeFetchOptions({
    ticker: t,
    limit: HELIX_FLOW_PAGE_SIZE,
    sinceHours: HELIX_FLOW_DEFAULT_SINCE_HOURS,
    maxLimit: HELIX_FLOW_MAX_LIMIT,
    defaultSinceHours: HELIX_FLOW_DEFAULT_SINCE_HOURS,
    maxSinceHours: HELIX_FLOW_MAX_SINCE_HOURS,
  });
  const [flowRes, pos] = await Promise.all([
    marketPlatform.flows.getFlowTapeSummary(flowFetch).catch(() => null),
    getGexPositioning(t).catch(() => null),
  ]);

  // `getFlowTapeSummary` already scoped the tape with an exact `ticker = $1` in
  // fetchRecentFlows, so every returned row IS this ticker — no further filtering here.
  // (A 4-char-prefix re-filter used to sit at this spot. It was a no-op for exactly that
  // reason, and its `scoped.length ? scoped : recent` fallback was unreachable.)
  const summary = flowRes as { recent?: FlowTapeRow[]; window_hours?: number } | null;
  const recent = summary?.recent;
  const rows = Array.isArray(recent) ? recent : [];

  // NAME THE ANALYSED SPAN, NOT THE REQUESTED WINDOW.
  //
  // `getFlowTapeSummary.window_hours` is the lookback we ASKED for (168h) — but on an index name the
  // 500-print limit binds long before that window does, so the tape actually spans ~1h. Echoing the
  // request made the card say "last 168h" over 54 minutes of prints (measured 2026-08-20). Route the
  // real prints through `tapeWindowCoverage` — the SAME evidence get_helix_tape_analytics reports —
  // so the card names the span it measured and flags when the limit, not the window, bound it.
  //
  // The runtime `recent` rows are the full FlowAlert-shaped tape rows getFlowTape returns; the local
  // FlowTapeRow is a deliberate structural subset for the pure premium sum, so cast for coverage —
  // flowEventTimeMs safely reads null off any row missing a print time.
  const coverage = tapeWindowCoverage(
    rows as unknown as FlowAlert[],
    summary?.window_hours ?? HELIX_FLOW_DEFAULT_SINCE_HOURS,
    HELIX_FLOW_PAGE_SIZE,
    new Date(nowMs)
  );

  return compareSidesFrom(
    pos,
    {
      rows,
      available: flowRes != null,
      windowHours: coverage.actual_hours,
      windowMinutes: coverage.actual_minutes,
      requestedWindowHours: summary?.window_hours ?? HELIX_FLOW_DEFAULT_SINCE_HOURS,
      windowLimitReached: coverage.limit_reached,
    },
    nowMs
  );
}

/**
 * ET session phase from a FROZEN instant. Taking `nowMs` rather than reading the clock means the
 * phase, the stamp and every row age in one payload describe the SAME moment — a payload built
 * across 15:59:59 -> 16:00:01 must not report OPEN beside rows anchored after the close.
 */
function cardSessionPhase(nowMs: number): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "numeric",
    minute: "numeric",
    weekday: "short",
    hour12: false,
  }).formatToParts(new Date(nowMs));
  const part = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const DAYS: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return marketPhaseFromEt(
    DAYS[part("weekday")] ?? 1,
    Number(part("hour")) * 60 + Number(part("minute"))
  );
}

/**
 * The card's time anchor, built once per payload from one frozen instant.
 *
 * `as_of` is an ET WALL-CLOCK stamp, not a UTC ISO. A UTC instant rolls its calendar DATE at
 * 20:00 ET, so for the last four hours of every trading day anything resolving a session from it
 * is a full session ahead — the defect class fixed in #2418 (bars) and #2420 (Helix expiry).
 * Measured harm on this exact model: at 21:20 ET it dated a live SPX figure to the next session,
 * concluded the real close belonged to an earlier one, and fabricated a number for it.
 * `as_of_utc` keeps the machine-orderable instant for any consumer that sorts on it.
 */
export function cardStamp(nowMs: number) {
  return {
    as_of: etStamp(nowMs),
    session_date: etSessionDate(nowMs),
    as_of_utc: new Date(nowMs).toISOString(),
    market_session: cardSessionPhase(nowMs),
  };
}

/** Run HELIX flow + Thermal GEX in parallel for one ticker (default SPX). */
export async function helixThermalCompareForLargo(ticker = "SPX"): Promise<HelixThermalCompareCard> {
  const t = String(ticker).trim().toUpperCase() || "SPX";
  // ONE instant for the whole payload — see cardStamp().
  const nowMs = Date.now();
  const { flow, gamma } = await fetchTickerFlowAndGamma(t, nowMs);

  // Re-describe with the member-facing product names. Previously this branch rebuilt only the
  // CONFLICT note and fell through to the generic note otherwise, so a non-conflict card kept
  // saying nothing at all about whether a comparison had even happened.
  const { conflict, conflict_note } = describeConflict("HELIX flow", flow, "Thermal gamma", gamma);

  return roundFloats({
    kind: "helix_thermal",
    ticker: t,
    ...cardStamp(nowMs),
    helix: flow,
    thermal: gamma,
    conflict,
    conflict_note,
    // The honest replacement for the removed direction-conflict field — see regimeInteraction().
    regime_interaction: regimeInteractionFor(flow.bias, gamma.volatility_regime ?? null),
  });
}

/** Flow + gamma side-by-side for 2–3 peer tickers (earnings / sector days). */
export async function peerTickerCompareForLargo(
  tickers: readonly string[]
): Promise<PeerTickerCompareCard> {
  const normalized = [...new Set(tickers.map((t) => String(t).trim().toUpperCase()).filter(Boolean))].slice(
    0,
    3
  );
  const list = normalized.length >= 2 ? normalized : [...DEFAULT_PEER_COMPARE_TICKERS];
  // ONE instant for the whole payload — see cardStamp().
  const nowMs = Date.now();

  const snapshots = await Promise.all(
    list.map(async (ticker) => {
      const snap = await fetchTickerFlowAndGamma(ticker, nowMs).catch(() => null);
      return { ticker, snap };
    })
  );

  const rows: PeerTickerRow[] = snapshots.map(({ ticker, snap }) => {
    if (!snap) {
      // A thrown snapshot is an ABSENCE, not an all-clear — carry the same explicit
      // "nothing was compared" note the live path produces rather than a bare null.
      return {
        ticker,
        flow: { available: false, bias: "unknown", summary: "Flow unavailable" },
        gamma: { available: false, bias: "unknown", summary: "Positioning unavailable" },
        conflict: false,
        conflict_note: "Not compared — flow and gamma both unavailable",
        regime_interaction: null,
      };
    }
    return {
      ticker,
      flow: snap.flow,
      gamma: snap.gamma,
      conflict: snap.conflict,
      conflict_note: snap.conflict_note,
      regime_interaction: regimeInteractionFor(snap.flow.bias, snap.gamma.volatility_regime ?? null),
    };
  });

  // Divergence needs at least TWO peers that actually produced a directional reading, pointing
  // opposite ways. `uniqueFlow.size >= 2` alone was already close, but the note it produced said
  // nothing when divergence was false — so "all three peers bullish" and "we could not read any
  // of them" both served `peer_divergence: false, peer_divergence_note: null`. Same absence-as-
  // finding bug as the conflict flag: always say which case this is.
  const directional = rows.map((r) => r.flow.bias).filter(isDirectional);
  const uniqueFlow = new Set(directional);
  const peerDivergence = uniqueFlow.size >= 2;
  const roster = rows.map((r) => `${r.ticker} ${r.flow.bias}`).join(", ");
  const peerDivergenceNote = peerDivergence
    ? `Peer flow diverges — ${roster}`
    : directional.length >= 2
      ? `Peer flow agrees — ${roster}`
      : `Not compared — fewer than two peers have a directional flow reading (${roster})`;

  return roundFloats({
    kind: "peer_tickers",
    tickers: list,
    ...cardStamp(nowMs),
    rows,
    peer_divergence: peerDivergence,
    peer_divergence_note: peerDivergenceNote,
  });
}
