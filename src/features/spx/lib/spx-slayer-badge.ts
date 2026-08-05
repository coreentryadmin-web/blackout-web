/**
 * SPX Slayer → Night Hawk board badge (feat/nh-spx-badge).
 *
 * WHY: Night Hawk's only existing integration with SPX Slayer is a conflict veto (G-6,
 * src/lib/zerodte/gates.ts) — there was no DISPLAY integration, so a member watching the 0DTE
 * board had no visibility into what SPX Slayer's own engine was doing right now. This module adds
 * a strictly READ-ONLY snapshot of SPX Slayer's live play, shaped as a small display DTO for a
 * board badge/tile. It does NOT feed Night Hawk's candidate scoring, gates, governor, or any
 * trade-commit path — see src/lib/platform/zerodte-service.ts for the one place this is wired into
 * the board payload (additive field only, alongside market_state/discovery_funnel).
 *
 * Reads `getSpxPlaySnapshot()` (spx-play-engine.ts) — the mutate:false snapshot function that also
 * applies `applySpxPlayDisplayHysteresis` (the just-merged flicker fix), so this badge inherits that
 * stability for free: it will not swap SCANNING/WATCHING/BUY on a single noisy poll any more than the
 * member-facing SPX card does.
 *
 * Degradation: any failure building the desk/technicals/play snapshot (upstream outage, cold cache,
 * etc.) yields `unavailableSpxSlayerBadge()` — `available: false` with a human `unavailable_reason` —
 * never a thrown error that could take down the whole Night Hawk board response.
 *
 * The pure DTO + mapper (unit-testable without the engine's heavy/server-only import graph) live in
 * spx-slayer-badge-map.ts and are re-exported here unchanged.
 */
import { loadMergedSpxDesk } from "@/features/spx/lib/spx-desk-loader";
import { buildPlayTechnicals } from "@/features/spx/lib/spx-play-technicals";
import { getSpxPlaySnapshot } from "@/features/spx/lib/spx-play-engine";
import { playMemberReadCacheSec } from "@/features/spx/lib/spx-play-config";
import { todayEtYmd } from "@/lib/providers/spx-session";
import { withServerCache } from "@/lib/server-cache";
import {
  mapSpxPlayToBadge,
  unavailableSpxSlayerBadge,
  type SpxSlayerBadge,
} from "@/features/spx/lib/spx-slayer-badge-map";

export type { SpxSlayerBadge } from "@/features/spx/lib/spx-slayer-badge-map";
export { mapSpxPlayToBadge, unavailableSpxSlayerBadge } from "@/features/spx/lib/spx-slayer-badge-map";

async function buildSpxSlayerBadgeSnapshot(): Promise<SpxSlayerBadge> {
  try {
    const { merged } = await loadMergedSpxDesk();
    const technicals = await buildPlayTechnicals(merged.price, {
      vwap: merged.vwap,
      pdh: merged.pdh,
      pdl: merged.pdl,
      hod: merged.hod,
      lod: merged.lod,
    });
    // getSpxPlaySnapshot (NOT readSpxPlaySnapshot) — the mutate:false path wrapped with
    // applySpxPlayDisplayHysteresis, so this badge never flickers independently of the member
    // SPX card. This is a read: it opens no DB writes and fires no Discord notifications
    // (mutate:false plumbs straight through evaluateSpxPlay/evaluateOpenPlay's `if (mutate)` guards).
    const payload = await getSpxPlaySnapshot(merged, technicals);
    return mapSpxPlayToBadge(payload);
  } catch (err) {
    console.warn(
      "[spx-slayer-badge] snapshot build failed (degrading to unavailable):",
      err instanceof Error ? err.message : err
    );
    return unavailableSpxSlayerBadge("SPX Slayer desk unavailable — retrying");
  }
}

/** Cached read-only snapshot for the Night Hawk board — same cache cadence as the member SPX card
 *  (SPX_PLAY_MEMBER_READ_CACHE_SEC) so the badge never triggers extra upstream load on the board's
 *  faster ~1s poll; `loadMergedSpxDesk`/`getSpxPlayState` already independently cache the desk fetch
 *  itself, so a concurrent cache miss here is at worst a redundant (cheap, cache-hit) desk read, not
 *  a duplicate upstream call. */
export async function getSpxSlayerBadgeSnapshot(): Promise<SpxSlayerBadge> {
  const date = todayEtYmd();
  const ttlMs = playMemberReadCacheSec() * 1000;
  return withServerCache(`spx-slayer-badge:${date}`, ttlMs, buildSpxSlayerBadgeSnapshot);
}
