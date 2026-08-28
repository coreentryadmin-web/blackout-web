import {
  fetchNighthawkOutcomeAnalytics,
  fetchZeroDteSetupLogRange,
  type NighthawkPlayOutcomeRow,
  type ZeroDteSetupLogRow,
} from "@/lib/db";
import { fetchPlayOutcomeStats, type PlayOutcomeStats } from "@/features/spx/lib/spx-play-outcomes";
import { buildPublicTrackRecord, formatPercent } from "@/lib/track-record-public";
import { entryRangeMid } from "@/features/nighthawk/lib/entry-range";
import { formatEtDate, todayEt } from "@/features/nighthawk/lib/session";
import { isCurrentGradeMethodology } from "@/features/nighthawk/lib/grade-methodology";
import {
  buildZeroDteRecord,
  type ZeroDteRecordBucket,
  type ZeroDteRecordRollup,
} from "@/lib/zerodte/record";

/** Shape returned by GET /api/track-record — shared with TrackRecordView. */
export type TrackRecordPagePayload = {
  spxSlayer: {
    total: number;
    wins: number;
    losses: number;
    winRatePct: number | null;
  };
  nightHawk: {
    total: number;
    wins: number;
    losses: number;
    winRatePct: number | null;
    avgWinnerPct: number | null;
    avgLoserPct: number | null;
    profitFactor: number | null;
    /**
     * total - wins - losses: plays counted as "scoreable" (isNighthawkOutcomeScoreable)
     * whose outcome was neither 'target' nor 'stop' — 'open' (session closed without
     * ever triggering either level) or 'ambiguous' (both levels hit intraday, order
     * unrecoverable from close-only data). Optional/additive: undefined on any older
     * cached payload just means "not computed," not "zero" — do not assume 0 when absent.
     */
    unresolved?: number;
    /**
     * wins + losses — the denominator winRatePct is computed over, and the sample size the
     * UI must gate its ratio stats on. `total` is NOT that number: it includes `unresolved`.
     * Optional/additive like `unresolved` — undefined on an older cached payload.
     */
    decided?: number;
  };
  /**
   * 0DTE Command's multi-day record (P-3) — a THIRD, separately-labeled methodology:
   * option-premium returns, never blended with Slayer pnl-points or Night Hawk stock-move
   * percentages. The headline W/L is the AS-MANAGED grade (the exit the member was
   * live-guided to take); the fixed -50/+100/15:30 plan grade rides beside it as a labeled
   * comparison (`mechanical`). Optional/additive like nightHawk.unresolved: undefined on
   * older cached payloads means "not computed." Buckets carry low_n (n<5) so the UI can
   * badge thin evidence.
   */
  zerodte?: {
    windowDays: number;
    totalFlagged: number;
    graded: number;
    ungraded: number;
    wins: number;
    losses: number;
    /** pnl exactly 0 — SPX 3-way parity, excluded from wins AND losses. */
    breakeven: number;
    winRatePct: number | null;
    avgPnlPct: number | null;
    byOutcome: ZeroDteRecordBucket[];
    byTimeOfDay: ZeroDteRecordBucket[];
    byDirection: ZeroDteRecordBucket[];
    byScoreBand: ZeroDteRecordBucket[];
    /** The fixed -50/+100/15:30 plan grade over the same rows — labeled comparison only. */
    mechanical: ZeroDteRecordRollup;
  };
  methodology: string;
  liveData: boolean;
  available?: boolean;
};

/** Shared anti-blend methodology paragraph — public /methodology page + member track record. */
export const TRACK_RECORD_METHODOLOGY =
  "SPX Slayer results are graded from the closed play ledger (every opened play, no cherry-picking). " +
  "Night Hawk results are resolved target/stop outcomes from published editions. " +
  "Night Hawk returns reflect next-day underlying stock price movement from the published entry range midpoint — " +
  "not option-premium returns. Actual option P&L will differ based on strike selection, expiry, and implied volatility at entry. " +
  "0DTE Command results are plan-outcome grades on the printed contract plan (stop -50% / trim +100% / hard exit 15:50 ET) " +
  "against the option's own premium, from the scanner ledger (every committed setup). " +
  "The three methodologies measure different things and are never blended into one win rate. " +
  "Scratch/breakeven counts appear in the embed and desk panels where applicable.";

const NH_WINDOW_DAYS = 90;
const ZERODTE_WINDOW_DAYS = 30;

function spxFromStats(stats: PlayOutcomeStats | null): TrackRecordPagePayload["spxSlayer"] {
  if (!stats || stats.total_closed <= 0) {
    return { total: 0, wins: 0, losses: 0, winRatePct: null };
  }
  return {
    total: stats.total_closed,
    wins: stats.overall.wins,
    losses: stats.overall.losses,
    winRatePct: formatPercent(stats.overall.win_rate, 1),
  };
}

function nhStopDataUnavailable(r: NighthawkPlayOutcomeRow): boolean {
  return r.stop != null && r.session_high == null && r.session_low == null;
}

/** Same filter as aggregate Night Hawk stats on the track-record page. */
export function isNighthawkOutcomeScoreable(r: NighthawkPlayOutcomeRow): boolean {
  // 'unfilled' (session never traded back into the entry band) has no fill to
  // win or lose — excluded like stop_data_unavailable so gap-away plays can't
  // book phantom wins/losses from an unfillable entry.
  // PR-N4: a PULLED play (morning confirm INVALIDATED it pre-open; one-way latch) was
  // withdrawn from the actionable surface at 9:15 — its grade is a COUNTERFACTUAL
  // ("what would have happened"), kept on the row for gate calibration but never
  // counted in the headline record, in either direction: a pulled play that would have
  // hit target must not pad the win rate, and one that would have stopped must not
  // book a loss the member was told not to take.
  // PR-N2: a row still graded under a superseded methodology (grade_methodology ≠
  // current — the pre-fillability "level touch" grades, incl. the gap-away phantom
  // wins) is quarantined out of EVERY headline surface sharing this predicate (public
  // track-record page, /api/track-record/plays, signal accuracy) until the admin
  // legacy regrade re-verifies it under current rules and promotes it. Same anti-blend
  // rule as getNighthawkMetrics' segments — keep the two in lockstep.
  return (
    r.outcome !== "pending" &&
    r.outcome !== "unfilled" &&
    r.pulled !== true &&
    isCurrentGradeMethodology(r.grade_methodology) &&
    !nhStopDataUnavailable(r)
  );
}

function nhEntryMid(row: NighthawkPlayOutcomeRow): number | null {
  const mid = entryRangeMid(row.entry_range_low, row.entry_range_high);
  if (mid != null) return mid;
  if (row.entry_range_low != null && row.entry_range_high != null) return null; // corrupt range, no fallback
  return row.next_day_open;
}

function nhReturnPct(row: NighthawkPlayOutcomeRow): number | null {
  const entry = nhEntryMid(row);
  const close = row.next_day_close;
  if (entry == null || close == null || entry === 0) return null;
  const raw = row.direction === "LONG" ? (close - entry) / entry : (entry - close) / entry;
  return raw * 100;
}

export function nhFromRows(rows: NighthawkPlayOutcomeRow[]): TrackRecordPagePayload["nightHawk"] {
  const scoreable = rows.filter(isNighthawkOutcomeScoreable);
  const winners = scoreable.filter((r) => r.outcome === "target");
  const losers = scoreable.filter((r) => r.outcome === "stop");
  const total = scoreable.length;
  const wins = winners.length;
  const losses = losers.length;
  // isNighthawkOutcomeScoreable() admits 'open' (session closed without ever hitting
  // target or stop) and 'ambiguous' (both hit intraday, order unrecoverable) alongside
  // 'target'/'stop' — so total can legitimately exceed wins + losses. Previously that gap
  // was invisible: total and wins/losses were reported side by side with no field
  // explaining the difference, reading as a miscount (confirmed live: a 10/6/3 board with
  // no third bucket). Surface it explicitly rather than leaving admins to do the subtraction.
  const unresolved = total - wins - losses;
  // WIN-RATE DENOMINATOR = decided (wins + losses), NOT `total`. `total` is the scoreable
  // population and, per the comment directly above, legitimately contains 'open' and
  // 'ambiguous' rows. Dividing by it counted a play that never touched target OR stop as a
  // non-win, which is indistinguishable from a stop-out and pinned the rate at 0% (live
  // 2026-08-06: 0/22 with unresolved=20). Kept in lockstep with getNighthawkMetrics'
  // segments — this file and analytics.ts are two independent aggregations of the same rows
  // and must never disagree.
  const decided = wins + losses;
  const winRatePct = decided > 0 ? formatPercent(wins / decided, 1) : null;

  const winnerReturns = winners.map(nhReturnPct).filter((v): v is number => v != null);
  const loserReturns = losers.map(nhReturnPct).filter((v): v is number => v != null);
  const avgWinnerPct =
    winnerReturns.length > 0
      ? Math.round((winnerReturns.reduce((a, b) => a + b, 0) / winnerReturns.length) * 10) / 10
      : null;
  // Clamp to ≤ 0: stop-hit plays should always produce a negative return. A positive
  // average here signals bad outcome grading (next_day_close above entry_mid on a
  // stop row) — we surface the magnitude as a loss rather than showing a positive number
  // in a "bear" red tile that reads as a gain to the user.
  const avgLoserPct =
    loserReturns.length > 0
      ? Math.min(0, Math.round((loserReturns.reduce((a, b) => a + b, 0) / loserReturns.length) * 10) / 10)
      : null;

  const grossWins = winnerReturns.reduce((a, b) => a + b, 0);
  const grossLosses = Math.abs(loserReturns.reduce((a, b) => a + b, 0));
  const profitFactor =
    grossLosses > 0 ? Math.round((grossWins / grossLosses) * 100) / 100 : null;

  return {
    total,
    wins,
    losses,
    winRatePct,
    avgWinnerPct,
    avgLoserPct,
    profitFactor,
    unresolved,
    decided,
  };
}

/** The zerodte section from ledger rows — pure (unit-testable), delegating every
 *  number to buildZeroDteRecord so this section and /api/market/zerodte/record can
 *  never disagree (single aggregation path, the pageSpxMatchesPublic lesson). */
export function zerodteFromRows(
  rows: ZeroDteSetupLogRow[],
  window: { since: string; through: string; days: number }
): NonNullable<TrackRecordPagePayload["zerodte"]> {
  const record = buildZeroDteRecord(rows, window);
  return {
    windowDays: window.days,
    totalFlagged: record.total_flagged,
    graded: record.graded,
    ungraded: record.ungraded,
    wins: record.wins,
    losses: record.losses,
    breakeven: record.breakeven,
    winRatePct: record.win_rate_pct,
    avgPnlPct: record.avg_pnl_pct,
    byOutcome: record.by_outcome,
    byTimeOfDay: record.by_time_of_day,
    byDirection: record.by_direction,
    byScoreBand: record.by_score_band,
    mechanical: record.mechanical,
  };
}

/**
 * Build the /track-record page payload from the SAME ledgers as the public embed
 * and SPX desk (spx_play_outcomes + nighthawk_play_outcomes + zerodte_setup_log).
 * Never throws.
 */
export async function buildTrackRecordPagePayload(
  statsOverride?: PlayOutcomeStats | null
): Promise<TrackRecordPagePayload> {
  try {
    const zdSince = formatEtDate(new Date(Date.now() - ZERODTE_WINDOW_DAYS * 24 * 60 * 60 * 1000));
    const [stats, nh, zdRows] = await Promise.all([
      statsOverride !== undefined
        ? Promise.resolve(statsOverride)
        : fetchPlayOutcomeStats().catch(() => null),
      fetchNighthawkOutcomeAnalytics(NH_WINDOW_DAYS).catch(() => ({ rows: [], pending_count: 0 })),
      // Fail-open to an empty ledger (zerodte reads as 0-graded/unavailable) rather
      // than failing the whole page — same resilience as the other two legs.
      fetchZeroDteSetupLogRange(zdSince, ZERODTE_WINDOW_DAYS * 20).catch(
        () => [] as ZeroDteSetupLogRow[]
      ),
    ]);

    return {
      spxSlayer: spxFromStats(stats),
      nightHawk: nhFromRows(nh.rows),
      zerodte: zerodteFromRows(zdRows, {
        since: zdSince,
        through: todayEt(),
        days: ZERODTE_WINDOW_DAYS,
      }),
      methodology: TRACK_RECORD_METHODOLOGY,
      liveData: true,
    };
  } catch (error) {
    console.error("[track-record-page] build failed", error);
    return {
      spxSlayer: { total: 0, wins: 0, losses: 0, winRatePct: null },
      nightHawk: {
        total: 0,
        wins: 0,
        losses: 0,
        winRatePct: null,
        avgWinnerPct: null,
        avgLoserPct: null,
        profitFactor: null,
        unresolved: 0,
        decided: 0,
      },
      methodology: TRACK_RECORD_METHODOLOGY,
      liveData: false,
      available: false,
    };
  }
}

/** Compare page SPX block to the public ledger rollup (for verifiers + tests).
 *  Win-rate agreement is checked by re-deriving BOTH precisions from the shared
 *  W/L counts via `formatPercent()` — NOT by re-rounding the page's already-rounded
 *  1dp value back to 0dp. That re-round path is lossy (e.g. 26/46 → page 56.5%,
 *  pub 57%, but formatPercent(56.5/100,0)=56) and false-flagged healthy ledgers. */
export function pageSpxMatchesPublic(
  page: TrackRecordPagePayload,
  pub: Awaited<ReturnType<typeof buildPublicTrackRecord>>
): boolean {
  if (!pub.available) return page.spxSlayer.total === 0;
  const countsMatch =
    page.spxSlayer.total === pub.total_closed &&
    page.spxSlayer.wins === pub.wins &&
    page.spxSlayer.losses === pub.losses;
  if (!countsMatch) return false;
  if (page.spxSlayer.total === 0) {
    return page.spxSlayer.winRatePct == null && pub.win_rate_pct === 0;
  }
  const rawRate = page.spxSlayer.wins / page.spxSlayer.total;
  const pageWinOk = page.spxSlayer.winRatePct === formatPercent(rawRate, 1);
  const pubWinOk = pub.win_rate_pct === formatPercent(rawRate, 0);
  return pageWinOk && pubWinOk;
}
