import type { VectorBoardTableRow } from "@/features/nighthawk/lib/vector-board-table-utils";
import type { VectorClosureReasonFilter } from "@/features/nighthawk/lib/vector-pick-log-board-utils";
import { classifyVectorClosureReason } from "@/features/nighthawk/lib/vector-pick-log-board-utils";

export type VectorBoardSortKey = "updated" | "pnl" | "peak" | "ticker" | "tier";
export type VectorBoardSortDir = "asc" | "desc";

export type VectorBoardStatusFilter =
  | "all"
  | "open"
  | "winner"
  | "runner"
  | "caution"
  | "closed"
  | "invalidated";

export type VectorBoardTierFilter = "all" | "elite" | "standard";

export type VectorBoardSort = `${VectorBoardSortKey}_${VectorBoardSortDir}`;

export const VECTOR_BOARD_SORT_OPTIONS: {
  id: VectorBoardSort;
  label: string;
  key: VectorBoardSortKey;
  dir: VectorBoardSortDir;
}[] = [
  { id: "updated_desc", label: "Newest first", key: "updated", dir: "desc" },
  { id: "updated_asc", label: "Oldest first", key: "updated", dir: "asc" },
  { id: "pnl_desc", label: "Premium high → low", key: "pnl", dir: "desc" },
  { id: "pnl_asc", label: "Premium low → high", key: "pnl", dir: "asc" },
  { id: "tier_desc", label: "Elite first, then premium", key: "tier", dir: "desc" },
  { id: "peak_desc", label: "Peak high → low", key: "peak", dir: "desc" },
  { id: "ticker_asc", label: "Ticker A → Z", key: "ticker", dir: "asc" },
];

export const VECTOR_BOARD_REASON_OPTIONS: { id: VectorClosureReasonFilter; label: string }[] = [
  { id: "all", label: "All reasons" },
  { id: "setup_invalidated", label: "Setup invalidated" },
  { id: "premium_chase", label: "Premium chase" },
  { id: "premium_cap", label: "Desk cap" },
  { id: "other", label: "Other" },
];

export function parseVectorBoardSort(id: VectorBoardSort): {
  key: VectorBoardSortKey;
  dir: VectorBoardSortDir;
} {
  const hit = VECTOR_BOARD_SORT_OPTIONS.find((o) => o.id === id);
  return hit ? { key: hit.key, dir: hit.dir } : { key: "updated", dir: "desc" };
}

export function sortVectorBoardRows(
  rows: VectorBoardTableRow[],
  key: VectorBoardSortKey,
  dir: VectorBoardSortDir
): VectorBoardTableRow[] {
  const copy = [...rows];
  const sign = dir === "asc" ? 1 : -1;
  copy.sort((a, b) => {
    if (key === "pnl") {
      const av = a.premiumPct ?? Number.NEGATIVE_INFINITY;
      const bv = b.premiumPct ?? Number.NEGATIVE_INFINITY;
      return (av - bv) * sign;
    }
    if (key === "peak") {
      const av = a.peakPct ?? Number.NEGATIVE_INFINITY;
      const bv = b.peakPct ?? Number.NEGATIVE_INFINITY;
      return (av - bv) * sign;
    }
    if (key === "ticker") {
      return a.ticker.localeCompare(b.ticker) * sign || b.timestamp.localeCompare(a.timestamp);
    }
    if (key === "tier") {
      const tierRank = (t: VectorBoardTableRow["tier"]) => (t === "elite" ? 0 : 1);
      const td = tierRank(a.tier) - tierRank(b.tier);
      if (td !== 0) return td * sign;
      const av = a.premiumPct ?? Number.NEGATIVE_INFINITY;
      const bv = b.premiumPct ?? Number.NEGATIVE_INFINITY;
      return (bv - av) * sign;
    }
    return a.timestamp.localeCompare(b.timestamp) * sign;
  });
  return copy;
}

export function filterVectorBoardRowsAdvanced(
  rows: VectorBoardTableRow[],
  opts: {
    tickerQuery?: string;
    sessionDate?: string | null;
    statusFilter?: VectorBoardStatusFilter;
    tierFilter?: VectorBoardTierFilter;
    reasonFilter?: VectorClosureReasonFilter;
  }
): VectorBoardTableRow[] {
  const q = opts.tickerQuery?.trim().toUpperCase() ?? "";
  return rows.filter((row) => {
    if (opts.sessionDate && !row.sessionDate.startsWith(opts.sessionDate)) return false;

    if (opts.statusFilter && opts.statusFilter !== "all") {
      if (opts.statusFilter === "open" && row.status !== "open") return false;
      if (opts.statusFilter === "winner" && row.status !== "winner") return false;
      if (opts.statusFilter === "runner" && row.status !== "runner") return false;
      if (opts.statusFilter === "caution" && row.status !== "caution") return false;
      if (opts.statusFilter === "closed" && row.kind !== "closed" && row.status !== "closed") return false;
      if (opts.statusFilter === "invalidated" && row.status !== "invalidated") return false;
    }

    if (opts.tierFilter && opts.tierFilter !== "all") {
      if ((row.tier ?? "standard") !== opts.tierFilter) return false;
    }

    if (opts.reasonFilter && opts.reasonFilter !== "all") {
      if (!row.closed) return false;
      if (classifyVectorClosureReason(row.closed) !== opts.reasonFilter) return false;
    }

    if (q && !row.ticker.toUpperCase().includes(q)) return false;
    return true;
  });
}

/** Equal-weight net premium % across rows with a P&L reading — session diagnostic strip. */
export function vectorBoardNetPnl(rows: VectorBoardTableRow[]): number | null {
  let sum = 0;
  let n = 0;
  for (const row of rows) {
    if (row.premiumPct == null || !Number.isFinite(row.premiumPct)) continue;
    sum += row.premiumPct;
    n += 1;
  }
  if (n === 0) return null;
  return Math.round(sum);
}

export function vectorBoardSessionPnl(rows: VectorBoardTableRow[], sessionDate: string | null): number | null {
  if (!sessionDate) return null;
  return vectorBoardNetPnl(rows.filter((r) => r.sessionDate.startsWith(sessionDate)));
}

export function vectorBoardActiveFilterCount(opts: {
  statusFilter: VectorBoardStatusFilter;
  tierFilter: VectorBoardTierFilter;
  reasonFilter: VectorClosureReasonFilter;
  selectedDate: string | null;
  tickerQuery: string;
}): number {
  let n = 0;
  if (opts.statusFilter !== "all") n += 1;
  if (opts.tierFilter !== "all") n += 1;
  if (opts.reasonFilter !== "all") n += 1;
  if (opts.selectedDate) n += 1;
  if (opts.tickerQuery.trim()) n += 1;
  return n;
}
