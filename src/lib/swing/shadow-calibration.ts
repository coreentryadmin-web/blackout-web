/**
 * Consumption path for graded swing_shadow_positions outcomes (deep-dive Q35).
 *
 * Mirrors the staged ladder in calibration.ts but scoped to shadow evidence per blocked gate
 * dimension. Shadow rows never auto-loosen real-money budget/caps — they produce a review signal
 * when enough graded outcomes accumulate.
 */
import { isSwingWin } from "./record";

/** Minimum graded shadow outcomes before logging provisional gate evidence. */
export const SHADOW_GATE_PROVISIONAL_MIN_N = 10;

/** Minimum graded shadow outcomes before recommending a gate calibration review. */
export const SHADOW_GATE_REVIEW_MIN_N = 30;

export type ShadowGateEvidenceRow = {
  blocked_by: string[];
  realized_pnl_pct: number | null;
  graded_at: string | null;
};

export type ShadowGateBucketReport = {
  dimension: string;
  n: number;
  wins: number;
  losses: number;
  winRatePct: number | null;
  tier: "RESEARCH" | "PROVISIONAL" | "REVIEW_READY";
  recommendReview: boolean;
  note: string;
};

/** Primary gate dimension for grouping — first shadow-eligible blocked_by token. */
export function primaryShadowBlockedDimension(blockedBy: string[]): string | null {
  const gate = blockedBy.find((b) =>
    b.startsWith("budget:") || b.startsWith("cap:") || b.startsWith("gate:G-"),
  );
  return gate ?? blockedBy[0] ?? null;
}

function tierForN(n: number): ShadowGateBucketReport["tier"] {
  if (n >= SHADOW_GATE_REVIEW_MIN_N) return "REVIEW_READY";
  if (n >= SHADOW_GATE_PROVISIONAL_MIN_N) return "PROVISIONAL";
  return "RESEARCH";
}

/** Group graded shadow rows by blocked gate dimension and stage evidence tiers. */
export function analyzeShadowGateEvidence(rows: ShadowGateEvidenceRow[]): ShadowGateBucketReport[] {
  const buckets = new Map<string, { wins: number; losses: number; n: number }>();

  for (const row of rows) {
    if (row.graded_at == null || row.realized_pnl_pct == null) continue;
    const dim = primaryShadowBlockedDimension(row.blocked_by);
    if (!dim) continue;
    const cur = buckets.get(dim) ?? { wins: 0, losses: 0, n: 0 };
    cur.n += 1;
    if (isSwingWin(row.realized_pnl_pct)) cur.wins += 1;
    else cur.losses += 1;
    buckets.set(dim, cur);
  }

  return [...buckets.entries()]
    .map(([dimension, stats]) => {
      const tier = tierForN(stats.n);
      const winRatePct = stats.n > 0 ? Number(((stats.wins / stats.n) * 100).toFixed(1)) : null;
      const recommendReview = tier === "REVIEW_READY";
      const note =
        tier === "REVIEW_READY"
          ? `n≥${SHADOW_GATE_REVIEW_MIN_N} — recommend reviewing whether ${dimension} blocked winners`
          : tier === "PROVISIONAL"
            ? `n≥${SHADOW_GATE_PROVISIONAL_MIN_N} — provisional shadow evidence only`
            : `n<${SHADOW_GATE_PROVISIONAL_MIN_N} — research only`;
      return {
        dimension,
        n: stats.n,
        wins: stats.wins,
        losses: stats.losses,
        winRatePct,
        tier,
        recommendReview,
        note,
      };
    })
    .sort((a, b) => b.n - a.n);
}
