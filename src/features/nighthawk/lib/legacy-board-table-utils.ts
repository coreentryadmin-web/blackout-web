import type { TerminalPlay } from "@/features/nighthawk/command-deck/types";
import {
  legacyActionDisplay,
  playStatusDisplay,
} from "@/features/nighthawk/command-deck/play-card-lifecycle";
import type {
  VectorBoardCalendarBucket,
  VectorBoardRowKind,
  VectorBoardStatus,
  VectorBoardTableRow,
} from "@/features/nighthawk/lib/vector-board-table-utils";
import {
  formatPremiumPct,
  premiumPctTone,
  type VectorBoardMeter,
} from "@/features/nighthawk/lib/vector-board-table-utils";
import type { VectorBoardTab } from "@/features/nighthawk/lib/vector-board-table-utils";

export type LegacyBoardTableRow = VectorBoardTableRow & { play: TerminalPlay };

function legacyVectorStatus(play: TerminalPlay): { status: VectorBoardStatus; label: string } {
  const action = legacyActionDisplay(play);
  if (action) {
    const status: VectorBoardStatus =
      action.label === "PULLED"
        ? "invalidated"
        : action.label === "DEGRADED" || action.label === "UNVERIFIED"
          ? "caution"
          : play.status === "OPEN" || play.status === "HOLD" || play.status === "TRIM"
            ? "open"
            : "closed";
    return { status, label: action.label };
  }
  if (play.status === "SKIP") return { status: "invalidated", label: "PULLED" };
  if (play.status === "CLOSED") return { status: "closed", label: "CLOSED" };
  if (play.status === "WATCH") return { status: "open", label: "WATCH" };
  if (play.morningStatus === "CONFIRMED") return { status: "open", label: "CONFIRMED" };
  const base = playStatusDisplay(play.status);
  const status: VectorBoardStatus =
    base.tone === "closed" ? "closed" : base.tone === "watch" ? "caution" : "open";
  return { status, label: base.label };
}

function legacyRowKind(play: TerminalPlay): VectorBoardRowKind {
  if (play.status === "SKIP" || play.status === "CLOSED" || play.pulled) return "closed";
  if (play.status === "WATCH") return "open";
  const pct = play.pnlPct;
  if (pct != null && pct >= 50) return "winner";
  if (pct != null && pct >= 15) return "runner";
  return "live";
}

function legacyTier(play: TerminalPlay): "elite" | "standard" | null {
  const t = play.tierLabel?.toUpperCase();
  if (t === "A" || t === "A+") return "elite";
  if (t) return "standard";
  return null;
}

export function terminalPlayToLegacyRow(play: TerminalPlay, editionFor: string | null): LegacyBoardTableRow {
  const { status, label } = legacyVectorStatus(play);
  const entryPrem = play.entryCostPerContract ?? null;
  const mark = play.mark ?? null;
  const peak = play.peak ?? play.pnlPct;
  const progressPct =
    play.progress != null && Number.isFinite(play.progress)
      ? Math.round(Math.max(0, Math.min(1, play.progress)) * 100)
      : null;

  return {
    play,
    key: play.id,
    kind: legacyRowKind(play),
    status,
    statusLabel: label,
    ticker: play.ticker,
    contractLabel: play.contract,
    occ: play.occ ?? "",
    sessionDate: editionFor ?? "",
    rank: play.rank ?? null,
    tier: legacyTier(play),
    entryMid: entryPrem,
    markMid: mark,
    premiumPct: play.pnlPct ?? null,
    peakPct: peak ?? null,
    progressPct,
    reason: play.recNote ?? play.thesis ?? "",
    timestamp: play.markAsOf ?? play.firstFlaggedAt ?? play.detectedAt ?? "",
    setupInvalidated: play.pulled === true || play.morningStatus === "INVALIDATED",
  };
}

export function buildLegacyBoardRows(
  plays: TerminalPlay[],
  tab: VectorBoardTab,
  editionFor: string | null
): LegacyBoardTableRow[] {
  const rows = plays.map((p) => terminalPlayToLegacyRow(p, editionFor));
  if (tab === "all") return rows;
  if (tab === "open") {
    return rows.filter(
      (r) =>
        r.kind !== "closed"
        && r.play.status !== "SKIP"
        && r.play.status !== "CLOSED"
        && !r.play.pulled
    );
  }
  return rows.filter(
    (r) =>
      r.kind === "closed"
      || r.play.status === "SKIP"
      || r.play.pulled
      || r.play.morningStatus === "INVALIDATED"
  );
}

export function legacyBoardMeter(row: LegacyBoardTableRow): VectorBoardMeter | null {
  const pct = row.premiumPct;
  const tone = premiumPctTone(pct);
  const stockMove = row.play.stockMovePct ?? null;

  if (row.progressPct != null) {
    const stockTone = premiumPctTone(stockMove);
    const premiumLabel = pct != null ? formatPremiumPct(pct) : null;
    return {
      valueLabel: premiumLabel ?? formatPremiumPct(stockMove),
      fillPct: row.progressPct,
      caption:
        pct != null
          ? `${row.progressPct}% to stock target`
          : `${row.progressPct}% stock → target (not option P&L)`,
      tone: stockTone === "bull" ? "up" : stockTone === "bear" ? "down" : "flat",
    };
  }

  const valueLabel = formatPremiumPct(pct);

  if (pct == null || !Number.isFinite(pct)) return null;
  if (pct >= 50) {
    return { valueLabel, fillPct: 100, caption: "premium at floor", tone: tone === "bull" ? "up" : tone === "bear" ? "down" : "flat" };
  }
  const towardFloor = Math.max(0, Math.min(100, Math.round((Math.max(0, pct) / 50) * 100)));
  return {
    valueLabel,
    fillPct: towardFloor,
    caption: `${towardFloor}% premium path`,
    tone: tone === "bull" ? "up" : tone === "bear" ? "down" : "flat",
  };
}

export function legacyBoardCalendarBuckets(
  rows: LegacyBoardTableRow[],
  editionDates: string[]
): VectorBoardCalendarBucket[] {
  const byDate = new Map<string, LegacyBoardTableRow[]>();
  for (const r of rows) {
    const d = r.sessionDate;
    if (!d) continue;
    const bucket = byDate.get(d) ?? [];
    bucket.push(r);
    byDate.set(d, bucket);
  }
  return editionDates.map((session_date) => {
    const day = byDate.get(session_date) ?? [];
    const net = day.reduce((s, r) => s + (r.premiumPct ?? 0), 0);
    const winners = day.filter((r) => (r.premiumPct ?? 0) >= 50).length;
    const closed = day.filter((r) => r.kind === "closed").length;
    const tone = net > 2 ? "up" : net < -2 ? "down" : "flat";
    return {
      session_date,
      tone,
      net_premium_pct: day.length ? net / day.length : 0,
      n: day.length,
      winners,
      closed,
    };
  });
}

export function legacyBoardExportCsv(rows: LegacyBoardTableRow[]): string {
  const header = [
    "ticker", "contract", "status", "premium_pct", "exec_pnl_pct", "stock_move_pct", "peak_pct",
    "tier", "rank", "direction", "stop", "target", "entry_range", "morning_status", "gate_promoted",
    "risk_note", "factors", "updated",
  ];
  const lines = rows.map((r) => {
    const p = r.play;
    const factors = p.factors.map((f) => `${f.label}:${f.points}`).join("|");
    return [
      r.ticker,
      JSON.stringify(r.contractLabel),
      r.statusLabel,
      r.premiumPct ?? "",
      p.execPnlPct ?? "",
      p.stockMovePct ?? "",
      r.peakPct ?? "",
      p.tierLabel ?? "",
      p.rank ?? "",
      p.direction ?? "",
      JSON.stringify(p.stopLevel ?? ""),
      JSON.stringify(p.targetLevel ?? ""),
      JSON.stringify(p.entryRange ?? ""),
      p.morningStatus ?? "",
      p.gatePromoted ? "yes" : "",
      JSON.stringify(p.riskNote ?? ""),
      JSON.stringify(factors),
      r.timestamp,
    ].join(",");
  });
  return [header.join(","), ...lines].join("\n");
}
