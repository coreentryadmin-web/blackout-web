import "server-only";

import { VECTOR_ORACLE_TICKERS, normalizeVectorTicker } from "./vector-ticker";
import { hasLiveGexStrikeExpiry } from "@/lib/ws/uw-socket";
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
 *  - `live` scope (SSE hub + active non-universe recorder): oracle / live WS → 5s; else 15s.
 * Env override wins for all tickers/scopes.
 */
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
  }
  return NON_UNIVERSE_WALL_TRAIL_SAMPLE_SEC;
}
