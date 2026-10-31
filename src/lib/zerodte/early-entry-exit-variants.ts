// EARLY-ENTRY big-target exit variants — mechanical, bar-walkable replays of (a) the REAL
// shipped ratchet mechanics (exit-engine.ts's ratchetFloorPct/protectiveFloorMark, same
// constants) and (b) two candidate alternatives aimed specifically at the operator's
// "$1.00-$3.00 -> $10.00, stretch $20.00" big-target question, which neither the shipped
// ratchet nor trim_scale was ever measured against (both were tuned on %-P&L outcomes, not
// absolute-dollar reach).
//
// Pure, deterministic, bar-walkable: every function takes ordered OHLC premium bars plus an
// entry price and returns one terminal decision. No I/O, no live state — the SAME shape as
// exit-engine.ts's own pure helpers, so a backtest (walk real historical bars) and a future
// live wiring (walk real-time ticks) can share this code unmodified.
//
// CONVENTION (disclosed, matches this toolkit's other mechanical exit replays): within a bar,
// a floor/stop check uses the floor ALREADY ARMED as of the END of the PRIOR bar, checked
// against THIS bar's low (for a long) or high (for a short) — never "peaked and breached in
// the same 60-second bar," which would silently assume a best-case intra-bar order no minute
// bar can actually prove. Peak/trough update AFTER the breach check, for the NEXT bar's floor.

export type ExitBar = { t: number; h: number; l: number; c: number };

export type MechanicalExitResult = {
  exitPx: number;
  exitAtMs: number;
  exitReason:
    | "stopped"
    | "ratchet_floor"
    | "flat_theta_bleed"
    | "time_stop"
    | "tranche_then_time_stop";
  peakPx: number;
  troughPx: number;
  /** First bar timestamp whose HIGH reached >= targetPremium, or null if never reached
   *  (checked against every bar's real high, independent of whether the exit rule itself
   *  would have realized it — this is the UPPER BOUND "did the underlying path ever get
   *  there," not "did this rule capture it"). */
  timeToHit10Ms: number | null;
  timeToHit20Ms: number | null;
  hit10: boolean;
  hit20: boolean;
  /** Did the position's OWN realized exit price (this rule's actual decision) clear $10/$20 —
   *  the real, rule-dependent number, always <= the peak-touch upper bound above. */
  exitCleared10: boolean;
  exitCleared20: boolean;
};

export type RatchetReplayConfig = {
  stopPct?: number; // default -50 (PLAN_RULES.stop_pct)
  armPnlPct?: number; // default 5 (EXIT_RULES.ratchet_early_arm_pnl_pct)
  lockFraction?: number; // default 0.4 (EXIT_RULES.ratchet_lock_floor_fraction)
  flatTimeoutMin?: number; // default 25
  flatBandPct?: number; // default 10
};

const DEFAULTS: Required<RatchetReplayConfig> = {
  stopPct: -50,
  armPnlPct: 5,
  lockFraction: 0.4,
  flatTimeoutMin: 25,
  flatBandPct: 10,
};

function pnlPct(px: number, entry: number): number {
  return entry > 0 ? ((px - entry) / entry) * 100 : 0;
}
function pxFromPnlPct(pct: number, entry: number): number {
  return entry * (1 + pct / 100);
}

/**
 * Replay the mechanical, bar-walkable core of the shipped ratchet (exit-engine.ts): a hard
 * stop, then a trailing floor that arms once peak P&L clears `armPnlPct` and sits at
 * `lockFraction` of the running peak, then the flat-timeout theta-bleed scratch. Never a
 * trim/thesis-break decision — those need live evidence a historical bar walk can't supply
 * (same disclosed gap as this repo's other mechanical exit replays).
 */
export function replayRatchetExit(
  entryAsk: number,
  bars: ExitBar[],
  entryAtMs: number,
  timeStopMs: number,
  config: RatchetReplayConfig = {}
): MechanicalExitResult {
  const cfg = { ...DEFAULTS, ...config };
  const walk = bars.filter((b) => b.t > entryAtMs && b.t <= timeStopMs).sort((a, b) => a.t - b.t);

  let peakPx = entryAsk;
  let troughPx = entryAsk;
  let armedFloorPx: number | null = null;
  let timeToHit10Ms: number | null = null;
  let timeToHit20Ms: number | null = null;
  let ageMs = 0;

  for (const b of walk) {
    ageMs = b.t - entryAtMs;
    const ageMin = ageMs / 60_000;

    if (timeToHit10Ms == null && b.h >= 10) timeToHit10Ms = b.t;
    if (timeToHit20Ms == null && b.h >= 20) timeToHit20Ms = b.t;

    // 1. Hard stop — highest precedence, checked against the bar's low.
    const stopPx = pxFromPnlPct(cfg.stopPct, entryAsk);
    if (b.l <= stopPx) {
      troughPx = Math.min(troughPx, b.l);
      return finish(stopPx, b.t, "stopped");
    }

    // 2. Ratchet floor — breach uses the floor ARMED FROM THE PRIOR BAR'S peak.
    if (armedFloorPx != null && b.l <= armedFloorPx) {
      troughPx = Math.min(troughPx, b.l);
      return finish(armedFloorPx, b.t, "ratchet_floor");
    }

    // 3. Flat timeout — never left the ±band since entry.
    const peakPnl = pnlPct(peakPx, entryAsk);
    const curLowPnl = pnlPct(b.l, entryAsk);
    if (ageMin >= cfg.flatTimeoutMin && peakPnl < cfg.flatBandPct && curLowPnl > -cfg.flatBandPct) {
      return finish(b.c, b.t, "flat_theta_bleed");
    }

    // Update peak/trough AFTER this bar's checks, for the NEXT bar's floor.
    if (b.h > peakPx) peakPx = b.h;
    if (b.l < troughPx) troughPx = b.l;
    const newPeakPnl = pnlPct(peakPx, entryAsk);
    if (newPeakPnl >= cfg.armPnlPct) {
      armedFloorPx = pxFromPnlPct(newPeakPnl * cfg.lockFraction, entryAsk);
    }
  }

  const last = walk.length ? walk[walk.length - 1].c : entryAsk;
  return finish(last, timeStopMs, "time_stop");

  function finish(exitPx: number, exitAtMs: number, exitReason: MechanicalExitResult["exitReason"]): MechanicalExitResult {
    return {
      exitPx: Math.round(exitPx * 100) / 100,
      exitAtMs,
      exitReason,
      peakPx: Math.round(peakPx * 100) / 100,
      troughPx: Math.round(troughPx * 100) / 100,
      timeToHit10Ms,
      timeToHit20Ms,
      hit10: timeToHit10Ms != null,
      hit20: timeToHit20Ms != null,
      exitCleared10: exitPx >= 10,
      exitCleared20: exitPx >= 20,
    };
  }
}

export type PartialProfitRunnerConfig = {
  stopPct?: number; // default -50
  firstTrancheAtPx?: number; // default 5 ($5 premium)
  secondTrancheAtPx?: number; // default 10 ($10 premium)
  trancheFraction?: number; // default 1/3 each
  flatTimeoutMin?: number;
  flatBandPct?: number;
};

export type PartialProfitResult = MechanicalExitResult & {
  tranchesBanked: 0 | 1 | 2;
  /** Blended realized price across whatever banked + the final runner exit, weighted by
   *  trancheFraction each -- the real, comparable "effective exit price" for this rule. */
  blendedExitPx: number;
};

const PARTIAL_DEFAULTS = {
  stopPct: -50,
  firstTrancheAtPx: 5,
  secondTrancheAtPx: 10,
  trancheFraction: 1 / 3,
  flatTimeoutMin: 25,
  flatBandPct: 10,
};

/**
 * A genuinely different family from the ratchet: bank a THIRD of the position outright the
 * first time premium reaches $5, another third at $10, and let the final third run
 * completely unguarded except the hard stop and the time-stop -- explicitly designed to let
 * the last piece actually reach $20 instead of being floor-exited on any pullback. If the
 * hard stop fires before either tranche arms, the WHOLE position (still 100% size) takes the
 * stop -- there is no partial protection before the first real tranche prints.
 */
export function replayPartialProfitRunner(
  entryAsk: number,
  bars: ExitBar[],
  entryAtMs: number,
  timeStopMs: number,
  config: PartialProfitRunnerConfig = {}
): PartialProfitResult {
  const cfg = { ...PARTIAL_DEFAULTS, ...config };
  const walk = bars.filter((b) => b.t > entryAtMs && b.t <= timeStopMs).sort((a, b) => a.t - b.t);

  let peakPx = entryAsk;
  let troughPx = entryAsk;
  let tranche1Px: number | null = null;
  let tranche2Px: number | null = null;
  let timeToHit10Ms: number | null = null;
  let timeToHit20Ms: number | null = null;

  for (const b of walk) {
    if (timeToHit10Ms == null && b.h >= 10) timeToHit10Ms = b.t;
    if (timeToHit20Ms == null && b.h >= 20) timeToHit20Ms = b.t;
    if (b.h > peakPx) peakPx = b.h;
    if (b.l < troughPx) troughPx = b.l;

    const stopPx = pxFromPnlPct(cfg.stopPct, entryAsk);
    if (tranche1Px == null && b.l <= stopPx) {
      // Nothing banked yet -- the whole position takes the stop.
      return finish(stopPx, b.t, "stopped");
    }

    if (tranche1Px == null && b.h >= cfg.firstTrancheAtPx) {
      tranche1Px = cfg.firstTrancheAtPx;
    }
    if (tranche1Px != null && tranche2Px == null && b.h >= cfg.secondTrancheAtPx) {
      tranche2Px = cfg.secondTrancheAtPx;
    }

    // Once at least one tranche is banked, the hard stop on the RUNNER remainder still
    // applies (it can give back to the original -50% stop level on the un-banked piece,
    // same discipline as the shipped trim_scale runner leg) -- but banked tranches are
    // locked in regardless, so compute the stop against the runner's own worst case.
    if (tranche1Px != null && b.l <= stopPx) {
      return finish(stopPx, b.t, "stopped");
    }

    const ageMin = (b.t - entryAtMs) / 60_000;
    const peakPnl = pnlPct(peakPx, entryAsk);
    const curLowPnl = pnlPct(b.l, entryAsk);
    if (
      tranche1Px == null &&
      ageMin >= cfg.flatTimeoutMin &&
      peakPnl < cfg.flatBandPct &&
      curLowPnl > -cfg.flatBandPct
    ) {
      return finish(b.c, b.t, "flat_theta_bleed");
    }
  }

  const last = walk.length ? walk[walk.length - 1].c : entryAsk;
  return finish(last, timeStopMs, tranche1Px != null ? "tranche_then_time_stop" : "time_stop");

  function finish(
    runnerExitPx: number,
    exitAtMs: number,
    exitReason: MechanicalExitResult["exitReason"]
  ): PartialProfitResult {
    const tranchesBanked: 0 | 1 | 2 = tranche2Px != null ? 2 : tranche1Px != null ? 1 : 0;
    // Blended price: each banked tranche contributes its own fill; the remainder (1, 2, or 3
    // thirds, whichever wasn't yet banked) contributes the runner's own terminal exit price.
    const parts: number[] = [];
    if (tranche1Px != null) parts.push(tranche1Px);
    if (tranche2Px != null) parts.push(tranche2Px);
    const remainderFraction = 1 - parts.length * cfg.trancheFraction;
    const weightedBanked = parts.reduce((s, p) => s + p * cfg.trancheFraction, 0);
    const blendedExitPx = weightedBanked + runnerExitPx * remainderFraction;
    return {
      exitPx: Math.round(runnerExitPx * 100) / 100,
      exitAtMs,
      exitReason,
      peakPx: Math.round(peakPx * 100) / 100,
      troughPx: Math.round(troughPx * 100) / 100,
      timeToHit10Ms,
      timeToHit20Ms,
      hit10: timeToHit10Ms != null,
      hit20: timeToHit20Ms != null,
      exitCleared10: blendedExitPx >= 10,
      exitCleared20: blendedExitPx >= 20,
      tranchesBanked,
      blendedExitPx: Math.round(blendedExitPx * 100) / 100,
    };
  }
}
