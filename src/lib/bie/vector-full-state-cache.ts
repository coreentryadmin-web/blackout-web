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
 * TTL for a cached snapshot. Chosen (like vector-universe's serve-stale) to comfortably outlive the
 * ~5-min RTH cron cadence so an entry never expires on the knife-edge between two runs; the
 * snapshot's own `asOf` discloses staleness to consumers. After the cron stops at the close, entries
 * age out within this window and off-hours reads fall back to a live compute (which self-warms).
 */
export const VECTOR_FULL_STATE_CACHE_TTL_SEC = 15 * 60;

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
