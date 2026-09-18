/**
 * Night Hawk Legacy Signal Intelligence, Phase 1.8 — multi-horizon forward-return grading for
 * `nighthawk_candidate_snapshot` (Phase 1.3-1.5's per-stage candidate capture: discovery,
 * scored, rank_*, rejected, published — every candidate the pipeline touches, not just what a
 * member sees). Generalizes `scripts/audit/helix-score-signal.mjs`'s `barAt()` (nearest-bar-
 * within-tolerance lookup) and `scripts/audit/zerodte-sim.mjs`'s forward-bar-walk pattern into a
 * reusable, unit-tested product module, offline/cron-only (never inline in a request path).
 *
 * DIRECTION-AGNOSTIC BY DESIGN: this module computes the RAW underlying % return at each
 * horizon (positive = price rose from entry), never a sign-aligned "was this favorable" verdict.
 * A `nighthawk_candidate_snapshot` row's own `direction` (when the stage captured one — STAGE-2
 * discovery rows don't have one yet, STAGE-4/5/6/7 rows do) lives in that row's `snapshot_json`,
 * not here; a downstream reader combines the two. This also means every stage row for the SAME
 * (edition_for, ticker) shares byte-identical forward_returns — it's a fact about the ticker's
 * own price path that session, independent of which pipeline stage captured the candidate or
 * what direction (if any) that stage had assigned it.
 *
 * ENTRY ANCHOR = SESSION OPEN, not each row's own `observed_at`: mirrors the convention
 * `nighthawk_play_outcomes`/`resolveOutcome()` already use (`next_day_open`/`next_day_close`,
 * not the play's publish timestamp). A candidate is typically captured overnight during edition
 * build, well before market open — anchoring to `observed_at` would mean the entry lookup nearly
 * always misses the market-hours bar and the whole row is honestly-but-uselessly ungraded. The
 * session's own first minute bar is the correct, always-available anchor.
 *
 * NO LOOK-AHEAD: `nearestBarClose` only matches a bar within a bounded tolerance of the target
 * timestamp — a horizon whose bar genuinely isn't available (grading ran before that time
 * existed, or the tape has a real gap) returns `null`, never the nearest bar at any distance.
 */

// `t` is optional to match `@/lib/providers/polygon-largo`'s real `AggBar` shape (its own
// mapper always sets it via `Number(r.t)`, but the type stays defensive) -- every read below
// goes through a `Number.isFinite` guard rather than assuming it's present.
export type MinuteBar = { t?: number; o: number; h: number; l: number; c: number };

/** Forward horizons measured from the session's own first minute bar. EOD is handled
 *  separately (the session's own LAST bar), not a fixed minute offset. */
export const FORWARD_HORIZON_MINUTES = { m5: 5, m15: 15, m30: 30, h1: 60 } as const;

export type ForwardHorizonKey = keyof typeof FORWARD_HORIZON_MINUTES | "eod";

export type CandidateForwardReturns = {
  schema_version: 1;
  /** The session's own opening print — the entry anchor every horizon below is measured from. */
  entry_price: number | null;
  /** ISO timestamp of the actual bar entry_price came from (traceability — never assumed). */
  entry_at: string | null;
  horizons: Record<ForwardHorizonKey, number | null>;
  graded_at: string;
};

import {
  fetchNighthawkCandidateSnapshotsMissingForwardGrade,
  pinNighthawkCandidateSnapshotForwardReturns,
} from "@/lib/db";
import { fetchAggBars } from "@/lib/providers/polygon-largo";
import { polygonConfigured } from "@/lib/providers/config";

const round2 = (n: number): number => Math.round(n * 100) / 100;

/**
 * Nearest bar's close within `toleranceMin` of `targetMs`, else honest `null` — never the
 * nearest bar at unbounded distance. Same convention as helix-score-signal.mjs's `barAt()`
 * (a "price" taken far from the timestamp it claims is not a measurement).
 */
export function nearestBarClose(
  bars: readonly MinuteBar[],
  targetMs: number,
  toleranceMin = 10
): number | null {
  if (!bars.length) return null;
  const tolMs = toleranceMin * 60_000;
  let best: MinuteBar | null = null;
  let bestGap = Infinity;
  for (const bar of bars) {
    const t = bar.t;
    if (t == null || !Number.isFinite(t)) continue;
    const gap = Math.abs(t - targetMs);
    if (gap < bestGap) {
      bestGap = gap;
      best = bar;
    }
  }
  if (!best || bestGap > tolMs) return null;
  return Number.isFinite(best.c) && best.c > 0 ? best.c : null;
}

/** Raw (unsigned) % move from `entryPrice` to `exitPrice` — positive means the underlying rose. */
export function rawForwardReturnPct(entryPrice: number, exitPrice: number): number {
  return round2((exitPrice / entryPrice - 1) * 100);
}

/**
 * The full multi-horizon forward-return series for one (edition_for, ticker) session, from a
 * day's real minute bars (ascending by time, as `fetchAggBars` already returns them). Entry is
 * the session's own first bar's OPEN (the true session-open print, not its close). Every
 * horizon is independently null-safe: a missing entry anchor makes the whole row ungraded
 * (every horizon null), a missing individual horizon bar makes only that one horizon null.
 */
export function computeCandidateForwardReturns(
  bars: readonly MinuteBar[],
  gradedAtIso: string
): CandidateForwardReturns {
  const empty: CandidateForwardReturns = {
    schema_version: 1,
    entry_price: null,
    entry_at: null,
    horizons: { m5: null, m15: null, m30: null, h1: null, eod: null },
    graded_at: gradedAtIso,
  };
  if (!bars.length) return empty;

  const entryBar = bars[0]!;
  const entryTimeMs = entryBar.t;
  const entryPrice = Number.isFinite(entryBar.o) && entryBar.o > 0 ? entryBar.o : null;
  if (entryPrice == null || entryTimeMs == null || !Number.isFinite(entryTimeMs)) return empty;

  const horizons: Record<ForwardHorizonKey, number | null> = {
    m5: null,
    m15: null,
    m30: null,
    h1: null,
    eod: null,
  };
  for (const key of Object.keys(FORWARD_HORIZON_MINUTES) as Array<keyof typeof FORWARD_HORIZON_MINUTES>) {
    const targetMs = entryTimeMs + FORWARD_HORIZON_MINUTES[key] * 60_000;
    const exitPrice = nearestBarClose(bars, targetMs);
    horizons[key] = exitPrice != null ? rawForwardReturnPct(entryPrice, exitPrice) : null;
  }

  const lastBar = bars[bars.length - 1]!;
  horizons.eod =
    Number.isFinite(lastBar.c) && lastBar.c > 0 ? rawForwardReturnPct(entryPrice, lastBar.c) : null;

  return {
    schema_version: 1,
    entry_price: entryPrice,
    entry_at: new Date(entryTimeMs).toISOString(),
    horizons,
    graded_at: gradedAtIso,
  };
}

/**
 * STEP-7 — offline/cron grading pass. Fail-soft by contract, same shape as
 * resolveBangerScaleOutGrades/regradeStuckNighthawkOutcomes (play-outcomes.ts /
 * regrade-stuck.ts): every per-group failure lands in `errors` and never throws, so a caller
 * (the nighthawk-outcomes cron route) can run this alongside the other post-grading passes
 * without risking the headline stock-outcome grading run.
 *
 * Groups ungraded snapshot rows by (edition_for, ticker) so a session's minute bars are fetched
 * ONCE and the resulting forward_returns blob is pinned onto EVERY stage row that ticker/session
 * produced (discovery, scored, rank_*, rejected, published all share one price path, per this
 * module's header doc). A group whose bars can't establish a real entry anchor (no session-open
 * print resolvable, e.g. a genuinely bar-less ticker) is counted `skipped`, never force-graded
 * with a fabricated entry.
 */
export async function gradeNighthawkCandidateForwardReturns(opts?: {
  lookbackDays?: number;
}): Promise<{ graded: number; skipped: number; errors: string[] }> {
  if (!polygonConfigured()) {
    return { graded: 0, skipped: 0, errors: ["Polygon not configured"] };
  }
  const lookbackDays = opts?.lookbackDays ?? 21;
  const rows = await fetchNighthawkCandidateSnapshotsMissingForwardGrade(lookbackDays);

  const groups = new Map<string, { edition_for: string; ticker: string; ids: number[] }>();
  for (const row of rows) {
    const key = `${row.edition_for}:${row.ticker}`;
    let group = groups.get(key);
    if (!group) {
      group = { edition_for: row.edition_for, ticker: row.ticker, ids: [] };
      groups.set(key, group);
    }
    group.ids.push(row.id);
  }

  let graded = 0;
  let skipped = 0;
  const errors: string[] = [];
  const gradedAtIso = new Date().toISOString();

  for (const group of groups.values()) {
    try {
      const bars = await fetchAggBars(group.ticker, 1, "minute", group.edition_for, group.edition_for, "1000");
      const forwardReturns = computeCandidateForwardReturns(bars, gradedAtIso);
      if (forwardReturns.entry_price == null) {
        skipped += group.ids.length;
        continue;
      }
      for (const id of group.ids) {
        await pinNighthawkCandidateSnapshotForwardReturns(id, forwardReturns);
      }
      graded += group.ids.length;
    } catch (err) {
      errors.push(`${group.ticker}@${group.edition_for}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return { graded, skipped, errors };
}
