import type { WallHistorySample } from "./vector-wall-history";

/**
 * Collapse one session's recorded wall/flip samples into a single end-of-session row for the
 * historical (1D/1W/4H) chart.
 *
 * SCOPE, STATED UP FRONT. Wall history is recorded per session and retained for roughly 15 days
 * (vector-wall-persist.ts: 72h Redis hot cache over a durable Postgres mirror sized for 15-day
 * replay). There is NO multi-year series. A 1D chart spans ~500 sessions, so this overlay covers
 * the right-hand sliver of it and nothing else — which is why `coveredFrom`/`coveredTo` are part
 * of the payload and the UI states the window rather than letting a short line imply a long one.
 *
 * OBSERVED vs MODELED is preserved, not flattened. WallHistorySample.modeled marks a sample
 * reconstructed from the EOD chain rather than recorded live, and this file's neighbours are
 * explicit that "modeled ≠ observed must be visible". A day is only `observed` when the sample we
 * actually used was a real recording.
 */

export type DailyRegimeRow = {
  /** Session date, YYYY-MM-DD. */
  date: string;
  /** Dealer gamma flip at the close of that session, or null when never recorded. */
  gammaFlip: number | null;
  /** Strongest positive-gamma strike (resistance) and strongest negative (support). */
  callWall: number | null;
  putWall: number | null;
  /** False when the underlying sample was reconstructed rather than live-recorded. */
  observed: boolean;
};

/**
 * The LAST sample of a session is the one that matters: it is the dealer positioning a trader
 * carried into the close, which is what a daily candle summarises. Averaging the session would
 * smear a flip that migrated intraday into a level that never existed.
 *
 * Samples are not assumed sorted — the merge path (mergeModeledUnderlay) interleaves modeled and
 * observed rows, so this picks by max `time` rather than trusting array order.
 */
export function reduceSessionToDaily(date: string, samples: readonly WallHistorySample[]): DailyRegimeRow | null {
  if (!date || !samples?.length) return null;
  let last: WallHistorySample | null = null;
  for (const s of samples) {
    if (!s || !Number.isFinite(s.time)) continue;
    if (!last || s.time > last.time) last = s;
  }
  if (!last) return null;
  const flip = Number.isFinite(last.gammaFlip as number) ? (last.gammaFlip as number) : null;
  const callWall = last.walls?.callWalls?.[0]?.strike ?? null;
  const putWall = last.walls?.putWalls?.[0]?.strike ?? null;
  // A row with no level at all carries no information — drop it rather than emitting a gap the
  // chart would have to special-case.
  if (flip == null && callWall == null && putWall == null) return null;
  return {
    date,
    gammaFlip: flip,
    callWall: Number.isFinite(callWall) ? callWall : null,
    putWall: Number.isFinite(putWall) ? putWall : null,
    observed: last.modeled !== true,
  };
}

/**
 * Regime at a session: price above the flip = positive gamma (dealers dampen moves), below =
 * negative gamma (dealers amplify). Null when there is no flip recorded, so the caller shades
 * nothing rather than defaulting to a regime it cannot support.
 */
export function regimeAt(close: number | null | undefined, gammaFlip: number | null): "positive" | "negative" | null {
  if (close == null || !Number.isFinite(close) || gammaFlip == null || !Number.isFinite(gammaFlip)) return null;
  return close >= gammaFlip ? "positive" : "negative";
}

/** Inclusive coverage window of a row set, for the UI to state plainly. Null when empty. */
export function coverage(rows: readonly DailyRegimeRow[]): { from: string; to: string; sessions: number } | null {
  const dates = rows.map((r) => r.date).filter(Boolean).sort();
  if (!dates.length) return null;
  return { from: dates[0]!, to: dates.at(-1)!, sessions: dates.length };
}
