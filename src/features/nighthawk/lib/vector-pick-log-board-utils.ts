import type { VectorClosurePlay } from "@/features/nighthawk/components/VectorPickLogBoard.types";
import { isVectorPickRunner } from "@/lib/vector/vector-pick-sweep-core";

export type VectorClosureReasonFilter =
  | "all"
  | "setup_invalidated"
  | "premium_chase"
  | "premium_cap"
  | "other";

export type VectorClosureSort = "newest" | "oldest" | "pct_desc" | "pct_asc" | "ticker";

export type VectorBoardSection = "winners" | "runners" | "leaders" | "closed";

/** First paint tab — winners first, then +15% runners, then full live board. */
export function preferredVectorBoardSection(
  winnersCount: number,
  runnersCount: number,
  leadersCount: number
): VectorBoardSection {
  if (winnersCount > 0) return "winners";
  if (runnersCount > 0) return "runners";
  if (leadersCount > 0) return "leaders";
  return "winners";
}

export function filterVectorRunnerLeaders<
  T extends {
    premium_pct_from_entry: number | null;
    peak_premium_pct: number | null;
    action_status: string;
    is_winner?: boolean;
  },
>(rows: readonly T[]): T[] {
  return rows.filter((row) =>
    isVectorPickRunner({
      premium_pct_from_entry: row.premium_pct_from_entry,
      peak_premium_pct: row.peak_premium_pct,
      action_status: row.action_status,
    })
  );
}

export function classifyVectorClosureReason(row: Pick<VectorClosurePlay, "close_reason" | "setup_invalidated">): Exclude<
  VectorClosureReasonFilter,
  "all"
> {
  if (row.setup_invalidated || /invalidated/i.test(row.close_reason)) return "setup_invalidated";
  if (/desk cap/i.test(row.close_reason)) return "premium_cap";
  if (/chase|extended \+/i.test(row.close_reason)) return "premium_chase";
  return "other";
}

export function filterVectorClosureRows(
  rows: readonly VectorClosurePlay[],
  opts: {
    sessionDate?: string | null;
    reason?: VectorClosureReasonFilter;
    tickerQuery?: string;
  }
): VectorClosurePlay[] {
  const q = opts.tickerQuery?.trim().toUpperCase() ?? "";
  return rows.filter((row) => {
    if (opts.sessionDate && !row.session_date.startsWith(opts.sessionDate)) return false;
    if (opts.reason && opts.reason !== "all") {
      if (classifyVectorClosureReason(row) !== opts.reason) return false;
    }
    if (q && !row.ticker.toUpperCase().includes(q)) return false;
    return true;
  });
}

export function sortVectorClosureRows(
  rows: readonly VectorClosurePlay[],
  sort: VectorClosureSort
): VectorClosurePlay[] {
  const copy = [...rows];
  switch (sort) {
    case "oldest":
      return copy.sort((a, b) => a.closed_at.localeCompare(b.closed_at));
    case "pct_desc":
      return copy.sort(
        (a, b) => (b.premium_pct_from_entry ?? -Infinity) - (a.premium_pct_from_entry ?? -Infinity)
      );
    case "pct_asc":
      return copy.sort(
        (a, b) => (a.premium_pct_from_entry ?? Infinity) - (b.premium_pct_from_entry ?? Infinity)
      );
    case "ticker":
      return copy.sort((a, b) => a.ticker.localeCompare(b.ticker) || b.closed_at.localeCompare(a.closed_at));
    case "newest":
    default:
      return copy.sort((a, b) => b.closed_at.localeCompare(a.closed_at));
  }
}

export function premiumPctTone(pct: number | null): "bull" | "bear" | "sky" {
  if (pct == null || !Number.isFinite(pct)) return "sky";
  if (pct > 0) return "bull";
  if (pct < 0) return "bear";
  return "sky";
}

export function formatPremiumPct(pct: number | null): string {
  if (pct == null || !Number.isFinite(pct)) return "—";
  const sign = pct >= 0 ? "+" : "";
  return `${sign}${pct.toFixed(0)}%`;
}
