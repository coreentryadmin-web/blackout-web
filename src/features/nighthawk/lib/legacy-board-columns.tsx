import type { ReactNode } from "react";
import { clsx } from "clsx";
import { VectorBoardMeter } from "@/features/nighthawk/components/VectorBoardMeter";
import { VectorBoardStatusPill } from "@/features/nighthawk/components/VectorBoardStatus";
import type { LegacyBoardTableRow } from "@/features/nighthawk/lib/legacy-board-table-utils";
import {
  legacyBoardMeter,
} from "@/features/nighthawk/lib/legacy-board-table-utils";
import { formatPremiumPct } from "@/features/nighthawk/lib/vector-board-table-utils";
import type { VectorBoardColumnId, VectorBoardPreferences } from "@/features/nighthawk/lib/vector-board-preferences";
import type { VectorBoardSortDir, VectorBoardSortKey } from "@/features/nighthawk/lib/vector-board-filters";

export type LegacyBoardColumnKey = VectorBoardColumnId | "compare" | "stock";

export type LegacyBoardColumnDef = {
  key: LegacyBoardColumnKey;
  colClass: string;
  thClass: string;
  header: ReactNode;
  ariaSort?: "none" | "ascending" | "descending";
  onHeaderClick?: () => void;
  headerTitle?: string;
  renderCell: (row: LegacyBoardTableRow, ctx: LegacyBoardRowRenderCtx) => ReactNode;
};

export type LegacyBoardRowRenderCtx = {
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

export function buildLegacyBoardColumns(opts: {
  prefs: VectorBoardPreferences;
  compareMode: boolean;
  sortKey: VectorBoardSortKey;
  sortDir: VectorBoardSortDir;
  onSortPnl: () => void;
  onSortPeak: () => void;
  onSortUpdated: () => void;
}): LegacyBoardColumnDef[] {
  const col = (id: VectorBoardColumnId) => opts.prefs.columns[id] !== false;
  const cols: LegacyBoardColumnDef[] = [];

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
            {row.play.tierLabel ? `Tier ${row.play.tierLabel} · ` : ""}
            {row.play.direction} · #{row.rank ?? "—"}
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
      headerTitle: "Option premium vs published entry",
      renderCell: (row, ctx) => (
        <span className={clsx("vector-board-pnl vector-board-pnl-hero tabular-nums", ctx.pnlClass(row.premiumPct))}>
          {formatPremiumPct(row.premiumPct)}
        </span>
      ),
    });
  }

  cols.push({
    key: "stock",
    colClass: "vector-board-col-num vector-board-col-entry",
    thClass: "vector-board-col-num vector-board-col-entry",
    header: "Stock move",
    headerTitle: "Underlying move from entry band — not option P&L",
    renderCell: (row, ctx) => (
      <span className={clsx("tabular-nums", ctx.pnlClass(row.play.stockMovePct ?? null))}>
        {formatPremiumPct(row.play.stockMovePct ?? null)}
      </span>
    ),
  });

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
      header: "Target path",
      renderCell: (row) => <VectorBoardMeter meter={legacyBoardMeter(row)} />,
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
