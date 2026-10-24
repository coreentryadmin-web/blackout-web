import type { VectorClosurePlay } from "@/features/nighthawk/components/VectorPickLogBoard.types";
import { isVectorPickRunner } from "@/lib/vector/vector-pick-sweep-core";

export type VectorClosureReasonFilter =
  | "all"
  | "setup_invalidated"
  | "premium_chase"
  | "premium_cap"
  | "other";

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
