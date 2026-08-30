import "server-only";

import type { PlayBieContext, VectorPlayInput } from "@/features/vector/lib/vector-play-engine";
import { vectorPlayBieBucketKey } from "@/features/vector/lib/vector-play-engine";
import {
  aggregateVectorPlayBieStats,
  bieBucketFromClosureRow,
  VECTOR_PLAY_BIE_WINDOW_DAYS,
  type VectorPlayBieClosureRow,
} from "@/features/vector/lib/vector-play-bie-stats";
import { dbConfigured, dbQuery } from "@/lib/db";
import { sharedCacheGet, sharedCacheSet } from "@/lib/shared-cache";

const BIE_CACHE_TTL_SEC = 5 * 60;

type RawClosureRow = {
  premium_pct_from_entry: string | number | null;
  setup_invalidated: boolean;
  vector_play: Record<string, unknown> | null;
  pick_context: Record<string, unknown> | null;
};

function mapClosureRows(rows: RawClosureRow[]): VectorPlayBieClosureRow[] {
  return rows.map((r) => ({
    premium_pct_from_entry:
      r.premium_pct_from_entry != null ? Number(r.premium_pct_from_entry) : null,
    setup_invalidated: r.setup_invalidated,
    bie_bucket: bieBucketFromClosureRow(r.vector_play, r.pick_context),
  }));
}

export async function fetchVectorPlayBieClosureRows(
  windowDays = VECTOR_PLAY_BIE_WINDOW_DAYS
): Promise<VectorPlayBieClosureRow[]> {
  if (!dbConfigured()) return [];
  try {
    const res = await dbQuery<RawClosureRow>(
      `SELECT
         premium_pct_from_entry,
         setup_invalidated,
         vector_play,
         pick_context
       FROM vector_pick_closures
       WHERE closed_at >= NOW() - ($1::int || ' days')::interval
       ORDER BY closed_at DESC
       LIMIT 5000`,
      [windowDays]
    );
    return mapClosureRows(res.rows ?? []);
  } catch {
    return [];
  }
}

function bieCacheKey(bucketKey: string): string {
  return `vector:play-bie:v1:${bucketKey}`;
}

/**
 * Resolve BIE historical grounding for a play snapshot. Returns null when n < MIN_SAMPLE —
 * the engine then omits the evidence line and skips the conviction nudge (fail-closed).
 */
export async function resolveVectorPlayBieContext(
  input: VectorPlayInput
): Promise<PlayBieContext | null> {
  const bucketKey = vectorPlayBieBucketKey(input);
  try {
    const cached = await sharedCacheGet<PlayBieContext>(bieCacheKey(bucketKey));
    if (cached && cached.samples >= 10) return cached;
  } catch {
    /* cache miss — fall through */
  }

  const rows = await fetchVectorPlayBieClosureRows();
  const stats = aggregateVectorPlayBieStats(rows, bucketKey);
  if (stats) {
    try {
      await sharedCacheSet(bieCacheKey(bucketKey), stats, BIE_CACHE_TTL_SEC);
    } catch {
      /* best-effort */
    }
  }
  return stats;
}

export { vectorPlayBieBucketKey };
