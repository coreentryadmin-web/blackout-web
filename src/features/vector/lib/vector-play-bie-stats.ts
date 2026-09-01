import type { PlayBieContext } from "./vector-play-engine";

/** Below this sample size a hit rate is noise — same threshold as BIE confluence-outcomes. */
export const VECTOR_PLAY_BIE_MIN_SAMPLE = 10;

export const VECTOR_PLAY_BIE_WINDOW_DAYS = 60;

export type VectorPlayBieClosureRow = {
  premium_pct_from_entry: number | null;
  setup_invalidated: boolean;
  bie_bucket: string | null;
};

/**
 * At a Don't buy exit, "favorable" means the contract was still green OR the thesis was not
 * structurally broken — a soft trim, not a full invalidation loss.
 */
export function isVectorPickClosureFavorable(row: VectorPlayBieClosureRow): boolean {
  if (row.setup_invalidated) return false;
  const pct = row.premium_pct_from_entry;
  if (pct == null || !Number.isFinite(pct)) return false;
  return pct >= 0;
}

/** Pure aggregation for one bucket — unit-testable without Postgres. */
export function aggregateVectorPlayBieStats(
  rows: readonly VectorPlayBieClosureRow[],
  bucketKey: string,
  windowDays = VECTOR_PLAY_BIE_WINDOW_DAYS
): PlayBieContext | null {
  const matched = rows.filter((r) => r.bie_bucket === bucketKey);
  if (matched.length < VECTOR_PLAY_BIE_MIN_SAMPLE) return null;
  const fav = matched.filter(isVectorPickClosureFavorable).length;
  return {
    favPct: fav / matched.length,
    samples: matched.length,
    windowDays,
  };
}

/** Extract bucket key stored at closure time, or recompute from legacy rows. */
export function bieBucketFromClosureRow(
  vectorPlay: Record<string, unknown> | null,
  pickContext: Record<string, unknown> | null
): string | null {
  const fromCtx = pickContext?.bie_bucket;
  if (typeof fromCtx === "string" && fromCtx.length > 0) return fromCtx;
  const fromPlay = vectorPlay?.bie_bucket;
  if (typeof fromPlay === "string" && fromPlay.length > 0) return fromPlay;
  return null;
}
