import type {
  VectorClosurePlay,
  VectorLeaderPlay,
} from "@/features/nighthawk/components/VectorPickLogBoard.types";
import {
  filterVectorRunnerLeaders,
  formatPremiumPct,
  premiumPctTone,
} from "@/features/nighthawk/lib/vector-pick-log-board-utils";
import { isVectorPickRunner as isRunnerCore } from "@/lib/vector/vector-pick-sweep-core";

export type VectorBoardRowKind = "winner" | "runner" | "live" | "closed";

export type VectorBoardStatus =
  | "open"
  | "runner"
  | "winner"
  | "caution"
  | "closed"
  | "invalidated";

export type VectorBoardTableRow = {
  key: string;
  kind: VectorBoardRowKind;
  status: VectorBoardStatus;
  statusLabel: string;
  ticker: string;
  contractLabel: string;
  occ: string;
  sessionDate: string;
  rank: number | null;
  tier: "elite" | "standard" | null;
  entryMid: number | null;
  markMid: number | null;
  premiumPct: number | null;
  peakPct: number | null;
  progressPct: number | null;
  reason: string;
  timestamp: string;
  setupInvalidated: boolean;
  leader?: VectorLeaderPlay;
  closed?: VectorClosurePlay;
};

export type VectorBoardCalendarBucket = {
  session_date: string;
  tone: "up" | "down" | "flat";
  net_premium_pct: number;
  n: number;
  winners: number;
  closed: number;
};

export type VectorBoardMeter = {
  valueLabel: string;
  fillPct: number;
  caption: string;
  tone: "up" | "down" | "flat";
};

function meterTone(pct: number | null): VectorBoardMeter["tone"] {
  const t = premiumPctTone(pct);
  if (t === "bull") return "up";
  if (t === "bear") return "down";
  return "flat";
}

/** X Ads budget-remaining analogue — premium value + fill bar + caption %. */
export function vectorBoardMeter(row: VectorBoardTableRow): VectorBoardMeter | null {
  const pct = row.premiumPct;
  const tone = meterTone(pct);
  const valueLabel = formatPremiumPct(pct);

  if (row.progressPct != null && row.peakPct != null && row.peakPct > 0) {
    return {
      valueLabel,
      fillPct: row.progressPct,
      caption: `${row.progressPct}%`,
      tone,
    };
  }

  if (pct == null || !Number.isFinite(pct)) return null;

  if (row.status === "winner" || pct >= 50) {
    return {
      valueLabel,
      fillPct: 100,
      caption: "100%",
      tone,
    };
  }

  const towardFloor = Math.max(0, Math.min(100, Math.round((Math.max(0, pct) / 50) * 100)));
  return {
    valueLabel,
    fillPct: towardFloor,
    caption: `${towardFloor}%`,
    tone,
  };
}

export function leaderRowKind(row: VectorLeaderPlay): VectorBoardRowKind {
  if (row.is_winner || row.closed_winner) return "winner";
  if (
    isRunnerCore({
      premium_pct_from_entry: row.premium_pct_from_entry,
      peak_premium_pct: row.peak_premium_pct,
      action_status: row.action_status,
    })
  ) {
    return "runner";
  }
  return "live";
}

export function leaderStatus(row: VectorLeaderPlay): { status: VectorBoardStatus; label: string } {
  if (row.is_winner || row.closed_winner) return { status: "winner", label: "Winner" };
  if (row.action_status === "caution") return { status: "caution", label: "Caution" };
  if (row.setup_invalidated) return { status: "invalidated", label: "Stressed" };
  if (
    isRunnerCore({
      premium_pct_from_entry: row.premium_pct_from_entry,
      peak_premium_pct: row.peak_premium_pct,
      action_status: row.action_status,
    })
  ) {
    return { status: "runner", label: "Runner" };
  }
  if (row.action_status === "still_buy") return { status: "open", label: "Open" };
  return { status: "closed", label: "Closed" };
}

export function closureStatus(row: VectorClosurePlay): { status: VectorBoardStatus; label: string } {
  if (row.setup_invalidated) return { status: "invalidated", label: "Invalidated" };
  const pct = row.premium_pct_from_entry;
  if (pct != null && pct >= 50) return { status: "winner", label: "Winner" };
  if (pct != null && pct > 0) return { status: "runner", label: "Closed +" };
  return { status: "closed", label: "Closed" };
}

function progressFromPeak(row: Pick<VectorLeaderPlay, "premium_pct_from_entry" | "peak_premium_pct">): number | null {
  const peak = row.peak_premium_pct;
  const live = row.premium_pct_from_entry;
  if (peak == null || !Number.isFinite(peak) || peak <= 0) return null;
  if (live == null || !Number.isFinite(live)) return null;
  return Math.max(0, Math.min(100, Math.round((live / peak) * 100)));
}

export function leaderToTableRow(row: VectorLeaderPlay): VectorBoardTableRow {
  const kind = leaderRowKind(row);
  const { status, label } = leaderStatus(row);
  const premiumPct = row.premium_pct_from_entry ?? row.peak_premium_pct;
  return {
    key: `l-${row.id}-${row.contract.occ}`,
    kind,
    status,
    statusLabel: label,
    ticker: row.ticker,
    contractLabel:
      row.contract.label ?? `${row.contract.strike}${row.contract.side === "call" ? "C" : "P"}`,
    occ: row.contract.occ,
    sessionDate: row.session_date,
    rank: row.rank,
    tier: row.tier ?? null,
    entryMid: row.entry_mid,
    markMid: row.live_mid,
    premiumPct,
    peakPct: row.peak_premium_pct,
    progressPct: progressFromPeak(row),
    reason: row.action_reason,
    timestamp: row.updated_at,
    setupInvalidated: row.setup_invalidated,
    leader: row,
  };
}

export function closureToTableRow(row: VectorClosurePlay): VectorBoardTableRow {
  const { status, label } = closureStatus(row);
  return {
    key: `c-${row.id}-${row.contract.occ}`,
    kind: "closed",
    status,
    statusLabel: label,
    ticker: row.ticker,
    contractLabel:
      row.contract.label ?? `${row.contract.strike}${row.contract.side === "call" ? "C" : "P"}`,
    occ: row.contract.occ,
    sessionDate: row.session_date,
    rank: row.rank,
    tier: null,
    entryMid: row.entry_mid,
    markMid: row.close_mid,
    premiumPct: row.premium_pct_from_entry,
    peakPct: row.premium_pct_from_entry,
    progressPct: null,
    reason: row.close_reason,
    timestamp: row.closed_at,
    setupInvalidated: row.setup_invalidated,
    closed: row,
  };
}

export function buildVectorBoardRows(input: {
  winners: VectorLeaderPlay[];
  leaders: VectorLeaderPlay[];
  closed: VectorClosurePlay[];
  section: "all" | VectorBoardRowKind;
}): VectorBoardTableRow[] {
  const runners = filterVectorRunnerLeaders(input.leaders);
  const winnerKeys = new Set(input.winners.map((w) => `${w.ticker}-${w.contract.occ}`));

  let rows: VectorBoardTableRow[] = [];

  if (input.section === "all") {
    const winnerRows = input.winners.map(leaderToTableRow);
    const runnerRows = runners
      .filter((r) => !winnerKeys.has(`${r.ticker}-${r.contract.occ}`))
      .map(leaderToTableRow);
    const liveRows = input.leaders
      .filter(
        (r) =>
          !winnerKeys.has(`${r.ticker}-${r.contract.occ}`) &&
          !isRunnerCore({
            premium_pct_from_entry: r.premium_pct_from_entry,
            peak_premium_pct: r.peak_premium_pct,
            action_status: r.action_status,
          })
      )
      .map(leaderToTableRow);
    const closedRows = input.closed.map(closureToTableRow);
    rows = [...winnerRows, ...runnerRows, ...liveRows, ...closedRows];
  } else if (input.section === "winner") {
    rows = input.winners.map(leaderToTableRow);
  } else if (input.section === "runner") {
    rows = runners.map(leaderToTableRow);
  } else if (input.section === "live") {
    rows = input.leaders
      .filter(
        (r) =>
          !winnerKeys.has(`${r.ticker}-${r.contract.occ}`) &&
          !isRunnerCore({
            premium_pct_from_entry: r.premium_pct_from_entry,
            peak_premium_pct: r.peak_premium_pct,
            action_status: r.action_status,
          })
      )
      .map(leaderToTableRow);
  } else {
    rows = input.closed.map(closureToTableRow);
  }

  return rows.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
}

export function filterVectorBoardRows(
  rows: VectorBoardTableRow[],
  opts: {
    tickerQuery?: string;
    sessionDate?: string | null;
    statusFilter?: "all" | "open" | "closed";
  }
): VectorBoardTableRow[] {
  const q = opts.tickerQuery?.trim().toUpperCase() ?? "";
  return rows.filter((row) => {
    if (opts.sessionDate && !row.sessionDate.startsWith(opts.sessionDate)) return false;
    if (opts.statusFilter === "open" && (row.kind === "closed" || row.status === "closed")) return false;
    if (opts.statusFilter === "closed" && row.kind !== "closed" && row.status !== "winner" && row.status !== "invalidated") {
      if (row.status === "open" || row.status === "runner" || row.status === "caution") return false;
    }
    if (q && !row.ticker.toUpperCase().includes(q)) return false;
    return true;
  });
}

export function vectorBoardCalendarBuckets(rows: VectorBoardTableRow[]): VectorBoardCalendarBucket[] {
  const map = new Map<string, { sum: number; n: number; winners: number; closed: number }>();
  for (const row of rows) {
    const cur = map.get(row.sessionDate) ?? { sum: 0, n: 0, winners: 0, closed: 0 };
    cur.n += 1;
    if (row.premiumPct != null && Number.isFinite(row.premiumPct)) cur.sum += row.premiumPct;
    if (row.status === "winner") cur.winners += 1;
    if (row.kind === "closed") cur.closed += 1;
    map.set(row.sessionDate, cur);
  }
  return Array.from(map.entries())
    .map(([session_date, v]) => {
      const avg = v.n > 0 ? v.sum / v.n : 0;
      const tone: VectorBoardCalendarBucket["tone"] =
        avg > 0 ? "up" : avg < 0 ? "down" : "flat";
      return {
        session_date,
        tone,
        net_premium_pct: Math.round(avg),
        n: v.n,
        winners: v.winners,
        closed: v.closed,
      };
    })
    .sort((a, b) => a.session_date.localeCompare(b.session_date));
}

export function vectorBoardSummary(rows: VectorBoardTableRow[]) {
  let sumPct = 0;
  let pctCount = 0;
  let open = 0;
  let closed = 0;
  let winners = 0;
  for (const row of rows) {
    if (row.premiumPct != null && Number.isFinite(row.premiumPct)) {
      sumPct += row.premiumPct;
      pctCount += 1;
    }
    if (row.status === "open" || row.status === "runner" || row.status === "caution") open += 1;
    if (row.kind === "closed" || row.status === "closed" || row.status === "invalidated") closed += 1;
    if (row.status === "winner") winners += 1;
  }
  return {
    total: rows.length,
    avgPct: pctCount > 0 ? Math.round(sumPct / pctCount) : null,
    netPnl: pctCount > 0 ? Math.round(sumPct) : null,
    open,
    closed,
    winners,
  };
}

export { formatPremiumPct, premiumPctTone };
