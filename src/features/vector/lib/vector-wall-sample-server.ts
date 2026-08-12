import "server-only";

import { VECTOR_ORACLE_TICKERS, normalizeVectorTicker } from "./vector-ticker";
import { hasLiveGexStrikeExpiry } from "@/lib/ws/uw-socket";
import { vectorUniverseTickers } from "@/lib/heatmap-allowlist";
import {
  NON_UNIVERSE_WALL_TRAIL_SAMPLE_SEC,
  ORACLE_WALL_TRAIL_SAMPLE_SEC,
  UNIVERSE_WALL_TRAIL_SAMPLE_SEC,
  type WallTrailSampleScope,
} from "./vector-wall-sample";

/**
 * Server-only ticker-aware bucket interval — reads live UW WS subscription state via
 * `hasLiveGexStrikeExpiry`, which transitively pulls in `uw-socket.ts`'s server-only
 * WS/ingest machinery. MUST NEVER be imported by a "use client" component: Next.js's
 * App Router treats the whole module graph reachable from a client boundary as
 * client code, and a cron route elsewhere in that graph using `after()` breaks the
 * build the moment it becomes reachable from a client file (confirmed live — CI
 * failure on PR #1708 when this function briefly lived in vector-wall-sample.ts,
 * which VectorChart.tsx also imports; see docs/audit/FINDINGS.md 2026-08-05).
 *
 * Split out specifically so `vector-wall-sample.ts` can stay client-safe while this
 * file is imported only by server-only callers (vector-universe.ts, vector-snapshot.ts).
 *
 *  - `universe` scope (shared-universe recorder): always 5s — viewer or not.
 *  - `live` scope (SSE hub + active non-universe recorder): oracle / recorded-universe /
 *    live WS → 5s; genuinely on-demand names → 15s.
 * Env override wins for all tickers/scopes.
 *
 * THE CADENCE IS A PROPERTY OF THE RAIL, NOT OF THE WRITER.
 *
 * Both writers append to the SAME `vector:wall-history:{ticker}` rail, keyed by bucket time. So
 * the two of them disagreeing about bucket size does not average out — the coarser one collapses
 * three of the finer one's observations into a single bucket, and the member sees a third of the
 * beads that were actually recorded.
 *
 * That is precisely what shipped. The universe recorder correctly passed `universe` and stamped
 * 5s for all ~122 names; the SSE hub (vector-snapshot.ts) called this with NO scope argument, so
 * it defaulted to `live`, fell through to the oracle test, and stamped 15s for everything outside
 * {SPX, SPY, QQQ}. Measured on prod over one 77-minute window: SPX 614 samples at a 5s median
 * gap, NVDA 207 at 15s, TSLA/AMD 115 at 30s — against a recorder that had already captured every
 * one of those names at 5s. The data was being collected and then thrown away at write time.
 *
 * Hence the static-universe test below. A ticker the shared recorder covers HAS a 5s rail
 * already, so the live path must not re-stamp it coarsely. This adds no fetches and no recompute
 * — it changes only the bucket a sample the hub had already built gets filed under. The 15s
 * bucket survives for what it was actually meant for: a genuinely on-demand symbol nobody is
 * recording in the background, where the rail really is viewer-built.
 *
 * Deliberately the STATIC allowlist (sync) and not `listSharedUniverseTickers()` (async, Redis):
 * this runs on every SSE poll for every viewer, and an await here would put a Redis round-trip in
 * the hot path. Dynamic-universe names therefore still take the 15s branch — a narrower residual
 * gap, called out rather than papered over, and fixable later behind a cached membership set.
 */
/**
 * Static shared-universe membership, memoized.
 *
 * `vectorUniverseTickers()` builds a fresh array from a Set on every call, and this runs on every
 * SSE poll for every connected viewer — so the lookup is hoisted into a Set built once per
 * process. The list is a module-level constant, so there is nothing to invalidate.
 */
let staticUniverseSet: Set<string> | null = null;
function isStaticUniverseTicker(t: string): boolean {
  staticUniverseSet ??= new Set(vectorUniverseTickers());
  return staticUniverseSet.has(t);
}

export function wallTrailSampleSecForTicker(
  ticker?: string | null,
  scope: WallTrailSampleScope = "live"
): number {
  const envOverride =
    process.env.NEXT_PUBLIC_VECTOR_WALL_TRAIL_SAMPLE_SEC ??
    process.env.VECTOR_WALL_TRAIL_SAMPLE_SEC;
  if (envOverride != null) {
    const n = Number(envOverride);
    if (Number.isFinite(n) && n >= 5) return Math.floor(n);
  }
  if (scope === "universe") return UNIVERSE_WALL_TRAIL_SAMPLE_SEC;
  if (ticker) {
    const t = normalizeVectorTicker(ticker);
    if (VECTOR_ORACLE_TICKERS.has(t) || hasLiveGexStrikeExpiry(t)) {
      return ORACLE_WALL_TRAIL_SAMPLE_SEC;
    }
    // A ticker the background recorder already samples at 5s — its rail is a 5s rail no matter
    // which writer is appending to it this tick.
    if (isStaticUniverseTicker(t)) return UNIVERSE_WALL_TRAIL_SAMPLE_SEC;
  }
  return NON_UNIVERSE_WALL_TRAIL_SAMPLE_SEC;
}
