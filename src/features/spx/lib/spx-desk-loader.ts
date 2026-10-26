import {
  deskBootstrapMaxBlockMs,
  deskCacheTtlMs,
  deskFlowCacheTtlMs,
  deskPeekMaxAgeSec,
  deskPulseCacheTtlMs,
  deskPulseMaxBlockMs,
} from "@/lib/providers/config";
import {
  buildSpxDesk,
  buildSpxDeskFlow,
  buildSpxDeskPulse,
  buildSpxDeskPulseMinimal,
  deskShellFromPulse,
} from "@/features/spx/lib/spx-desk";
import type { SpxDeskFlow, SpxDeskPayload, SpxDeskPulse } from "@/features/spx/lib/spx-desk";
import { mergeDeskLayers } from "@/features/spx/lib/spx-desk-merge";
import { observeSpxDeskVoiceTransitions } from "@/features/spx/lib/spx-voice-feed-store";
// Type-only import — erased at compile. The runtime builder is loaded lazily inside
// loadSpxPinForecast() so that importing this loader does NOT eagerly pull spx-pin.ts's
// server-only chain dependency into non-server-condition contexts (e.g. the mocked unit
// tests for this file, which stub ./spx-desk but not the reconstruct chain loader).
import type { SpxPinForecast } from "@/features/spx/lib/spx-pin";
import { withServerCache, peekServerCache } from "@/lib/server-cache";
import { todayEtYmd } from "@/lib/providers/spx-session";

export type MergedSpxDeskBundle = {
  desk: SpxDeskPayload;
  flow: SpxDeskFlow | null;
  pulse: SpxDeskPulse | null;
  merged: SpxDeskPayload;
};

const pulseCacheOpts = {
  staleWhileRevalidate: true as const,
  staleOnInflight: true,
  maxBlockMs: deskPulseMaxBlockMs(),
  fallback: buildSpxDeskPulseMinimal,
};

const deskCacheOpts = {
  staleWhileRevalidate: true as const,
  staleOnInflight: true,
  maxBlockMs: deskBootstrapMaxBlockMs(),
  fallback: async () => deskShellFromPulse(await loadSpxDeskPulse()),
};

const flowCacheOpts = {
  staleWhileRevalidate: true as const,
  staleOnInflight: true,
  maxBlockMs: deskBootstrapMaxBlockMs(),
  fallback: async (): Promise<SpxDeskFlow> => {
    const pulse = await loadSpxDeskPulse();
    return {
      available: false,
      polled_at: pulse.polled_at,
      price: pulse.price,
      dark_pool: null,
      spx_flows: [],
      unified_tape: [],
      gex_walls: [],
      gex_net: null,
      gex_king: null,
      gamma_flip: null,
      above_gamma_flip: false,
      gamma_regime: "unknown",
      flow_0dte_call_premium: null,
      flow_0dte_put_premium: null,
      flow_0dte_net: null,
      strike_stacks: [],
      net_prem_ticks: [],
      flow_by_expiry: [],
      net_flow_by_expiry: [],
      greek_exposure: null,
    };
  },
};

/**
 * THE single cache lane for buildSpxDesk() — every consumer (this loader, the standalone
 * /api/market/spx/desk route) must call this function rather than invoking
 * withServerCache/buildSpxDesk directly, so there is exactly ONE cached desk snapshot per
 * session date across the whole app.
 *
 * Previously the standalone route cached buildSpxDesk() under a bare "spx-desk" key while
 * this loader used "spx-desk:${date}" — two independently-expiring 10s-TTL lanes racing a
 * live WS tide store. That let the member dashboard and the trade-alert panel disagree on
 * trade direction within the same refresh cycle: confirmed live (2026-07-01 14:19 UTC) as
 * identical VWAP/gamma-flip inputs but a different tide read 28 seconds apart — a member
 * could see a bullish header next to a short trade call on the same page. Never re-introduce
 * a second cache key for this builder; route every consumer through this function instead.
 */
export async function loadSpxDesk(): Promise<SpxDeskPayload> {
  // ISSUE-25: Include session date in the cache key so a process running across midnight
  // serves fresh data on the new session rather than stale prior-day data.
  const date = todayEtYmd();
  // SWR: return last good snapshot immediately while the background refresh runs.
  // Prevents a cold Massive chain fetch (20s+) from blocking play/desk polling.
  return withServerCache(`spx-desk:${date}`, deskCacheTtlMs(), buildSpxDesk, deskCacheOpts);
}

/**
 * Instant desk read — Redis/L1 only, never invokes buildSpxDesk.
 *
 * BUG FIX (found live 2026-10-26, Ask Largo/5-engine standing mandate): previously called
 * `peekServerCache` with no staleness override, so it fell back to the generic 10-minute
 * `MAX_STALE_AGE_MS` ceiling — far looser than this key's real ~10s refresh cadence
 * (`deskCacheTtlMs()`) or the 90s "Desk data stale" play-gate (`playGexStaleMaxSec()`,
 * spx-play-gates.ts) that reads whatever desk snapshot this peek hands back. A replica whose
 * local copy (and Redis's own short-TTL copy) had both gone cold was free to keep serving an
 * up-to-10-minute-old snapshot while a fresher sibling replica served a current one — the
 * cross-replica divergence `deskPeekMaxAgeSec()`'s own doc comment traces in full. Passing it
 * here makes a materially-behind replica self-invalidate (return null) so the route's own
 * `loadSpxDesk()` fallback (already maxBlockMs-bounded) does a real, bounded refresh instead.
 */
export async function peekSpxDesk(): Promise<SpxDeskPayload | null> {
  const date = todayEtYmd();
  return peekServerCache<SpxDeskPayload>(`spx-desk:${date}`, { maxStaleMs: deskPeekMaxAgeSec() * 1000 });
}

/**
 * THE single cache lane for buildSpxDeskPulse() — same contract as loadSpxDesk().
 * Standalone /api/market/spx/pulse must call this, not withServerCache directly.
 */
export async function loadSpxDeskPulse(): Promise<SpxDeskPulse> {
  const date = todayEtYmd();
  return withServerCache(
    `spx-desk-pulse:${date}`,
    deskPulseCacheTtlMs(),
    buildSpxDeskPulse,
    pulseCacheOpts
  );
}

/**
 * THE single cache lane for buildSpxDeskFlow() — same contract as loadSpxDesk().
 * Standalone /api/market/spx/flow must call this, not withServerCache directly.
 */
export async function loadSpxDeskFlow(): Promise<SpxDeskFlow> {
  const date = todayEtYmd();
  return withServerCache(`spx-desk-flow:${date}`, deskFlowCacheTtlMs(), buildSpxDeskFlow, flowCacheOpts);
}

/**
 * THE single cache lane for the EOD Pin Forecaster — 5s TTL (reuses the pulse TTL), session-keyed.
 * Standalone /api/market/spx/pin must call this. buildSpxPinForecast is lazy-imported at call
 * time (not at module load) so the server-only chain dependency only resolves when the forecast
 * is actually requested — and never leaks into this loader's mocked unit tests.
 */
export async function loadSpxPinForecast(): Promise<SpxPinForecast> {
  const date = todayEtYmd();
  const { buildSpxPinForecast } = await import("@/features/spx/lib/spx-pin");
  return withServerCache(`spx-pin:${date}`, deskPulseCacheTtlMs(), buildSpxPinForecast, {
    staleWhileRevalidate: true,
  });
}

/** Single server path: cache lanes → merge pulse + flow into desk. */
async function loadMergedSpxDeskCore(): Promise<MergedSpxDeskBundle> {
  const [desk, flow, pulse] = await Promise.all([
    loadSpxDesk(),
    loadSpxDeskFlow(),
    loadSpxDeskPulse(),
  ]);

  const merged = mergeDeskLayers(desk, flow, pulse);
  return { desk, flow, pulse, merged };
}

/** Cached merged desk — same fast-lane contract as bootstrap (never block 15s+ on cold desk). */
export async function loadMergedSpxDesk(): Promise<MergedSpxDeskBundle> {
  const date = todayEtYmd();
  const bundle = await withServerCache(`spx-merged:${date}`, deskCacheTtlMs(), loadMergedSpxDeskCore, {
    staleWhileRevalidate: true,
    staleOnInflight: true,
    maxBlockMs: deskBootstrapMaxBlockMs(),
    fallback: buildBootstrapFastLane,
  });
  void observeSpxDeskVoiceTransitions(bundle.merged, date).catch(() => {});
  return bundle;
}

/**
 * Instant merged-desk read — Redis/L1 only, never invokes loadMergedSpxDeskCore. Same contract
 * as peekSpxDesk() above, mirrored for the merged bundle.
 *
 * Used by evaluateSpxPlayState() (spx-service.ts) to answer "is the market closed right now"
 * without paying loadMergedSpxDesk()'s own cold-cache cost (up to deskBootstrapMaxBlockMs(),
 * 3s default) — a cost that, measured live 2026-10-18, reliably exceeds the OUTER
 * playMemberReadMaxBlockMs() budget (800ms) wrapping the whole SPX-play read on a cold desk
 * cache, causing every closed-market/off-hours member read to time out before the 2026-10-17
 * closed-market fast path (which depends on `merged` already being loaded) is ever reached. A
 * generous EXPLICIT maxStaleMs override (vs the tightened `deskPeekMaxAgeSec()` default below) is
 * deliberate and safe ONLY for this specific caller's closed-market use: once the market is
 * genuinely closed, "stale" and "correct" are the same thing (nothing changes), so a Friday-close
 * snapshot read on a quiet Sunday is accurate, not wrong. The caller is still responsible for
 * never trusting this peek during/near real trading hours (see spx-service.ts's own
 * isSpxEngineCronWindow guard) — this function makes no such guarantee on its own.
 *
 * BUG FIX (found live 2026-10-26, Ask Largo/5-engine standing mandate): when called with NO
 * `opts.maxStaleMs` (every caller except spx-service.ts's deliberate 24h off-hours override
 * above), this fell back to the generic 10-minute `MAX_STALE_AGE_MS` — the same cross-replica
 * divergence gap `peekSpxDesk()`'s own fix (and `deskPeekMaxAgeSec()`'s doc comment) describes in
 * full, just for the merged bundle. An explicit `opts.maxStaleMs` (the 24h closed-market case)
 * still wins unchanged; only the DEFAULT tightens.
 */
export async function peekMergedSpxDesk(opts?: { maxStaleMs?: number }): Promise<MergedSpxDeskBundle | null> {
  const date = todayEtYmd();
  return peekServerCache<MergedSpxDeskBundle>(`spx-merged:${date}`, {
    maxStaleMs: opts?.maxStaleMs ?? deskPeekMaxAgeSec() * 1000,
  });
}

async function buildMergedBundle(): Promise<MergedSpxDeskBundle> {
  return loadMergedSpxDesk();
}

/** Pulse-first partial bundle when the full desk rebuild exceeds the bootstrap cap. */
async function buildBootstrapFastLane(): Promise<MergedSpxDeskBundle> {
  const pulse = await loadSpxDeskPulse();
  const desk = deskShellFromPulse(pulse);
  const flow: SpxDeskFlow = {
    available: false,
    polled_at: pulse.polled_at,
    price: pulse.price,
    dark_pool: null,
    spx_flows: [],
    unified_tape: [],
    gex_walls: [],
    gex_net: null,
    gex_king: null,
    gamma_flip: null,
    above_gamma_flip: false,
    gamma_regime: "unknown",
    flow_0dte_call_premium: null,
    flow_0dte_put_premium: null,
    flow_0dte_net: null,
    strike_stacks: [],
    net_prem_ticks: [],
    flow_by_expiry: [],
    net_flow_by_expiry: [],
    greek_exposure: null,
  };
  const merged = mergeDeskLayers(desk, flow, pulse);
  return { desk, flow, pulse, merged };
}

/**
 * One Redis key for GET /api/market/spx/bootstrap — single round-trip on warm cache
 * instead of three separate lane reads + merge on every dashboard load.
 */
export async function loadBootstrapBundle(): Promise<MergedSpxDeskBundle> {
  const date = todayEtYmd();
  return withServerCache(`spx-bootstrap:${date}`, deskCacheTtlMs(), buildMergedBundle, {
    staleWhileRevalidate: true,
    staleOnInflight: true,
    maxBlockMs: deskBootstrapMaxBlockMs(),
    fallback: buildBootstrapFastLane,
  });
}
