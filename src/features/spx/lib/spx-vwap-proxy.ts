import {
  mergeVolumeIntoBars,
  sessionStatsFromMinuteBars,
} from "@/lib/providers/spx-session";

/**
 * SPX session VWAP with the SPY-minute-volume proxy.
 *
 * Lives in its own module — no `server-only` import and no provider import at module scope — so the
 * resolution logic is unit-testable in isolation, the same reason `spx-desk-numerics.ts` exists.
 * The real SPY fetcher is injected by `spx-desk.ts`.
 *
 * WHY THIS EXISTS AT ALL. SPX index minute bars carry no volume (ISSUE-16), so on the raw bars the
 * desk "VWAP" is an equal-weight typical-price mean and `vwap_volume_weighted` is false. SPY 1m
 * share volume is the standard index proxy — the Vector chart already weights with it — and
 * `mergeVolumeIntoBars` only fills bars whose volume is absent, so a bar carrying real volume is
 * never overwritten.
 *
 * WHY IT CHANGED. The merge was gated on `isStagingDeploy()`, which tests NEXT_PUBLIC_SITE_URL for
 * "staging.". Staging was decommissioned 2026-07-25, so that gate has been permanently false in
 * every environment that exists and the merge never ran anywhere. That left
 * `vwap_volume_weighted` permanently false in production, which trips both
 * `evaluatePlaybookDataSatisfaction`'s `volumeWeightedVwap` requirement and
 * `volumeWeightedVwapBlock` in the shadow matcher — so PB-01 (VWAP Reclaim) and PB-02 (VWAP
 * Reject) could never match. With `PLAYBOOK_LIVE_GATE=1` in production a BUY requires a matched
 * primary playbook, so those two setups were not degraded but silent: every entry they would have
 * produced was simply not taken, with no gate reason recorded anywhere a member or Largo could
 * read. See `docs/spx/SLAYER-MAP.md` §7.1.
 */

type AggBar = Parameters<typeof sessionStatsFromMinuteBars>[0][number];
type SessionStats = ReturnType<typeof sessionStatsFromMinuteBars>;

/** Where the VWAP weights came from. `null` means the VWAP is not volume-weighted at all. */
export type VwapVolumeSource = "native" | "spy_proxy" | null;

export type SessionStatsWithSource = SessionStats & {
  vwap_volume_source: VwapVolumeSource;
};

/**
 * Cache TTLs. This resolver runs on the 30s desk lane AND inside `refreshPulseStructureCore`
 * (a 5s cache), so an uncached call would mean ~12 full-day SPY minute fetches per minute per
 * replica — real provider load on a shared rate budget, for a map that changes by one bar a minute.
 */
export const SPY_VOLUME_CACHE_MS = 60_000;
/**
 * An EMPTY result is cached too, briefly. `fetchSpyVolumeByMinute` retries twice with a 350ms sleep
 * before giving up, so without this a provider outage would add ~700ms of dead latency to every
 * desk and pulse-structure rebuild rather than degrading quietly to the typical-price fallback.
 */
export const SPY_VOLUME_EMPTY_CACHE_MS = 15_000;

type Cache = { ymd: string; fetchedAt: number; map: Map<number, number> };
let cache: Cache | null = null;

/** Reset the module-level cache. Test seam only. */
export function __resetSpyVolumeCache(): void {
  cache = null;
}

export type VwapProxyDeps = {
  /** Session-day SPY minute volume, keyed by bar epoch SECONDS. */
  fetchSpyVolume: (ymd: string) => Promise<Map<number, number>>;
  /** Whether the proxy is enabled at all (env-reversible without a deploy). */
  enabled: boolean;
  now?: () => number;
};

async function spyVolumeForSession(
  ymd: string,
  deps: VwapProxyDeps
): Promise<Map<number, number>> {
  const now = (deps.now ?? Date.now)();
  if (cache && cache.ymd === ymd) {
    const ttl = cache.map.size ? SPY_VOLUME_CACHE_MS : SPY_VOLUME_EMPTY_CACHE_MS;
    if (now - cache.fetchedAt < ttl) return cache.map;
  }
  let map: Map<number, number>;
  try {
    map = await deps.fetchSpyVolume(ymd);
  } catch {
    // A provider failure degrades to the typical-price fallback; it must never throw out of the
    // desk build, and it must not be retried on the very next rebuild seconds later.
    map = new Map();
  }
  cache = { ymd, fetchedAt: now, map };
  return map;
}

/**
 * Resolve session stats, weighting the VWAP by SPY volume when SPX's own bars carry none.
 *
 * Fails closed on the LABEL in every branch: `vwap_volume_source` is only ever `"spy_proxy"` when
 * the merge actually attached volume and the resulting stats really are volume-weighted. A VWAP
 * that is not volume-weighted reports `null` rather than a source it did not use — the same
 * discipline that keeps `vwap_volume_weighted: true` from silently claiming SPX volume that does
 * not exist (ISSUE-16).
 */
export async function resolveSessionVwap(
  minuteBars: AggBar[],
  ymd: string,
  deps: VwapProxyDeps
): Promise<SessionStatsWithSource> {
  const native = sessionStatsFromMinuteBars(minuteBars);
  // The bars carried their own volume — the weights are genuinely SPX's, nothing to proxy.
  if (native.vwap_volume_weighted) return { ...native, vwap_volume_source: "native" };
  if (!deps.enabled) return { ...native, vwap_volume_source: null };

  const volumeByBarSec = await spyVolumeForSession(ymd, deps);
  if (!volumeByBarSec.size) return { ...native, vwap_volume_source: null };

  const merged = sessionStatsFromMinuteBars(mergeVolumeIntoBars(minuteBars, volumeByBarSec));
  return {
    ...merged,
    vwap_volume_source: merged.vwap_volume_weighted ? "spy_proxy" : null,
  };
}
