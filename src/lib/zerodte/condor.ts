// ── 0DTE IRON-CONDOR play-type (Phase 4, docs/audit/0DTE-UNIFICATION-DESIGN.md §1c + §3) ──
// The SELL-side counterpart to the directional board: a delta-neutral 4-leg defined-risk iron
// condor SOLD for a net credit, routed from the PIN discovery origin (names pinned in a long-gamma
// dealer-defended range — pin-source.ts). Where a directional play buys a move on −50/+100 geometry,
// a condor sells premium beyond the dealer GEX walls and wins when price simply STAYS in the range.
//
// This module is PURE (no IO): the routing decision (does this regime strongly favor SELLING?), the
// priced condor plan (four legs off the live chain → net credit / defined max loss / breach levels),
// the condor LIQUIDITY gate (the replacement for the directional plan-quality gate), the WIN/breach
// grader, and the seed→setup bridge. The geometry itself is REUSED from iron-condor.ts (selectIron-
// Condor) — this module never reinvents strike selection. The IO (fetch the chain, price the legs)
// lives in pin-discovery.ts, dynamic-imported only when the source + condor flags are on.
//
// HONEST SKEW (iron-condor.ts header, enforced here): a condor is NEGATIVE skew — a small credit
// ~80% of days, a bigger (but DEFINED) loss on the breakout days. High close-settlement WR is NOT
// edge on its own; profitability needs the credit priced right (CONDOR_MIN_CREDIT_TO_RISK), a breach
// stop (the grader caps the loss), and small size. WR is surfaced CAPPED at 97 with the breach
// companion — never a bare 100.
//
// FLAG-GATED ON by default: set ZERODTE_CONDOR=0 to disable. PIN source must also be enabled
// (ZERODTE_WHOLE_MARKET + ZERODTE_SRC_PIN). With the condor flag off, a PIN candidate stays the
// directional fade (3b behavior) and NOTHING is ever a condor.

import {
  surfacedWinRate,
  type IronCondorLegs,
} from "./iron-condor";
import { etMinutesOf, PLAN_RULES, type PlanBar } from "./plan";
import {
  deriveContractHorizon,
  enrichSetup,
  gradingPolicyForHorizon,
  type DiscoveryOrigin,
  type EnrichedZeroDteSetup,
  type PlayType,
  type ZeroDteSetup,
} from "./board";
import type { PinRegime } from "./pin-source";

// ── Flag ────────────────────────────────────────────────────────────────────────────
// Default ON: the condor engine is production-ready. Set ZERODTE_CONDOR=0 to disable.
/** The condor play-type switch. ON by default; the PIN source's own flags must ALSO be on for a
 *  condor to ever be built (the router only sees PIN candidates). Read at call time so tests toggle. */
export function condorFlagEnabled(): boolean {
  return process.env.ZERODTE_CONDOR !== "0";
}

// ── Assignment-safety allowlist (design gap #8) ───────────────────────────────────────
// A short option leg that finishes ITM can be ASSIGNED. INDEX options (SPX/XSP/NDX/RUT) are
// EUROPEAN + CASH-SETTLED — no early assignment, no share delivery, settled to a cash number at
// expiry — so a condor on them has a truly defined, modeled max loss. AMERICAN options (every
// ETF wrapper — SPY/QQQ/IWM/DIA — and every single name) can be assigned EARLY, especially an
// ITM short into the close/dividend, which blows past the "defined loss" the grader assumes.
// Until early-assignment is actually modeled (a called-out follow-up), the condor SELL path is
// restricted to cash-settled index roots; every American underlying stays the directional fade.
// Override via ZERODTE_CONDOR_ROOTS (comma-sep) — but do NOT add American roots without an
// assignment model. This is a safety gate, not a tuning dial.
// Production default: SPX + NDX — both cash-settled, European-style index roots (NO early
// assignment; defined loss holds) with daily 0DTE expirations that are PM/close-settled, so the
// 15:30-close grader is valid for both. NDX 0DTE is thinner than SPX, but the condor liquidity
// gate (4 legs quotable + per-leg spread + credit floor) blocks any bad-fill NDX condor, so adding
// it can only add REAL condors, never a poorly-priced one. XSP/RUT (also cash-settled index) are
// research-only via the env override. American ETFs/single names are NEVER eligible (assignment).
// NOTE: NDX is ~20k → one condor is large notional; a sizing-discipline point, not a safety one.
export const CASH_SETTLED_CONDOR_ROOTS: ReadonlySet<string> = new Set(
  (process.env.ZERODTE_CONDOR_ROOTS ?? "SPX,NDX")
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean)
);

/** True only for cash-settled, European index roots a condor can be sold on WITHOUT early-
 *  assignment risk. American ETFs/single names return false → they stay the directional fade. */
export function condorEligibleTicker(ticker: string): boolean {
  return CASH_SETTLED_CONDOR_ROOTS.has(ticker.toUpperCase());
}

// ── Routing: does this long-gamma pin regime STRONGLY favor selling a condor? ──────────
// The router runs on a regime that ALREADY passed evaluatePinRegime (a genuine long-gamma, dealer-
// defended, contained bracket). It selects the SUBSET of those pins tight + dominant enough to SELL
// rather than fade. Deliberately CONSERVATIVE + stricter than the pin floor on every axis, because a
// condor is real-money order structure with a negative-skew tail — we only route the textbook pins:
//   • bracket dominance ≥ CONDOR_MIN_BRACKET_DOM_PCT  — BOTH walls deeply defended (6% vs PIN's 4%
//     floor): the dealers are strongly positioned to hold the range we're selling inside of.
//   • band width ≤ CONDOR_MAX_BAND_WIDTH_PCT          — a TIGHT (≤3%), containable range; a wide
//     "range" is two unrelated strikes, not a defended pin worth selling.
//   • spot offset ≤ CONDOR_MAX_OFFSET                 — spot is NEAR the center of the band, not
//     hugging a wall: both shorts have room. (A spot hugging a wall is a directional fade / breakout
//     risk, not a symmetric condor — that stays the directional path.)
// LOW VIX is the fourth condition in the design, but it is enforced in the GATE stack (condor G-4),
// not here, so we never duplicate the VIX provider read at discovery time — the router is pure over
// the regime shape and the gate blocks an elevated-vol sale.
export const CONDOR_MIN_BRACKET_DOM_PCT = 6;
export const CONDOR_MAX_BAND_WIDTH_PCT = 3;
export const CONDOR_MAX_OFFSET = 0.6;

export function condorSellRegime(
  regime: Pick<PinRegime, "bracketDomPct" | "bandWidthPct" | "offset">
): { sell: boolean; reason: string } {
  if (!(regime.bracketDomPct >= CONDOR_MIN_BRACKET_DOM_PCT)) {
    return {
      sell: false,
      reason: `bracket dominance ${regime.bracketDomPct}% < ${CONDOR_MIN_BRACKET_DOM_PCT}% — walls not deeply enough defended to sell inside`,
    };
  }
  if (!(regime.bandWidthPct <= CONDOR_MAX_BAND_WIDTH_PCT)) {
    return {
      sell: false,
      reason: `band width ${regime.bandWidthPct}% > ${CONDOR_MAX_BAND_WIDTH_PCT}% — range too wide to be a containable pin`,
    };
  }
  if (!(regime.offset <= CONDOR_MAX_OFFSET)) {
    return {
      sell: false,
      reason: `spot offset ${regime.offset} > ${CONDOR_MAX_OFFSET} — spot hugging a wall (directional fade, not a symmetric condor)`,
    };
  }
  return {
    sell: true,
    reason: `deep long-gamma pin (dom ${regime.bracketDomPct}%, band ${regime.bandWidthPct}%, offset ${regime.offset}) — sell the range`,
  };
}

// ── The priced condor plan ────────────────────────────────────────────────────────────

/** One leg's live quote — the structural subset the pricing reads (testable with plain objects). */
export type CondorLegQuote = { bid: number | null; ask: number | null; occ?: string | null };

export type CondorPlanLeg = {
  side: "call" | "put";
  role: "short" | "long";
  strike: number;
  bid: number | null;
  ask: number | null;
  occ: string | null;
};

export type CondorPlan = {
  play_type: "CONDOR";
  expiry: string;
  dte: number;
  spot: number;
  short_put: number;
  long_put: number;
  short_call: number;
  long_call: number;
  put_width_pct: number;
  call_width_pct: number;
  /** Wing width per side in points (short→long) — the defined-risk distance. */
  wing_pts: number;
  legs: CondorPlanLeg[];
  /** Net credit received per 1-lot condor, in $ (×100). CONSERVATIVE fill: sell the two shorts at
   *  their BID, buy the two wings at their ASK (the worst realistic fill), so the credit is never
   *  flattered. Null when any of the four legs lacks the quote side it needs. */
  net_credit: number | null;
  /** Gross wing risk per side, $ = wing_pts·100 — the defined-risk ceiling BEFORE credit. */
  gross_wing_risk: number;
  /** Defined max loss per 1-lot, $ = gross_wing_risk − net_credit. Null without a credit. */
  max_loss: number | null;
  /** Credit as a fraction of the wing risk (net_credit / gross_wing_risk) — the EV quality knob the
   *  liquidity gate floors: too thin a credit for the risk is a −EV sale no matter the WR. */
  credit_to_risk: number | null;
  /** MID-fill credit bracket (design Q7), $ (×100): every leg filled at its bid/ask MIDPOINT — the
   *  best realistic fill vs the worst-case `net_credit`. This surface has no real broker fills, so the
   *  true realized credit lives in [net_credit (conservative), net_credit_mid (mid)]; carrying both
   *  lets calibration measure the realized-P&L RANGE of a negative-skew sale instead of one pessimistic
   *  point. NOT used to gate or grade — net_credit stays the safe number. Null when any leg lacks a
   *  two-sided quote. Always ≥ net_credit (shorts fill higher, wings cheaper at mid). */
  net_credit_mid: number | null;
  /** credit_to_risk computed off the mid-fill bracket — the optimistic end of the EV knob. Null with
   *  no mid credit. */
  credit_to_risk_mid: number | null;
  /** Underlying breach levels = the short strikes. A WIN closes STRICTLY inside (breach_lower,
   *  breach_upper); touching either at/through settlement is the defined loss. */
  breach_lower: number; // short_put
  breach_upper: number; // short_call
  /** Widest per-leg bid/ask spread as % of that leg's mid — the exit-tax proxy for the liquidity gate. */
  max_leg_spread_pct: number | null;
  /** True when a leg is missing a two-sided quote (credit unknowable) or the spread tax is too wide. */
  illiquid: boolean;
  /** Surfaced win-rate estimate (CAPPED at 97 — never a bare 100) carried from the geometry. */
  est_win_rate: number;
  est_win_rate_small_sample: boolean;
  /** The negative-skew intraday-breach companion (null unless this is the shipped target-80 geometry). */
  est_intraday_breach_pct: number | null;
  skew: "negative";
};

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Per-leg spread % of mid (null unless both sides quote and mid > 0). */
function legSpreadPct(q: CondorLegQuote): number | null {
  if (q.bid == null || q.ask == null || !(q.ask > 0) || !(q.bid >= 0)) return null;
  const mid = (q.bid + q.ask) / 2;
  if (!(mid > 0)) return null;
  return round2(((q.ask - q.bid) / mid) * 100);
}

/** Floor a leg's spread tax at this % of mid — any leg wider is illiquid (the 4-leg exit tax
 *  compounds, so this is TIGHTER than the directional single-leg 15% illiquid threshold). */
export const CONDOR_MAX_LEG_SPREAD_PCT = 12;

/**
 * Price the four legs of `legs` off their live quotes into a full condor plan. Conservative credit
 * (shorts@bid − wings@ask). Pure. Missing any needed quote → net_credit/max_loss null + illiquid.
 */
export function buildCondorPlan(input: {
  spot: number;
  expiry: string;
  dte: number;
  legs: IronCondorLegs;
  quotes: {
    shortPut: CondorLegQuote;
    longPut: CondorLegQuote;
    shortCall: CondorLegQuote;
    longCall: CondorLegQuote;
  };
}): CondorPlan {
  const { spot, expiry, dte, legs, quotes } = input;
  const grossWingRisk = round2(legs.wing_pts * 100);

  // Conservative fill: RECEIVE the shorts' bids, PAY the wings' asks.
  const sPutBid = quotes.shortPut.bid;
  const sCallBid = quotes.shortCall.bid;
  const lPutAsk = quotes.longPut.ask;
  const lCallAsk = quotes.longCall.ask;
  const haveAll =
    sPutBid != null && sPutBid > 0 &&
    sCallBid != null && sCallBid > 0 &&
    lPutAsk != null && lPutAsk >= 0 &&
    lCallAsk != null && lCallAsk >= 0;
  const netCredit = haveAll
    ? round2(((sPutBid as number) + (sCallBid as number) - (lPutAsk as number) - (lCallAsk as number)) * 100)
    : null;
  // A structure that would DEBIT (or zero) is not a sellable condor — treat as no credit.
  const creditPositive = netCredit != null && netCredit > 0;
  const netCreditFinal = creditPositive ? netCredit : null;
  const maxLoss = netCreditFinal != null ? round2(grossWingRisk - netCreditFinal) : null;
  const creditToRisk = netCreditFinal != null && grossWingRisk > 0 ? round2(netCreditFinal / grossWingRisk) : null;

  // MID-fill credit bracket (design Q7): each leg at its bid/ask midpoint — the best realistic fill,
  // vs the conservative worst-case above. Only computed when the SAME structure priced a positive
  // conservative credit AND all four legs have a two-sided quote (a mid needs both sides), so the two
  // brackets describe the exact same sellable condor. Always ≥ net_credit; never gates or grades.
  const midOf = (q: CondorLegQuote): number | null =>
    q.bid != null && q.ask != null && q.ask >= q.bid ? (q.bid + q.ask) / 2 : null;
  const sPutMid = midOf(quotes.shortPut);
  const sCallMid = midOf(quotes.shortCall);
  const lPutMid = midOf(quotes.longPut);
  const lCallMid = midOf(quotes.longCall);
  const haveAllMid = sPutMid != null && sCallMid != null && lPutMid != null && lCallMid != null;
  const netCreditMid =
    creditPositive && haveAllMid
      ? round2(((sPutMid as number) + (sCallMid as number) - (lPutMid as number) - (lCallMid as number)) * 100)
      : null;
  const creditToRiskMid = netCreditMid != null && grossWingRisk > 0 ? round2(netCreditMid / grossWingRisk) : null;

  const spreads = [quotes.shortPut, quotes.longPut, quotes.shortCall, quotes.longCall]
    .map(legSpreadPct)
    .filter((s): s is number => s != null);
  const maxLegSpreadPct = spreads.length === 4 ? Math.max(...spreads) : null;
  // Illiquid when we couldn't price the credit (a leg missing its needed quote), a leg lacks a
  // two-sided quote (spread unmeasurable), or any leg's spread tax exceeds the floor.
  const illiquid =
    netCreditFinal == null ||
    maxLegSpreadPct == null ||
    maxLegSpreadPct > CONDOR_MAX_LEG_SPREAD_PCT;

  const legRows: CondorPlanLeg[] = [
    { side: "put", role: "short", strike: legs.short_put, bid: quotes.shortPut.bid, ask: quotes.shortPut.ask, occ: quotes.shortPut.occ ?? null },
    { side: "put", role: "long", strike: legs.long_put, bid: quotes.longPut.bid, ask: quotes.longPut.ask, occ: quotes.longPut.occ ?? null },
    { side: "call", role: "short", strike: legs.short_call, bid: quotes.shortCall.bid, ask: quotes.shortCall.ask, occ: quotes.shortCall.occ ?? null },
    { side: "call", role: "long", strike: legs.long_call, bid: quotes.longCall.bid, ask: quotes.longCall.ask, occ: quotes.longCall.occ ?? null },
  ];

  return {
    play_type: "CONDOR",
    expiry,
    dte,
    spot: round2(spot),
    short_put: legs.short_put,
    long_put: legs.long_put,
    short_call: legs.short_call,
    long_call: legs.long_call,
    put_width_pct: legs.put_width_pct,
    call_width_pct: legs.call_width_pct,
    wing_pts: legs.wing_pts,
    legs: legRows,
    net_credit: netCreditFinal,
    gross_wing_risk: grossWingRisk,
    max_loss: maxLoss,
    credit_to_risk: creditToRisk,
    net_credit_mid: netCreditMid,
    credit_to_risk_mid: creditToRiskMid,
    breach_lower: legs.short_put,
    breach_upper: legs.short_call,
    max_leg_spread_pct: maxLegSpreadPct,
    illiquid,
    est_win_rate: legs.est_win_rate,
    est_win_rate_small_sample: legs.est_win_rate_small_sample,
    est_intraday_breach_pct: legs.est_intraday_breach_pct,
    skew: "negative",
  };
}

// ── Condor liquidity gate (the directional plan-quality replacement) ───────────────────
// A condor is neutral, so the directional G-8/G-9 (chase / single-leg spread) do NOT apply. This is
// the SELL-side equivalent: the four legs must be tradeable AND the credit must clear a floor for the
// wing risk (finding a high-WR condor is easy; a real edge needs the credit to pay for the tail).
export type CondorGateBlock = { code: import("./board").ZeroDteGateFailure; reason: string; threshold: number | null };

/** Minimum credit as a fraction of gross wing risk. Below this the negative-skew tail isn't paid for —
 *  a thin credit on a defined-risk sale is −EV no matter how high the raw WR. Conservative default
 *  (env-overridable, ZERODTE_CONDOR_MIN_CREDIT). 0.10 = the credit must be ≥10% of the wing width. */
export const CONDOR_MIN_CREDIT_TO_RISK = ((): number => {
  const raw = Number(process.env.ZERODTE_CONDOR_MIN_CREDIT);
  return Number.isFinite(raw) && raw > 0 && raw < 1 ? raw : 0.1;
})();

/** Pure liquidity/credit gate for a condor plan. Returns every failing block (fail-closed on a
 *  missing plan — a condor with no priced structure can never commit). */
export function condorLiquidityGateBlocks(plan: CondorPlan | null): CondorGateBlock[] {
  const blocks: CondorGateBlock[] = [];
  if (plan == null) {
    blocks.push({
      code: "condor_liquidity",
      reason: "No priced condor structure (chain unavailable) — evidence only, no sellable plan.",
      threshold: null,
    });
    return blocks;
  }
  if (plan.net_credit == null || plan.illiquid) {
    const detail =
      plan.net_credit == null
        ? "one or more of the four legs has no usable quote — the net credit is unknowable"
        : plan.max_leg_spread_pct != null && plan.max_leg_spread_pct > CONDOR_MAX_LEG_SPREAD_PCT
          ? `widest leg spread is ${plan.max_leg_spread_pct}% of mid (> ${CONDOR_MAX_LEG_SPREAD_PCT}%) — the 4-leg exit tax is too high`
          : "the condor legs are untradeable";
    blocks.push({
      code: "condor_liquidity",
      reason: `Condor not tradeable — ${detail} (G-9 condor liquidity).`,
      threshold: CONDOR_MAX_LEG_SPREAD_PCT,
    });
    return blocks;
  }
  if (plan.credit_to_risk == null || plan.credit_to_risk < CONDOR_MIN_CREDIT_TO_RISK) {
    blocks.push({
      code: "condor_liquidity",
      reason:
        `Credit ${plan.credit_to_risk ?? 0} of wing risk is below the ${CONDOR_MIN_CREDIT_TO_RISK} floor — ` +
        "too thin to pay for the negative-skew breach tail; a high WR alone is not edge.",
      threshold: CONDOR_MIN_CREDIT_TO_RISK,
    });
  }
  return blocks;
}

// ── Condor range-intact check (the cheap "don't sell into a failing range" proxy) ──────
// The design asks for a Cortex "range-intact" read (gex-walls source). A full Cortex integration is
// heavier than this first version warrants (and is called out as a follow-up); this is the pure,
// cheap proxy it stands in for: if spot has already crept close to a short strike, the defended range
// is eroding and we should NOT open the sale. Measured as spot's distance to the NEAR short as a
// fraction of that side's short-strike distance from center — below the margin = too close.
/** Block a condor when spot sits within this fraction of a short strike's distance to spot (i.e. it
 *  has consumed ≥ (1−margin) of the room to the near short). Conservative; env-overridable. */
export const CONDOR_RANGE_BREAK_MARGIN = ((): number => {
  const raw = Number(process.env.ZERODTE_CONDOR_RANGE_MARGIN);
  return Number.isFinite(raw) && raw > 0 && raw < 1 ? raw : 0.25;
})();

/** True when the CURRENT spot has approached (or breached) a short strike — the range is failing and
 *  a fresh condor should be HELD. `spot` is the live underlying; the shorts are the plan's breach
 *  levels. Pure. */
export function condorRangeBreaking(spot: number, plan: Pick<CondorPlan, "breach_lower" | "breach_upper">): boolean {
  if (!(spot > 0)) return true; // unreadable spot → fail closed (hold, don't sell blind)
  const { breach_lower, breach_upper } = plan;
  if (spot <= breach_lower || spot >= breach_upper) return true; // already breached
  const upRoom = breach_upper - spot;
  const downRoom = spot - breach_lower;
  const halfWidth = (breach_upper - breach_lower) / 2;
  if (!(halfWidth > 0)) return true;
  // Nearest short's remaining room as a fraction of the half-width; below the margin = too close.
  const nearestRoomFrac = Math.min(upRoom, downRoom) / halfWidth;
  return nearestRoomFrac < CONDOR_RANGE_BREAK_MARGIN;
}

// ── Grading: WIN=close-inside-both-shorts / DEFINED-LOSS=breach (breach-stopped, capped) ──
export type CondorOutcome = {
  outcome: "condor_win" | "condor_breach_loss" | "ungradeable";
  /** Realized P&L per 1-lot, $: +net_credit on a win, −max_loss on a breach (the loss is CAPPED at
   *  the defined max — the breach stop / long wings guarantee it). Null when ungradeable. */
  realized_usd: number | null;
  /** Realized P&L as % of the gross wing risk (the defined max risk) — comparable across tickers. */
  pnl_pct: number | null;
  /** True when a short strike was TOUCHED intraday (the negative-skew tail actually fired). */
  breached_intraday: boolean;
  /** Q7 mid-fill bracket: realized P&L had every leg filled at its bid/ask MID instead of the
   *  conservative worst-case. Populated only on a WIN (the credit kept) and only when the plan
   *  carried a mid credit — the upper end of the [conservative, mid] realized range for a
   *  negative-skew sale. Null on a breach (the capped loss is ~fill-insensitive) and ungradeable.
   *  INFORMATIONAL: `realized_usd` remains the conservative graded number calibration gates on. */
  realized_usd_mid: number | null;
};

/**
 * Grade a condor against the UNDERLYING's own minute bars, walked in time order from the bar AFTER
 * the flag to the 15:50 ET hard exit. The exit is deliberately SIMPLE (this first version): hold to
 * close, with a breach stop. The FIRST bar whose range touches or crosses a short strike (low ≤
 * breach_lower OR high ≥ breach_upper) is the managed breach exit — a DEFINED LOSS capped at
 * `max_loss` (the long wings / stop guarantee the cap). If no bar ever breaches and the last in-
 * window close is strictly inside both shorts → WIN (+net_credit). The flag bar itself is excluded
 * (its high/low happened around the flag in unknowable order — the same intrabar discipline
 * gradePlanFromBars uses). No bars strictly after the flag → ungradeable.
 *
 * NOTE this grades the SOLD structure, NOT the −50/+100 directional path — it must never be run on a
 * DIRECTIONAL row (and gradePlanFromBars must never run on a CONDOR row); scan.ts routes by play_type.
 */
export function gradeCondorFromBars(
  bars: PlanBar[],
  plan: Pick<CondorPlan, "breach_lower" | "breach_upper" | "net_credit" | "max_loss" | "gross_wing_risk" | "net_credit_mid">,
  flaggedAtMs: number,
  // WS-02: the same-day time-stop from the row's FROZEN exit-policy snapshot, when it carries
  // one — so a condor is settled at the minute the row COMMITTED under (not whatever
  // PLAN_RULES currently holds). Omitted/nullish → PLAN_RULES (legacy rows grade as before).
  // A condor is breach-graded, so only the time-stop is policy-driven (no stop/target %).
  params?: { time_stop_et_minutes?: number | null } | null
): CondorOutcome {
  const { breach_lower, breach_upper, net_credit, max_loss, gross_wing_risk, net_credit_mid } = plan;
  if (net_credit == null || max_loss == null || !(gross_wing_risk > 0)) {
    return { outcome: "ungradeable", realized_usd: null, pnl_pct: null, breached_intraday: false, realized_usd_mid: null };
  }
  const timeStopMinutes = params?.time_stop_et_minutes ?? PLAN_RULES.time_stop_et_minutes;
  const pct = (usd: number) => round2((usd / gross_wing_risk) * 100);

  let lastCloseInWindow: number | null = null;
  for (const bar of [...bars].sort((a, b) => a.t - b.t)) {
    if (bar.t <= flaggedAtMs) continue; // exclude the flag bar (intrabar look-ahead)
    if (etMinutesOf(bar.t) > timeStopMinutes) break; // past the time-stop — settle
    // Breach stop: the first touch of either short is the managed exit at the DEFINED max loss.
    if (bar.l <= breach_lower || bar.h >= breach_upper) {
      // The capped loss is dominated by the wing width and barely moves with entry fill, so the mid
      // bracket is null on a breach — the [conservative, mid] spread only matters on the credit-kept win.
      return { outcome: "condor_breach_loss", realized_usd: -max_loss, pnl_pct: pct(-max_loss), breached_intraday: true, realized_usd_mid: null };
    }
    lastCloseInWindow = bar.c;
  }
  if (lastCloseInWindow == null) {
    return { outcome: "ungradeable", realized_usd: null, pnl_pct: null, breached_intraday: false, realized_usd_mid: null };
  }
  // Never breached in-window → the last close is strictly inside both shorts → the credit is kept.
  // realized_usd stays the CONSERVATIVE credit (the graded number); realized_usd_mid carries the
  // best-fill upside so calibration sees the win's [conservative, mid] realized range (Q7).
  return {
    outcome: "condor_win",
    realized_usd: net_credit,
    pnl_pct: pct(net_credit),
    breached_intraday: false,
    realized_usd_mid: net_credit_mid ?? null,
  };
}

// ── Seed→setup bridge ─────────────────────────────────────────────────────────────────

/**
 * Build a `play_type: "CONDOR"` EnrichedZeroDteSetup for one pin regime + its priced condor plan.
 * discovery_origin is ["PIN"] (the condor's only origin); `direction` carries the pin's nominal fade
 * side for provenance but is UNUSED by the neutral structure's gates/grader. Flow-only fields are
 * honest nulls. Run through enrichSetup(., null) for the full enriched shape, then attach condor_plan.
 */
export function buildCondorSetup(input: {
  ticker: string;
  spot: number;
  regime: PinRegime;
  plan: CondorPlan;
  score: number;
  /** ISO-8601 observation time of `spot`, when the caller knows it. Stamped onto
   *  `underlying_price_as_of`; omitted → null = as-of UNKNOWN (never fabricated). */
  spotAsOf?: string | null;
}): EnrichedZeroDteSetup {
  const { ticker, spot, regime, plan, score } = input;
  const origin: DiscoveryOrigin[] = ["PIN"];
  const playType: PlayType = "CONDOR";
  const base: ZeroDteSetup = {
    ticker: ticker.toUpperCase(),
    direction: regime.fadeDirection, // nominal provenance only — the condor is delta-neutral
    play_type: playType,
    discovery_origin: origin,
    top_strike: plan.short_call, // nominal anchor (the upper breach); a condor has no single strike
    top_strike_avg_fill: null,
    expiry: plan.expiry,
    dte: plan.dte,
    // HORIZON from the REAL condor expiry dte. SPX/NDX condors are cash-settled same-day; priceCondorLegs
    // is clamped to dte ≤ 1 (pin-discovery.ts), so a committed condor is always ZERO_DTE/ONE_DTE. A
    // hypothetical dte≥2 maps to WEEKLY_FALLBACK and would be dropped by the persist-time guard.
    contract_horizon: deriveContractHorizon(plan.dte),
    actual_dte_at_commit: plan.dte,
    grading_policy: gradingPolicyForHorizon(deriveContractHorizon(plan.dte)),
    net_premium: 0,
    gross_premium: 0,
    prints: 0,
    sweep_pct: 0,
    side_dominance: 0.5, // neutral — no directional flow side
    underlying_price: Math.round(spot * 100) / 100,
    // Provenance for the mark: the live chain spot the condor legs were priced against. NOTE a
    // CONDOR is the ONE structure attachContractPlans skips (it has no single directional OCC), so
    // this stamp is never refreshed downstream — it stays chain_spot for the life of the setup and
    // is the honest label for it.
    underlying_price_as_of: input.spotAsOf ?? null,
    underlying_price_source: "chain_spot",
    score,
    aggression: null,
    otm_pct: null, // a neutral 4-leg structure has no single moneyness
    new_money: false,
    recent_premium_30m: 0,
    spike: false,
    first_seen: null,
    last_seen: null,
    flow_quality: null,
  };
  const enriched = enrichSetup(base, null);
  enriched.condor_plan = plan;
  return enriched;
}

/** Re-export the display cap so consumers never surface a bare 100 (iron-condor.ts owns the value). */
export { surfacedWinRate };
