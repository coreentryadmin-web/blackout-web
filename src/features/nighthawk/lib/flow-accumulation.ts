/**
 * MULTI-DAY FLOW ACCUMULATION — the "memory" layer for the 0DTE signal.
 *
 * WHY THIS EXISTS: reacting to a SINGLE day's flow is a red flag. One large option sweep is noise —
 * it could be a hedge, a roll, a spread leg, or a one-off. What is SIGNAL is ACCUMULATION: the same
 * strike/expiry getting hit again and again, across a day AND across days, with real premium and
 * aggressive (swept, ask-side) buying behind it. That is positioning with conviction — the kind that
 * actually builds a wall / magnet and pushes price. This module turns a raw stream of option-flow
 * alerts (many days) into a per-underlying DIRECTIONAL conviction + the dominant "magnet" strike
 * being built, so the day-trade signal trades WITH accumulated positioning instead of a lone print.
 *
 * PURE + UNIT-TESTABLE: takes already-fetched flow rows, returns scored accumulation. No IO here —
 * the DB/UW fetch lives in the caller (db.ts / provider). Deterministic given (rows, nowMs).
 *
 * HOW THE DIRECTION IS SIGNED (the crux): a flow alert reports how the premium traded relative to the
 * quote — `askSidePremium` (lifted the offer = AGGRESSIVE BUYER) vs `bidSidePremium` (hit the bid =
 * AGGRESSIVE SELLER). So:
 *   • ask-side CALL premium  → bullish (someone aggressively BUYING calls)
 *   • bid-side PUT  premium  → bullish (someone aggressively SELLING puts / closing bearish bets)
 *   • ask-side PUT  premium  → bearish (aggressively buying puts)
 *   • bid-side CALL premium  → bearish (aggressively selling calls)
 * Net directional premium = (bullish − bearish). This is far more honest than counting raw premium by
 * call/put, which double-counts both sides of every trade.
 */

/** One option-flow alert row (subset of the UW flow-alert payload the accumulator needs). */
export type FlowAlertRow = {
  ticker: string;
  strike: number;
  /** YYYY-MM-DD contract expiry. */
  expiry: string;
  side: "call" | "put";
  /** Total premium on the alert (USD). */
  premium: number;
  /** Premium that traded on the ASK (aggressive buyer). Falls back to a premium split if absent. */
  askSidePremium?: number | null;
  /** Premium that traded on the BID (aggressive seller). */
  bidSidePremium?: number | null;
  /** Alert was (at least partly) a sweep — urgency/aggression. */
  sweep?: boolean;
  /** All prints were opening trades — NEW positioning (vs closing an existing position). */
  opening?: boolean;
  /** Contract volume / open interest — > 1 means today's volume exceeds resting OI (fresh build). */
  volOiRatio?: number | null;
  /** Alert timestamp (ms since epoch). */
  createdAtMs: number;
};

/** Accumulation for one position identity (ticker × strike × expiry × side), rolled up over days. */
export type StrikeAccumulation = {
  ticker: string;
  strike: number;
  expiry: string;
  side: "call" | "put";
  /** Distinct ET trading-days this identity was hit — the persistence that separates thesis from noise. */
  days: number;
  /** Total alert count across the window. */
  hits: number;
  /** Recency-weighted total premium (USD-ish; weights below are unitless multipliers). */
  weightedPremium: number;
  /** Signed directional premium: + bullish, − bearish (recency-weighted). */
  signedPremium: number;
  /** Share of premium that swept (0..1). */
  sweepRatio: number;
  /** Share of premium that was opening (0..1). */
  openingRatio: number;
  /** Composite strength 0..100 (premium × persistence × aggression). */
  score: number;
};

/** Per-underlying rollup — the signal the day-trade path consumes. */
export type FlowAccumulationSignal = {
  ticker: string;
  direction: "bull" | "bear" | "neutral";
  /** 0..100 conviction. */
  strength: number;
  /** Net signed premium across all this ticker's identities (+ bull / − bear). */
  netSignedPremium: number;
  /** The single strongest accumulated identity — the "magnet" strike being built. */
  magnet: StrikeAccumulation | null;
  /** Top identities (strongest first) for evidence/explain. */
  top: StrikeAccumulation[];
};

/** Lookback + tuning. Kept as exported consts so the backtest can sweep them. */
export const FLOW_ACC_WINDOW_DAYS = 5;
/** Per-trading-day recency half-life: a hit `HALFLIFE_DAYS` ago counts half as much as today. */
export const FLOW_ACC_HALFLIFE_DAYS = 2.5;
/** Aggression multipliers. */
const SWEEP_MULT = 1.5; // a swept alert weighs 1.5× a passive one
const OPENING_MULT = 1.4; // opening (new positioning) weighs 1.4× closing
const VOL_OI_BONUS = 0.5; // + up to 0.5× when today's volume >> resting OI (vol/oi ≥ 3)
/** Persistence multiplier per DISTINCT day (compounding): 1 day = 1.0, 2 = 1.5, 3 = 2.0, 4 = 2.5,
 *  5+ = 3.0 (capped at PERSISTENCE_CAP). Saturates at 5 distinct days. */
const PERSISTENCE_PER_DAY = 0.5;
const PERSISTENCE_CAP = 3.0;
/** Premium (recency+aggression weighted) that saturates a single identity's premium sub-score to 1. */
const PREMIUM_SATURATION = 5_000_000;
/** A ticker needs at least this net signed premium (abs) to read directional, else neutral. */
const DIRECTION_MIN_NET_PREMIUM = 250_000;

const MS_PER_DAY = 86_400_000;

function etDay(ms: number): string {
  // ET calendar day for grouping "distinct days". Uses the same en-CA/New_York basis as the rest of
  // the codebase; a small helper here keeps this module IO-free.
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(ms));
}

/** Recency weight in [~0,1]: exponential decay by trading-ish days since `nowMs` (calendar-day proxy). */
function recency(createdAtMs: number, nowMs: number): number {
  const ageDays = Math.max(0, (nowMs - createdAtMs) / MS_PER_DAY);
  return Math.pow(0.5, ageDays / FLOW_ACC_HALFLIFE_DAYS);
}

/** Split a row's premium into bullish/bearish using ask/bid-side when present, else a neutral fallback. */
function directionalPremium(row: FlowAlertRow): { bull: number; bear: number } {
  const ask = row.askSidePremium != null && Number.isFinite(row.askSidePremium) ? Math.max(0, row.askSidePremium) : null;
  const bid = row.bidSidePremium != null && Number.isFinite(row.bidSidePremium) ? Math.max(0, row.bidSidePremium) : null;
  if (ask == null && bid == null) {
    // No aggressor split — treat the whole premium as mildly directional by side (calls bullish, puts
    // bearish) at half weight, since we can't confirm who was the aggressor.
    const p = Math.max(0, row.premium) * 0.5;
    return row.side === "call" ? { bull: p, bear: 0 } : { bull: 0, bear: p };
  }
  const a = ask ?? 0;
  const b = bid ?? 0;
  if (row.side === "call") return { bull: a, bear: b }; // ask-side calls bought = bull; bid-side calls sold = bear
  return { bull: b, bear: a }; // ask-side puts bought = bear; bid-side puts sold = bull
}

/** Aggression multiplier for a single row. */
function aggression(row: FlowAlertRow): number {
  let m = 1;
  if (row.sweep) m *= SWEEP_MULT;
  if (row.opening) m *= OPENING_MULT;
  if (row.volOiRatio != null && Number.isFinite(row.volOiRatio) && row.volOiRatio > 1) {
    m *= 1 + Math.min(VOL_OI_BONUS, (Math.min(row.volOiRatio, 3) - 1) / 2 * VOL_OI_BONUS);
  }
  return m;
}

const keyOf = (r: FlowAlertRow) => `${r.ticker.toUpperCase()}|${r.expiry}|${r.strike}|${r.side}`;

/** Roll a flat list of flow alerts into per-(ticker,strike,expiry,side) accumulation, scored. */
export function accumulateStrikes(rows: FlowAlertRow[], nowMs: number): StrikeAccumulation[] {
  const groups = new Map<string, { rows: FlowAlertRow[]; days: Set<string> }>();
  for (const r of rows) {
    if (!(r.strike > 0) || !r.expiry || !(r.premium >= 0) || !Number.isFinite(r.createdAtMs)) continue;
    const k = keyOf(r);
    let g = groups.get(k);
    if (!g) groups.set(k, (g = { rows: [], days: new Set() }));
    g.rows.push(r);
    g.days.add(etDay(r.createdAtMs));
  }

  const out: StrikeAccumulation[] = [];
  for (const [, g] of groups) {
    let weightedPremium = 0, signed = 0, sweepPrem = 0, openPrem = 0, rawPrem = 0;
    for (const r of g.rows) {
      const rec = recency(r.createdAtMs, nowMs);
      const agg = aggression(r);
      const w = rec * agg;
      const { bull, bear } = directionalPremium(r);
      weightedPremium += (bull + bear) * w;
      signed += (bull - bear) * w;
      rawPrem += r.premium;
      if (r.sweep) sweepPrem += r.premium;
      if (r.opening) openPrem += r.premium;
    }
    const days = g.days.size;
    const persistence = Math.min(PERSISTENCE_CAP, 1 + (days - 1) * PERSISTENCE_PER_DAY);
    const premScore = Math.min(1, weightedPremium / PREMIUM_SATURATION); // 0..1 by premium
    // Persistence normalized to 0..1 (1 day → 1/CAP, CAP-days → 1) so multi-day stacking dominates.
    // With PERSISTENCE_CAP=3.0 and +0.5/day, persistence saturates at 5 DISTINCT days: a saturated
    // identity scores ~33 at 1 day, ~67 at 3 days, ~100 at 5 days. This is what makes "stacked hits
    // over days" outrank a single big print. (Ranking is unaffected by the exact cap — it's a uniform
    // scalar — but the magnitude matters if this evidence-only score ever graduates into board scoring.)
    const score = Math.round(Math.min(100, premScore * (persistence / PERSISTENCE_CAP) * 100));
    const first = g.rows[0]!;
    out.push({
      ticker: first.ticker.toUpperCase(),
      strike: first.strike,
      expiry: first.expiry,
      side: first.side,
      days,
      hits: g.rows.length,
      weightedPremium: Math.round(weightedPremium),
      signedPremium: Math.round(signed),
      sweepRatio: rawPrem > 0 ? Number((sweepPrem / rawPrem).toFixed(3)) : 0,
      openingRatio: rawPrem > 0 ? Number((openPrem / rawPrem).toFixed(3)) : 0,
      score,
    });
  }
  return out.sort((a, b) => b.score - a.score);
}

/** Roll strike-level accumulation up to a per-underlying directional signal. */
export function flowAccumulationByTicker(rows: FlowAlertRow[], nowMs: number): Map<string, FlowAccumulationSignal> {
  const strikes = accumulateStrikes(rows, nowMs);
  const byTicker = new Map<string, StrikeAccumulation[]>();
  for (const s of strikes) {
    const arr = byTicker.get(s.ticker) ?? [];
    arr.push(s);
    byTicker.set(s.ticker, arr);
  }
  const out = new Map<string, FlowAccumulationSignal>();
  for (const [ticker, arr] of byTicker) {
    const netSigned = arr.reduce((sum, s) => sum + s.signedPremium, 0);
    const direction: FlowAccumulationSignal["direction"] =
      Math.abs(netSigned) < DIRECTION_MIN_NET_PREMIUM ? "neutral" : netSigned > 0 ? "bull" : "bear";
    // Magnet = the strongest identity on the DOMINANT (net) side — the strike positioning actually
    // building in the reported direction.
    const dominant = arr
      .filter((s) => direction === "neutral" || (direction === "bull" ? s.signedPremium > 0 : s.signedPremium < 0))
      .sort((a, b) => b.score - a.score)[0] ?? null;
    // Strength MUST measure conviction IN the reported direction: base it on the dominant-side magnet,
    // NOT arr[0] (the globally-strongest identity, which can sit on the OPPOSITE side of the net when
    // one big print is outvoted by many smaller ones — that would source the conviction number from a
    // contra-directional identity and inflate it by the agree count). Lifted when several dominant-side
    // identities agree.
    const agree = arr.filter((s) => Math.sign(s.signedPremium) === Math.sign(netSigned) && s.signedPremium !== 0);
    const agreeBoost = Math.min(1.3, 1 + (agree.length - 1) * 0.08);
    const strength = Math.round(Math.min(100, (dominant?.score ?? 0) * agreeBoost));
    out.set(ticker, {
      ticker,
      direction,
      strength,
      netSignedPremium: Math.round(netSigned),
      magnet: dominant,
      top: arr.slice(0, 5),
    });
  }
  return out;
}
