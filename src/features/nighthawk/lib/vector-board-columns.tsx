import type { ReactNode } from "react";
import { clsx } from "clsx";
import { VectorBoardMeter } from "@/features/nighthawk/components/VectorBoardMeter";
import { VectorBoardStatusPill } from "@/features/nighthawk/components/VectorBoardStatus";
import type { VectorBoardTableRow } from "@/features/nighthawk/lib/vector-board-table-utils";
import {
  formatPremiumPct,
  vectorBoardMeter,
} from "@/features/nighthawk/lib/vector-board-table-utils";
import type { VectorBoardColumnId, VectorBoardPreferences } from "@/features/nighthawk/lib/vector-board-preferences";
import type { VectorBoardSortKey, VectorBoardSortDir } from "@/features/nighthawk/lib/vector-board-filters";

export type VectorBoardColumnKey = VectorBoardColumnId | "compare";

export type VectorBoardColumnDef = {
  key: VectorBoardColumnKey;
  colClass: string;
  thClass: string;
  header: ReactNode;
  ariaSort?: "none" | "ascending" | "descending";
  onHeaderClick?: () => void;
  headerTitle?: string;
  renderCell: (row: VectorBoardTableRow, ctx: VectorBoardRowRenderCtx) => ReactNode;
};

export type VectorBoardRowRenderCtx = {
  live: boolean;
  atRisk: boolean;
  compareChecked: boolean;
  onToggleCompare: () => void;
  fmtPrice: (v: number | null) => string;
  fmtTimestamp: (iso: string) => string;
  pnlClass: (pct: number | null) => string;
};

function ariaSort(active: boolean, dir: VectorBoardSortDir): "none" | "ascending" | "descending" {
  if (!active) return "none";
  return dir === "asc" ? "ascending" : "descending";
}

export function buildVectorBoardColumns(opts: {
  prefs: VectorBoardPreferences;
  compareMode: boolean;
  sortKey: VectorBoardSortKey;
  sortDir: VectorBoardSortDir;
  onSortPnl: () => void;
  onSortPeak: () => void;
  onSortUpdated: () => void;
}): VectorBoardColumnDef[] {
  const col = (id: VectorBoardColumnId) => opts.prefs.columns[id] !== false;
  const cols: VectorBoardColumnDef[] = [];

  if (opts.compareMode) {
    cols.push({
      key: "compare",
      colClass: "vector-board-col-check",
      thClass: "vector-board-col-check",
      header: null,
      renderCell: (row, ctx) => (
        <input
          type="checkbox"
          className="vector-board-compare-check"
          checked={ctx.compareChecked}
          onChange={(e) => {
            e.stopPropagation();
            ctx.onToggleCompare();
          }}
          aria-label={`Compare ${row.ticker}`}
        />
      ),
    });
  }

  if (col("pick")) {
    cols.push({
      key: "pick",
      colClass: "vector-board-col-pick",
      thClass: "vector-board-col-pick",
      header: "Pick",
      renderCell: (row, ctx) => (
        <>
          <div className="vector-board-pick-name">
            {ctx.live ? <span className="vector-board-live-dot" aria-label="Live" /> : null}
            {row.ticker}
          </div>
          <div className="vector-board-pick-sub">{row.contractLabel}</div>
          <div className="vector-board-pick-id">
            {row.tier === "elite" ? "Elite · " : ""}
            ID: {row.occ.slice(-8)}
          </div>
        </>
      ),
    });
  }

  if (col("status")) {
    cols.push({
      key: "status",
      colClass: "vector-board-col-status",
      thClass: "vector-board-col-status",
      header: "Status",
      renderCell: (row, ctx) => (
        <div className="vector-board-status-cell">
          <VectorBoardStatusPill status={row.status} label={row.statusLabel} />
          {ctx.atRisk ? <span className="vector-board-at-risk">At risk</span> : null}
        </div>
      ),
    });
  }

  if (col("premium")) {
    cols.push({
      key: "premium",
      colClass: "vector-board-col-num vector-board-col-premium",
      thClass: "vector-board-col-num vector-board-col-premium vector-board-th-sortable",
      header: <>Premium vs entry {opts.sortKey === "pnl" ? (opts.sortDir === "asc" ? "▲" : "▼") : ""}</>,
      ariaSort: ariaSort(opts.sortKey === "pnl", opts.sortDir),
      onHeaderClick: opts.onSortPnl,
      headerTitle: "Option premium vs pick entry — not managed 0DTE P&L",
      renderCell: (row, ctx) => (
        <span
          className={clsx(
            "vector-board-pnl vector-board-pnl-hero tabular-nums",
            ctx.pnlClass(row.premiumPct)
          )}
          title="Premium vs pick entry"
        >
          {formatPremiumPct(row.premiumPct)}
        </span>
      ),
    });
  }

  if (col("entryMark")) {
    cols.push({
      key: "entryMark",
      colClass: "vector-board-col-num vector-board-col-entry",
      thClass: "vector-board-col-num vector-board-col-entry",
      header: "Entry → mark",
      renderCell: (row, ctx) => (
        <span className="vector-board-mid tabular-nums">
          {ctx.fmtPrice(row.entryMid)} → {ctx.fmtPrice(row.markMid)}
        </span>
      ),
    });
  }

  if (col("peak")) {
    cols.push({
      key: "peak",
      colClass: "vector-board-col-num vector-board-col-peak",
      thClass: "vector-board-col-num vector-board-col-peak vector-board-th-sortable",
      header: <>Peak {opts.sortKey === "peak" ? (opts.sortDir === "asc" ? "▲" : "▼") : ""}</>,
      ariaSort: ariaSort(opts.sortKey === "peak", opts.sortDir),
      onHeaderClick: opts.onSortPeak,
      renderCell: (row, ctx) => (
        <span className={clsx("tabular-nums", ctx.pnlClass(row.peakPct))}>
          {formatPremiumPct(row.peakPct)}
        </span>
      ),
    });
  }

  if (col("path")) {
    cols.push({
      key: "path",
      colClass: "vector-board-col-num vector-board-col-path",
      thClass: "vector-board-col-num vector-board-col-path",
      header: "Premium path",
      renderCell: (row) => <VectorBoardMeter meter={vectorBoardMeter(row)} />,
    });
  }

  if (col("updated")) {
    cols.push({
      key: "updated",
      colClass: "vector-board-col-updated",
      thClass: "vector-board-col-updated vector-board-th-sortable",
      header: <>Updated {opts.sortKey === "updated" ? (opts.sortDir === "asc" ? "▲" : "▼") : ""}</>,
      ariaSort: ariaSort(opts.sortKey === "updated", opts.sortDir),
      onHeaderClick: opts.onSortUpdated,
      renderCell: (row, ctx) => (
        <span className="vector-board-col-time tabular-nums">{ctx.fmtTimestamp(row.timestamp)}</span>
      ),
    });
  }

  return cols;
}
