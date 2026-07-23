/**
 * 0DTE MARKET REGIME CLASSIFIER — "what kind of day is it?"
 *
 * The engine's scoring is currently regime-BLIND: VWAP is worth +4 whether it's a clean trend day or
 * chop. But the same signal has very different expectancy across regimes — trend-following works on a
 * trend day and gets chopped to death on a range day. This classifies the session into its regime so
 * (a) every setup can be STAMPED with it in the feature store, and (b) later, scoring weights can adapt
 * per regime once each regime has enough graded samples (calibration-first — this ships the LABEL, not
 * yet the per-regime weights).
 *
 * Pure & deterministic: takes already-computed session stats (from SPY/SPX bars) + the date; returns a
 * structured regime. Calendar flags that are computable from the date (OPEX, quarter-end…) are derived
 * here; the ones that need an external calendar (Fed/FOMC) are passed in.
 */

export type StructureRegime = "TREND_UP" | "TREND_DOWN" | "RANGE" | "INSIDE";
export type GapRegime = "GAP_UP" | "GAP_DOWN" | "FLAT";
export type VolRegime = "LOW_IV" | "NORMAL_IV" | "ELEVATED_IV" | "HIGH_IV";

export interface RegimeInput {
  /** Session open, current/last, high, low of the market proxy (SPY or SPX). */
  open: number;
  last: number;
  high: number;
  low: number;
  /** Prior session close / high / low (for gap + inside-day). */
  prevClose: number;
  prevHigh: number;
  prevLow: number;
  /** Session VWAP + a recent ATR (to normalize the day's move into "how big for this name"). */
  vwap: number;
  atr: number;
  /** Times price crossed VWAP today — a strong range/mean-reversion signal (optional). */
  vwapCrosses?: number;
  /** VIX level. */
  vix: number;
  /** Session date YYYY-MM-DD (for the computable calendar flags). */
  dateYmd: string;
  /** FOMC decision day — needs an external calendar, so it's passed in. */
  isFedDay?: boolean;
}

export interface RegimeCalendar {
  opex: boolean; // monthly options expiration (3rd Friday)
  quarterlyOpex: boolean; // quarterly OPEX (3rd Friday of Mar/Jun/Sep/Dec)
  fedDay: boolean;
  monthEnd: boolean; // last trading-ish day of the month
  quarterEnd: boolean; // last day of a quarter month
}

export interface MarketRegime {
  structure: StructureRegime;
  gap: GapRegime;
  vol: VolRegime;
  calendar: RegimeCalendar;
  /** Short tags for the feature store / UI. */
  tags: string[];
  /** Human one-liner. */
  label: string;
}

// ── thresholds (provisional — the per-regime WEIGHTS graduate later; these just draw the boundaries) ──
const GAP_PCT = 0.005; // ±0.5% open-vs-prev-close = a gap day
const TREND_ATR = 0.8; // |last − open| ≥ 0.8×ATR AND one-sided vs VWAP = trending
const TREND_CLOSE_STRENGTH = 0.6; // last must sit in the top/bottom 40% of the day's range
const RANGE_VWAP_CROSSES = 4; // ≥4 VWAP crosses = chop, overrides a weak trend read
// VIX bands aligned with the engine's existing regime gates (17 elevated / 20 extreme):
const VIX_LOW = 14;
const VIX_ELEVATED = 17;
const VIX_HIGH = 20;

function volRegime(vix: number): VolRegime {
  if (!Number.isFinite(vix)) return "NORMAL_IV";
  if (vix < VIX_LOW) return "LOW_IV";
  if (vix < VIX_ELEVATED) return "NORMAL_IV";
  if (vix < VIX_HIGH) return "ELEVATED_IV";
  return "HIGH_IV";
}

/** The Nth weekday-of-month (e.g. 3rd Friday) as a Date-less YMD-comparison. day: 0=Sun..6=Sat. */
function nthWeekdayYmd(year: number, month1: number, weekday: number, n: number): string {
  // month1 is 1-based. Compute day-of-week of the 1st via Zeller-free method using UTC date math is
  // disallowed (no Date.now, but explicit new Date(y,m,d) is deterministic and allowed).
  const first = new Date(Date.UTC(year, month1 - 1, 1));
  const firstDow = first.getUTCDay();
  const offset = (weekday - firstDow + 7) % 7;
  const day = 1 + offset + (n - 1) * 7;
  return `${year}-${String(month1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** Last calendar day of a month (YMD). */
function lastDayOfMonth(year: number, month1: number): number {
  return new Date(Date.UTC(year, month1, 0)).getUTCDate();
}

/** Compute the calendar flags derivable purely from the date. `fedDay` is supplied externally. */
export function classifyCalendar(dateYmd: string, fedDay = false): RegimeCalendar {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateYmd.slice(0, 10));
  if (!m) return { opex: false, quarterlyOpex: false, fedDay, monthEnd: false, quarterEnd: false };
  const y = +m[1], mo = +m[2], d = +m[3];
  const thirdFriday = nthWeekdayYmd(y, mo, 5, 3); // Friday = 5
  const opex = dateYmd.slice(0, 10) === thirdFriday;
  const quarterlyOpex = opex && [3, 6, 9, 12].includes(mo);
  const lastDom = lastDayOfMonth(y, mo);
  const monthEnd = d >= lastDom - 1; // last two calendar days ≈ month-end session
  const quarterEnd = monthEnd && [3, 6, 9, 12].includes(mo);
  return { opex, quarterlyOpex, fedDay, monthEnd, quarterEnd };
}

/** Classify the session into its market regime. */
export function classifyRegime(input: RegimeInput): MarketRegime {
  const { open, last, high, low, prevClose, prevHigh, prevLow, vwap, atr, vix } = input;
  const crosses = input.vwapCrosses ?? 0;

  // Gap: open vs prior close.
  const gapPct = prevClose > 0 ? (open - prevClose) / prevClose : 0;
  const gap: GapRegime = gapPct >= GAP_PCT ? "GAP_UP" : gapPct <= -GAP_PCT ? "GAP_DOWN" : "FLAT";

  // Structure. Inside day (today's range within yesterday's) is the strongest structural read.
  const range = Math.max(high - low, 1e-9);
  const closeStrength = (last - low) / range; // 1 = closing at high, 0 = at low
  const moveAtr = atr > 0 ? Math.abs(last - open) / atr : 0;
  const oneSidedVwap = last > vwap ? 1 : last < vwap ? -1 : 0;
  const inside = prevHigh > 0 && high <= prevHigh && low >= prevLow;

  let structure: StructureRegime;
  if (inside) {
    structure = "INSIDE";
  } else if (crosses >= RANGE_VWAP_CROSSES) {
    structure = "RANGE"; // heavy VWAP chop overrides a marginal trend read
  } else if (moveAtr >= TREND_ATR && (closeStrength >= TREND_CLOSE_STRENGTH || closeStrength <= 1 - TREND_CLOSE_STRENGTH) && oneSidedVwap !== 0) {
    // A real directional day: big move for the name, closing near an extreme, on one side of VWAP.
    const up = last > open && oneSidedVwap > 0 && closeStrength >= TREND_CLOSE_STRENGTH;
    const down = last < open && oneSidedVwap < 0 && closeStrength <= 1 - TREND_CLOSE_STRENGTH;
    structure = up ? "TREND_UP" : down ? "TREND_DOWN" : "RANGE";
  } else {
    structure = "RANGE";
  }

  const vol = volRegime(vix);
  const calendar = classifyCalendar(input.dateYmd, input.isFedDay);

  const tags: string[] = [structure, vol];
  if (gap !== "FLAT") tags.push(gap);
  if (calendar.quarterlyOpex) tags.push("QUAD_WITCHING");
  else if (calendar.opex) tags.push("OPEX");
  if (calendar.fedDay) tags.push("FED_DAY");
  if (calendar.quarterEnd) tags.push("QUARTER_END");
  else if (calendar.monthEnd) tags.push("MONTH_END");

  const label = `${structure.replace("_", " ").toLowerCase()} · ${vol.replace("_", "-").toLowerCase()}${gap !== "FLAT" ? ` · ${gap.replace("_", " ").toLowerCase()}` : ""}${calendar.fedDay ? " · FED" : ""}${calendar.quarterlyOpex ? " · quad-witching" : calendar.opex ? " · OPEX" : ""}`;

  return { structure, gap, vol, calendar, tags, label };
}
