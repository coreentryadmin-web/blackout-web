import type { VectorBoardTableRow } from "@/features/nighthawk/lib/vector-board-table-utils";
import { formatPremiumPct } from "@/features/nighthawk/lib/vector-board-table-utils";

const LIVE_MS = 60_000;

export type VectorBoardTimelineEvent = {
  at: string;
  label: string;
  tone?: "up" | "down" | "neutral";
};

export type VectorBoardScorecard = {
  total: number;
  winners: number;
  runners: number;
  open: number;
  closed: number;
  hitRate: number | null;
  netPremiumPct: number | null;
  winnersFloorPct: number | null;
  runnerPipelinePct: number | null;
  avgGivebackPct: number | null;
  bestPick: VectorBoardTableRow | null;
};

export function vectorBoardRowIsLive(row: VectorBoardTableRow, now = Date.now()): boolean {
  if (row.kind === "closed") return false;
  const ts = Date.parse(row.timestamp);
  if (Number.isNaN(ts)) return false;
  return now - ts <= LIVE_MS;
}

/** Composite desk signal: gave back from peak + caution/invalidated. */
export function vectorBoardRowAtRisk(row: VectorBoardTableRow): boolean {
  if (row.kind === "closed") return false;
  const gaveBack =
    row.peakPct != null &&
    row.premiumPct != null &&
    row.peakPct > 0 &&
    row.peakPct - row.premiumPct >= 20;
  return gaveBack || row.status === "caution" || row.status === "invalidated";
}

/** How much of the peak gain has been given back, as a PERCENTAGE OF THE PEAK — not a raw
 *  percentage-POINT difference. `peakPct - premiumPct` mislabels points as a "%": a play that
 *  peaked at 200% and now sits at 180% (a mild 10% giveback of its own peak) reported identically
 *  to one that peaked at 25% and now sits at 5% (an 80% giveback, far more severe) — both "gave
 *  back 20%" under the old math despite being very different situations. Same bug shape already
 *  fixed for Swing's "gave back X% from peak" narrative bullets (`mfe-capture.ts`,
 *  FINDINGS 2026-09-10) — this is that fix's Vector-desk sibling, missed by that fix's own
 *  blast-radius grep because this file uses `premiumPct`/`peakPct`, not `pnlPct`/`peak`. */
export function vectorBoardRowGivebackPct(row: VectorBoardTableRow): number | null {
  const peak = row.peakPct;
  const live = row.premiumPct;
  if (peak == null || !Number.isFinite(peak) || peak <= 0) return null;
  if (live == null || !Number.isFinite(live)) return null;
  const capturedPct = Math.max(0, Math.min(100, (live / peak) * 100));
  return Math.round(100 - capturedPct);
}

/** True only for Legacy's pre-open pull (legacy-board-table-utils.ts's `legacyVectorStatus`
 *  stamps this exact label on a SKIP/pulled play, and no other lane produces it) — a play the
 *  morning-confirm latch withdrew before the open, which therefore never had real capital at
 *  risk. Distinct from Vector's own `status: "invalidated"` (a live position whose thesis broke
 *  mid-trade, real exposure, a real result) even though both share the same generic `status`
 *  value — `statusLabel` is what actually tells them apart. Exported so every rollup that blends
 *  `premiumPct` across rows (the scorecard here, the calendar buckets in the sibling
 *  vector-board-table-utils.ts/legacy-board-table-utils.ts) shares ONE definition rather than
 *  each guessing at its own copy. */
export function isNeverEnteredPull(row: VectorBoardTableRow): boolean {
  return row.statusLabel === "PULLED";
}

export function vectorBoardTimeline(row: VectorBoardTableRow): VectorBoardTimelineEvent[] {
  const events: VectorBoardTimelineEvent[] = [];
  const pct = row.premiumPct;
  const peak = row.peakPct;

  if (row.kind !== "closed") {
    events.push({ at: row.timestamp, label: "Last desk update", tone: "neutral" });
    if (pct != null && pct >= 50) {
      events.push({ at: row.timestamp, label: "Winner floor met (+50%)", tone: "up" });
    } else if (pct != null && pct >= 15) {
      events.push({ at: row.timestamp, label: "Runner threshold met (+15%)", tone: "up" });
    }
    if (row.status === "caution") {
      events.push({ at: row.timestamp, label: "Caution flag raised", tone: "down" });
    }
    if (row.setupInvalidated) {
      events.push({ at: row.timestamp, label: "Setup invalidated", tone: "down" });
    }
    if (peak != null && pct != null && peak - pct >= 20) {
      // Gate stays point-based (an absolute-point drop is when this timeline event fires at
      // all) but the DISPLAYED number must be the proportional giveback, not the raw point
      // difference — same fix as `vectorBoardRowGivebackPct` above, this is its only other
      // independent reimplementation of the same math in this file.
      const gb = vectorBoardRowGivebackPct(row);
      events.push({
        at: row.timestamp,
        label: gb != null ? `Gave back ${gb}% from peak` : "Gave back from peak",
        tone: "down",
      });
    }
    if (row.reason) {
      events.push({ at: row.timestamp, label: row.reason, tone: "neutral" });
    }
  } else {
    events.push({ at: row.timestamp, label: "Closed", tone: pct != null && pct >= 0 ? "up" : "down" });
    if (row.reason) events.push({ at: row.timestamp, label: row.reason, tone: "neutral" });
  }

  return events;
}

export function vectorBoardSparklinePoints(row: VectorBoardTableRow): number[] {
  const entry = 0;
  const peak = row.peakPct ?? row.premiumPct ?? 0;
  const mark = row.premiumPct ?? 0;
  if (row.kind === "closed") return [entry, peak, mark];
  return [entry, Math.max(entry, peak * 0.4), Math.max(entry, peak * 0.7), peak, mark];
}

export function vectorBoardScorecard(rows: VectorBoardTableRow[]): VectorBoardScorecard {
  let winners = 0;
  let runners = 0;
  let open = 0;
  let closed = 0;
  // Real resolutions only (excludes never-entered pulls) — the honest hit-rate denominator.
  // Kept separate from `closed` (which stays inclusive of pulls, matching the "Closed (N)" tab
  // count elsewhere on the board) so the two numbers don't silently drift apart.
  let closedResolved = 0;
  let sumPct = 0;
  let pctN = 0;
  let closedWinners = 0;
  let openTotal = 0;
  let openWinners = 0;
  let openRunners = 0;
  let givebackSum = 0;
  let givebackN = 0;
  let best: VectorBoardTableRow | null = null;

  for (const row of rows) {
    const neverEntered = isNeverEnteredPull(row);
    // A pulled play never had a real fill, so its premiumPct is a hypothetical "would have
    // happened" number, not an achieved result — it must never contribute to "Net premium" (a
    // blended average across today's rows) or win "Best pick". Measured live, 2026-09-10: with
    // SIG at -82% and FICO at +29% (real, open), "Net premium" read +110% and the day's calendar
    // tile read +109.7% — both driven entirely by blending in a pulled ASO's +300%-range
    // counterfactual; excluding it, the honest blended figure for that session was -26.5%.
    if (!neverEntered && row.premiumPct != null && Number.isFinite(row.premiumPct)) {
      sumPct += row.premiumPct;
      pctN += 1;
      if (!best || (row.premiumPct ?? -Infinity) > (best.premiumPct ?? -Infinity)) {
        best = row;
      }
    }
    if (row.status === "winner") winners += 1;
    if (row.status === "runner") runners += 1;
    if (row.status === "open" || row.status === "caution") open += 1;
    if (row.kind === "closed" || row.status === "closed" || row.status === "invalidated") {
      closed += 1;
      if (!neverEntered) {
        closedResolved += 1;
        // Same reasoning as `best` above: a pulled play's counterfactual return must never count
        // toward "Hit rate" — no capital was ever live on it, so it cannot have been "hit".
        if (row.premiumPct != null && row.premiumPct >= 50) closedWinners += 1;
      }
    }
    if (row.kind !== "closed") {
      openTotal += 1;
      if (row.status === "winner") openWinners += 1;
      if (row.status === "runner") openRunners += 1;
      const gb = vectorBoardRowGivebackPct(row);
      if (gb != null) {
        givebackSum += gb;
        givebackN += 1;
      }
    }
  }

  // The live-status fallback (no real close has happened yet) must exclude never-entered pulls
  // from its denominator exactly as the closedResolved/closedWinners path already excludes them
  // from ITS denominator — otherwise a session where every published play got pulled pre-open
  // (closedResolved stays 0, since a pull is never a "real" resolution) falls through to
  // `rows.length`, which is 100% phantom rows in that case, and reports a fabricated "0%" rather
  // than the honest "no resolved data yet" (null). A mixed day (some real open/closed rows plus a
  // pull) is unaffected: the real rows already dominate `nonPulledTotal`.
  const nonPulledTotal = rows.reduce((n, r) => (isNeverEnteredPull(r) ? n : n + 1), 0);
  const hitDenom = closedResolved > 0 ? closedResolved : nonPulledTotal;
  const hitNum = closedResolved > 0 ? closedWinners : winners;

  return {
    total: rows.length,
    winners,
    runners,
    open,
    closed,
    hitRate: hitDenom > 0 ? Math.round((hitNum / hitDenom) * 100) : null,
    netPremiumPct: pctN > 0 ? Math.round(sumPct / pctN) : null,
    winnersFloorPct: openTotal > 0 ? Math.round((openWinners / openTotal) * 100) : null,
    runnerPipelinePct: openTotal > 0 ? Math.round((openRunners / openTotal) * 100) : null,
    avgGivebackPct: givebackN > 0 ? Math.round(givebackSum / givebackN) : null,
    bestPick: best,
  };
}

export function vectorBoardTradeTicket(row: VectorBoardTableRow): string {
  const side = row.contractLabel;
  const entry = row.entryMid != null ? `$${row.entryMid.toFixed(2)}` : "—";
  const mark = row.markMid != null ? `$${row.markMid.toFixed(2)}` : "—";
  return `${row.ticker} ${side} · entry ${entry} · mark ${mark} · ${formatPremiumPct(row.premiumPct)} · OCC ${row.occ}`;
}

export function vectorBoardExportCsv(rows: VectorBoardTableRow[]): string {
  const header = [
    "Ticker",
    "Contract",
    "Status",
    "PremiumVsEntry",
    "Peak",
    "EntryMid",
    "MarkMid",
    "Session",
    "Updated",
    "Reason",
  ];
  const lines = rows.map((r) =>
    [
      r.ticker,
      r.contractLabel,
      r.statusLabel,
      r.premiumPct ?? "",
      r.peakPct ?? "",
      r.entryMid ?? "",
      r.markMid ?? "",
      r.sessionDate,
      r.timestamp,
      `"${(r.reason ?? "").replace(/"/g, '""')}"`,
    ].join(",")
  );
  return [header.join(","), ...lines].join("\n");
}

export function vectorBoardCalendarSlice(
  buckets: { session_date: string }[],
  mode: "recent" | "all"
): { session_date: string }[] {
  if (mode === "all" || buckets.length <= 5) return buckets;
  return buckets.slice(-5);
}
