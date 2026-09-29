import { fetchOpenSwingPositions } from "@/lib/db";
import { listSharedUniverseTickers, mergeSharedUniverseTickers } from "./vector-dynamic-universe";

/**
 * The ticker set `vector-full-state-snapshot`'s cron should proactively warm — the cache
 * `fetchVectorFullState`/`fetchEcosystemContext` read cache-first (`vector:full-state:{ticker}:
 * {horizon}`, 15-min TTL — vector-full-state-cache.ts), consumed by Ask Largo's swing play-brief,
 * ecosystem context, and every other reader `vector-full-state.ts`'s own header lists.
 *
 * GAP FOUND (Ask Largo x Night Hawk Swings standing mandate): the cron previously iterated only
 * `vectorUniverseTickers()` (the static allowlist), not even `listSharedUniverseTickers()`'s
 * static-union-dynamic-viewed set its sibling crons (`heatmap-warm`, `vector-walls-warm`) already
 * use. `vector-dynamic-universe.ts`'s own header names the resulting hole explicitly: "Night Hawk
 * is deliberately NOT wired in here: its ticker universe is discovery-driven ... if Night Hawk
 * ever needs its board's active tickers kept warm, that should be a bulk union of discovery
 * output, not this per-view path." Nobody had closed that gap — a ticker with a REAL, committed
 * swing position but outside the static allowlist (live repro 2026-09-26: HUT) never got
 * proactively warmed. Its full-state entry only existed when someone happened to read it, and
 * expired 15 minutes later; the next read after expiry paid a genuine cold-compute fan-out
 * (measured live: 2169ms cold vs 150-290ms warm for the identical ticker/horizon), which under
 * concurrent load can tip the swing play-brief's 8s per-source budget
 * (BRIEF_SOURCE_TIMEOUT_MS, brief-source-timeout.ts) into a real "ecosystem context: fetch
 * failed" / "Vector state: fetch failed" disclosure on Ask Largo's brief for a position held with
 * real member capital — reproduced live on HUT's play-brief the same day.
 *
 * Scoped to OPEN swing positions (real capital, the highest-stakes blast radius), not the whole
 * WATCH rail — a smaller, high-value bulk union rather than re-deriving the entire discovery pool
 * here. `fetchOpenSwingPositions` failing (a DB hiccup) degrades to the shared universe alone,
 * never blocks the sweep.
 */
export async function activeVectorFullStateTickers(): Promise<string[]> {
  const [shared, positions] = await Promise.all([
    listSharedUniverseTickers(),
    fetchOpenSwingPositions().catch(() => []),
  ]);
  return mergeSharedUniverseTickers(
    shared,
    positions.map((p) => p.ticker)
  );
}
