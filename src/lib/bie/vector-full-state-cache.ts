// Redis snapshot cache for the Vector full-state — the "non-stop feed" read path.
//
// Side-effect-free (NO `import "server-only"`) so the key builder + round-trip are unit-testable
// under `tsx --test`; the type import of VectorFullState is erased at build time, so importing this
// never loads the server-only vector-full-state.ts graph.
//
// The continuous-ingestion cron (api/cron/vector-full-state-snapshot) writes a snapshot per
// (ticker, horizon) every RTH tick; readers (fetchVectorFullState, get_ecosystem_context, the
// get_vector_full_state Largo tool, composeVectorRead) read cache-first and only compute live on a
// miss — so BIE serves the current Vector state instantly without a per-query fan-out.

import { sharedCacheGet, sharedCacheSet } from "@/lib/shared-cache";
import { normalizeVectorTicker } from "@/features/vector/lib/vector-ticker";
import type { VectorDteHorizon } from "@/features/vector/lib/vector-dte-horizon";
import type { VectorFullState } from "@/lib/bie/vector-full-state";

/**
 * TTL for a cached snapshot.
 *
 * WAS 15 min, on the assumption (stated here verbatim until 2026-10-08) that this "comfortably
 * outlives the ~5-min RTH cron cadence so an entry never expires on the knife-edge between two
 * runs." That assumed every ticker gets refreshed roughly every cron tick. It does not.
 *
 * MEASURED LIVE 2026-10-08 (Ask Largo standing mandate, CloudWatch `/ecs/blackout-production`),
 * AFTER `rotateTickersForWarmPass` (the same-day starvation fix — see
 * `vector-full-state-warm-universe.ts` / FINDINGS.md 2026-10-08) had already shipped and was
 * confirmed advancing the cursor run over run:
 *
 *   tickers=64 horizons=4 cursor=36 attempted=2 written=8 ... budgetHit=true elapsed=51050ms
 *   tickers=64 horizons=4 cursor=34 attempted=2 written=8 ... budgetHit=true elapsed=74664ms
 *   tickers=64 horizons=4 cursor=32 attempted=2 written=8 ... budgetHit=true elapsed=117676ms
 *
 * Each ~5-min run only completes ONE `TICKER_CONCURRENCY=2` batch before `TIME_BUDGET_MS` (50s) is
 * blown by the per-ticker chain-fetch cost (out of scope here — see the rotation fix's own "what
 * this does NOT fix"). So a full rotation lap over a 64-ticker universe takes ~64/2 * 5min = 160
 * minutes — ~11x the old 15-min TTL. An entry is therefore warm for ~15 of every ~160 minutes
 * (≈90% cold), for EVERY ticker, not only the ones the old fixed-iteration-order bug starved
 * outright. Reproduced as a 100% failure rate on Ask Largo's `GET /api/market/swing/play-brief`:
 * `ecosystem context` and `Vector state` both hard-timing out at the brief's own 8s
 * `BRIEF_SOURCE_TIMEOUT_MS` on 9/9 sampled tickers across two separate hours — including real
 * open-capital swing positions (MSFT, NRG, CIEN) the rotation fix explicitly exists to protect.
 *
 * Raising the TTL is safe because staleness disclosure does NOT depend on it:
 * `describeVectorFreshness` (vector-state-freshness.ts) derives `freshness`/`age_seconds` purely
 * from the snapshot's own `observed_at` vs real read time, so a longer-lived entry is never
 * misrepresented as live — anything older than 10 minutes is still correctly labeled "stale" with
 * an honest age (Largo C2). This TTL only controls whether Redis still HAS an entry to label; a
 * value shorter than the real rotation lap just deletes usable (if stale) evidence before serving
 * it at all, trading an honestly-labeled stale read for a hard, evidence-free "fetch failed" — a
 * strictly worse outcome for the member. 4h clears the measured ~160-min lap with real margin for
 * a slower day (lower throughput, heavier rate-limiter contention) while still being comfortably
 * inside one RTH session, so an entry still naturally ages out by the next trading day.
 *
 * Ratcheted by a test in vector-full-state-cache.test.ts: TTL must exceed one full rotation lap at
 * the measured 64-ticker / 2-per-cycle / 5-min-cycle throughput, so this can't silently regress
 * back to a value shorter than the cron can actually cover.
 */
export const VECTOR_FULL_STATE_CACHE_TTL_SEC = 4 * 60 * 60;

/**
 * Payload-shape version. BUMP THIS whenever the MEANING of a field in `VectorFullState` changes
 * (units, scale, precision) rather than just its value.
 *
 * WHY: entries live for `VECTOR_FULL_STATE_CACHE_TTL_SEC` (15 min) and readers are cache-FIRST, so
 * for that long after a deploy the new code serves snapshots written by the OLD code. That is
 * harmless when only values changed, and a silent correctness hole when a unit changed — v2 exists
 * because `magnet.distancePct` moved from a fraction to a PERCENT (2026-08-21), and a v1 entry
 * would have fed Largo a magnet distance 100x too small with nothing in the payload to reveal it.
 * A new key namespace makes the old entries unreachable instead of unreadable-but-served.
 *
 * v3 (2026-08-21) adds `asOfEt` / `sessionDate` — the ET session anchor beside `asOf`. That is an
 * ADDITIVE field rather than a unit change, so it would have been tempting to leave the key alone;
 * the reason not to is that a v2 entry served under v3 code carries `undefined` for both, and the
 * anchor then appears on some reads and vanishes on others for the 15 minutes after a deploy with
 * nothing in the payload to say why. An anchor that is sometimes absent is the silent-degradation
 * failure this file's versioning exists to prevent, so the rule is really "bump when the payload's
 * CONTRACT changes", of which a unit change is one case.
 */
const VECTOR_FULL_STATE_CACHE_VERSION = "v3";

/** `vector:full-state:v3:{normalizedTicker}:{horizon}` — one snapshot per ticker+horizon. */
export function vectorFullStateCacheKey(ticker: string, horizon: VectorDteHorizon): string {
  return `vector:full-state:${VECTOR_FULL_STATE_CACHE_VERSION}:${normalizeVectorTicker(ticker)}:${horizon}`;
}

/** Read the cached snapshot, or null on miss / any cache error (never throws). */
export async function readVectorFullStateCache(
  ticker: string,
  horizon: VectorDteHorizon
): Promise<VectorFullState | null> {
  try {
    return await sharedCacheGet<VectorFullState>(vectorFullStateCacheKey(ticker, horizon));
  } catch {
    return null;
  }
}

/** Write a snapshot to the cache (best-effort; a cache write must never fail the caller). */
export async function writeVectorFullStateCache(
  ticker: string,
  horizon: VectorDteHorizon,
  state: VectorFullState
): Promise<void> {
  try {
    await sharedCacheSet(vectorFullStateCacheKey(ticker, horizon), state, VECTOR_FULL_STATE_CACHE_TTL_SEC);
  } catch {
    /* best-effort warm — a cache write failure is not a caller failure */
  }
}
