/**
 * FORECAST TARGET RESOLUTION — the pure "what exactly are we forecasting to, and on what clock"
 * step that sits between a Vector ticker and the pin forecaster (`spx-pin-forecast-core.ts`).
 *
 * The forecaster itself is ticker-agnostic; what it cannot do is decide WHICH expiry a name is
 * pinning toward or HOW LONG the run-up to that target is. For SPX 0DTE both answers are trivial
 * (today's expiry, one 390-minute session), which is why they used to be hardcoded. For every other
 * name they are not: on a Tuesday, AMD's nearest expiry is Friday, and "today's close" and "the
 * expiry close" are two different targets with two different amounts of gamma behind them.
 *
 * Two deliberate modelling choices are encoded here. Both are the kind of thing that is invisible
 * in the output and wrong forever if picked carelessly:
 *
 * ── 1. The charm clock runs in TRADING minutes, not calendar minutes ─────────────────────────
 * `tFrac` (the forecaster's progress-through-the-window fraction) drives the magnet pull ramp and
 * the charm state. Pinning is an RTH phenomenon — dealers hedge while the market is open — so an
 * overnight gap should not advance the pin ramp. Measuring the window in calendar minutes would
 * burn ~57% of a 3-day window on two overnights, so a Wednesday-morning forecast to a Friday expiry
 * would read "accelerating" before the pin has any business accelerating.
 *
 * Because the forecaster derives `tMin` from `closeMs - nowMs`, the ONLY way to give it a
 * trading-time clock is to hand it a synthetic `closeMs` — `nowMs + tradingMinutesRemaining·60s`.
 * That is safe here specifically because nothing downstream reads `closeMs` as a wall-clock instant:
 * the cone primitive places its steps by RATIO (`frac = 1 − tMin/tMinNow`, see
 * vector-pin-cone-primitive.ts) across a fixed right-margin band, never by mapping `tMin` onto the
 * chart's time axis. Callers that DO want a wall-clock instant must use `targetCloseMs`, which is
 * the real one and is returned alongside.
 *
 * ── 2. The BSM ladder tenor stays in CALENDAR years ──────────────────────────────────────────
 * `structYears` feeds `bsmGamma`, and options decay on calendar time — a weekend absolutely does
 * burn theta. So the two clocks are deliberately different: charm ramp on trading time, gamma tenor
 * on calendar time. They are not a units inconsistency; they measure different physics.
 *
 * Pure and injectable (`isTradingDay`) so it is fully unit-testable with no clock or network.
 */

export const RTH_SESSION_MIN = 390;
/** 09:30 ET as minutes past ET midnight. */
export const RTH_OPEN_ET_MIN = 9 * 60 + 30;
/** 16:00 ET as minutes past ET midnight. */
export const RTH_CLOSE_ET_MIN = 16 * 60;
const MS_PER_MIN = 60_000;
const CALENDAR_DAYS_PER_YEAR = 365;

/** Which close the cone terminates on. */
export type ForecastTargetKind = "eod" | "expiry";

export type ForecastTarget = {
  kind: ForecastTargetKind;
  /** YYYY-MM-DD the cone terminates on. */
  targetYmd: string;
  /**
   * Expiry whose contracts build the dealer ladder. Equals `targetYmd` for an "expiry" target; for
   * an "eod" target on a day with no listed expiry it is the NEAREST FORWARD expiry — the book that
   * is actually generating today's gamma, even though it does not expire today.
   */
  chainExpiry: string;
  /** Real wall-clock ms of the target close — for display/labels, never for the forecaster. */
  targetCloseMs: number;
  /**
   * Synthetic close for `PinForecastInput.closeMs`, in TRADING-MINUTE space (see file header).
   * `closeMs - nowMs` is trading minutes remaining, so the forecaster's `tMin`/`tFrac` share one
   * consistent clock with `horizonMin`.
   */
  closeMs: number;
  /** Trading minutes from now to the target close. */
  tradingMinutesRemaining: number;
  /** Full window length in trading minutes — the forecaster's `horizonMin` (charm denominator). */
  horizonMin: number;
  /** Calendar years to `chainExpiry` — the forecaster's `structYears` (BSM tenor). */
  structYears: number;
  /**
   * Non-null when the target is defensible but WEAKER than the headline reading, so the UI can badge
   * it rather than presenting every cone as equally earned. Not the same as the forecaster's
   * `degraded` (an unreliable regime) or `ivFallback` (a guessed vol input).
   */
  caveat: string | null;
};

/** Days between two YYYY-MM-DD dates, UTC-anchored so DST never shifts the count. */
export function calendarDaysBetween(fromYmd: string, toYmd: string): number {
  const a = Date.parse(`${fromYmd}T00:00:00Z`);
  const b = Date.parse(`${toYmd}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
  return Math.round((b - a) / (24 * 3600 * 1000));
}

/** Step a YYYY-MM-DD forward one calendar day (UTC-anchored). */
function nextYmd(ymd: string): string {
  const t = Date.parse(`${ymd}T00:00:00Z`);
  return new Date(t + 24 * 3600 * 1000).toISOString().slice(0, 10);
}

/**
 * Trading minutes between two (day, ET-minute) points, counting only RTH.
 *
 * Clamps each endpoint into its session, so a pre-open "now" contributes a full session and a
 * post-close one contributes none — which is what makes an after-hours forecast to tomorrow read as
 * "a full session away" rather than "a few minutes away" purely because the wall clock is close.
 * Weekends/holidays contribute zero via `isTradingDay`. Bounded by `maxDays` so a malformed target
 * can never spin.
 */
export function tradingMinutesBetween(
  fromYmd: string,
  fromEtMin: number,
  toYmd: string,
  toEtMin: number,
  isTradingDay: (ymd: string) => boolean,
  maxDays = 400
): number {
  const span = calendarDaysBetween(fromYmd, toYmd);
  if (span < 0 || span > maxDays) return 0;

  const clamp = (m: number) => Math.min(Math.max(m, RTH_OPEN_ET_MIN), RTH_CLOSE_ET_MIN);
  if (span === 0) {
    if (!isTradingDay(fromYmd)) return 0;
    return Math.max(0, clamp(toEtMin) - clamp(fromEtMin));
  }

  let total = isTradingDay(fromYmd) ? Math.max(0, RTH_CLOSE_ET_MIN - clamp(fromEtMin)) : 0;
  for (let d = nextYmd(fromYmd); d !== toYmd; d = nextYmd(d)) {
    if (isTradingDay(d)) total += RTH_SESSION_MIN;
  }
  if (isTradingDay(toYmd)) total += Math.max(0, clamp(toEtMin) - RTH_OPEN_ET_MIN);
  return total;
}

/** Nearest listed expiry on or after `sessionYmd`, or null when the chain is entirely in the past. */
export function nearestForwardExpiry(expiries: readonly string[], sessionYmd: string): string | null {
  const forward = [...new Set(expiries.filter((e) => typeof e === "string" && e >= sessionYmd))].sort();
  return forward[0] ?? null;
}

export type ResolveForecastTargetOpts = {
  kind: ForecastTargetKind;
  nowMs: number;
  /** Minutes past ET midnight for `nowMs` — supplied by the caller so this stays timezone-pure. */
  etMinuteOfDay: number;
  /** Today's ET session date, YYYY-MM-DD. */
  sessionYmd: string;
  /** Listed expiries from the ticker's chain (any order; past ones are ignored). */
  expiries: readonly string[];
  isTradingDay: (ymd: string) => boolean;
};

/**
 * Resolve what the cone terminates on and the two clocks the forecaster needs.
 *
 * Returns null when there is nothing honest to forecast — no forward expiry at all, or a window
 * with zero trading minutes left (after the close on the target day). Null means "draw no cone";
 * the caller must never substitute a default, because a fabricated target is exactly the failure
 * this module exists to prevent.
 */
export function resolveForecastTarget(opts: ResolveForecastTargetOpts): ForecastTarget | null {
  const { kind, nowMs, etMinuteOfDay, sessionYmd, expiries, isTradingDay } = opts;
  if (!Number.isFinite(nowMs) || !Number.isFinite(etMinuteOfDay) || !sessionYmd) return null;

  const chainExpiry = nearestForwardExpiry(expiries, sessionYmd);
  if (!chainExpiry) return null;

  const targetYmd = kind === "expiry" ? chainExpiry : sessionYmd;

  // An "eod" target on a day that is not itself an expiry is still a real forecast — dealer gamma
  // from the forward book pulls price today whether or not that book expires today — but it is a
  // weaker claim than an expiry pin, because no charm cliff lands at this close. Badge it.
  let caveat: string | null = null;
  if (kind === "eod" && chainExpiry !== sessionYmd) {
    caveat = `No expiry today — gamma pull from the ${chainExpiry} book, so there is no expiry pin at this close.`;
  }

  const tradingMinutesRemaining = tradingMinutesBetween(
    sessionYmd,
    etMinuteOfDay,
    targetYmd,
    RTH_CLOSE_ET_MIN,
    isTradingDay
  );
  if (!(tradingMinutesRemaining > 0)) return null;

  // Window length = open of TODAY'S session → the target close. Measuring from today's open (not
  // from the target's first session, and not from "now") keeps the charm ramp anchored: tFrac falls
  // monotonically through the day as the member watches, instead of resetting on every poll.
  const horizonMin = Math.max(
    tradingMinutesBetween(sessionYmd, RTH_OPEN_ET_MIN, targetYmd, RTH_CLOSE_ET_MIN, isTradingDay),
    tradingMinutesRemaining
  );

  // Calendar tenor for BSM (see file header). Floored at a half-session so a same-day expiry never
  // hands bsmGamma a zero/negative T, which would zero the whole ladder.
  const calDays = Math.max(calendarDaysBetween(sessionYmd, chainExpiry), 0);
  const structYears = Math.max(
    (calDays + Math.max(tradingMinutesRemaining, 1) / RTH_SESSION_MIN) / CALENDAR_DAYS_PER_YEAR,
    RTH_SESSION_MIN / 2 / (CALENDAR_DAYS_PER_YEAR * 24 * 60)
  );

  const targetCloseMs =
    nowMs + (calendarDaysBetween(sessionYmd, targetYmd) * 24 * 60 + (RTH_CLOSE_ET_MIN - etMinuteOfDay)) * MS_PER_MIN;

  return {
    kind,
    targetYmd,
    chainExpiry,
    targetCloseMs,
    closeMs: nowMs + tradingMinutesRemaining * MS_PER_MIN,
    tradingMinutesRemaining,
    horizonMin,
    structYears,
    caveat,
  };
}
