// src/lib/swing/lane-rank-at-commit.ts — the `LaneRankAtCommit` type + its structural parser,
// split out of commit.ts into their own zero-dependency module.
//
// WHY THIS FILE EXISTS (not just inlined in commit.ts, where the logic naturally lives): commit.ts
// imports `cortexEntryContextFor`/`ZeroDteCortexAssessment` from `@/lib/zerodte/cortex-gate`, which
// transitively pulls in several `server-only` modules (nighthawk/cortex/fetch.ts, polygon-largo.ts,
// api-telemetry-persist.ts, bie/vector-full-state.ts, meridian-benzinga-earnings.ts, ...). That is
// correct for commit.ts itself (it only ever runs server-side), but `adapters.ts` — which needs
// `parseLaneRankAtCommit` to read the stamp back out for the play-brief — is shared into at least
// one CLIENT component (`ZeroDteCommandPreviewClient.tsx`), and importing even one named export
// from a module forces Next.js to resolve that module's entire import graph, "server-only" chain
// included, which fails the client build outright. Keeping the type + parser in this standalone,
// dependency-free file lets `adapters.ts` depend on them without ever touching commit.ts's module
// graph, while `commit.ts` itself still imports from here too, so there is exactly one definition.
export interface LaneRankAtCommit {
  rank: number;
  total: number;
  score: number;
  medianScore: number;
  deltaFromMedian: number;
}

/** Parse a `LaneRankAtCommit` back out of the raw JSONB `entry_context.lane_rank_at_commit` —
 *  never trusts the blob structurally. Null on anything not shaped exactly like what commit.ts
 *  itself stamps. */
export function parseLaneRankAtCommit(raw: unknown): LaneRankAtCommit | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const nums = [r.rank, r.total, r.score, r.medianScore, r.deltaFromMedian];
  if (!nums.every((v) => typeof v === "number" && Number.isFinite(v))) return null;
  return {
    rank: r.rank as number,
    total: r.total as number,
    score: r.score as number,
    medianScore: r.medianScore as number,
    deltaFromMedian: r.deltaFromMedian as number,
  };
}
