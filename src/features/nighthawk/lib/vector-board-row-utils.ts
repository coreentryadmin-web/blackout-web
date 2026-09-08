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

export function vectorBoardRowGivebackPct(row: VectorBoardTableRow): number | null {
  if (row.peakPct == null || row.premiumPct == null || row.peakPct <= 0) return null;
  return Math.max(0, Math.round(row.peakPct - row.premiumPct));
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
      events.push({
        at: row.timestamp,
        label: `Gave back ${Math.round(peak - pct)}% from peak`,
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
    if (row.premiumPct != null && Number.isFinite(row.premiumPct)) {
      sumPct += row.premiumPct;
      pctN += 1;
      if (!best || (row.premiumPct ?? -Infinity) > (best.premiumPct ?? -Infinity)) best = row;
    }
    if (row.status === "winner") winners += 1;
    if (row.status === "runner") runners += 1;
    if (row.status === "open" || row.status === "caution") open += 1;
    if (row.kind === "closed" || row.status === "closed" || row.status === "invalidated") {
      closed += 1;
      if (row.premiumPct != null && row.premiumPct >= 50) closedWinners += 1;
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

  const hitDenom = closed > 0 ? closed : rows.length;
  const hitNum = closed > 0 ? closedWinners : winners;

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
