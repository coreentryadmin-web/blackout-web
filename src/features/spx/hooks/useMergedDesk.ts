"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import useSWR, { useSWRConfig } from "swr";
import { fetchSpxDesk, fetchSpxDeskFlow, fetchSpxDeskPulse, fetchSpxBootstrap } from "@/lib/api";
import { mergeDeskLayers, mergePulseIntoDesk, resetSpxDeskMergeCache } from "@/features/spx/lib/spx-desk-merge";
import type { SpxDeskPayload } from "@/features/spx/lib/spx-desk";
import { readSessionCache, writeSessionCache } from "@/lib/session-cache";
import { todayEtYmd } from "@/lib/providers/spx-session";
import { usePulseStream } from "@/hooks/usePulseStream";
import { isClientDeskSessionOpen, isDeskSessionLiveFromPulse, resolveDeskLive, resolveDeskSessionActive, shouldDiscardStaleClosedDeskCache } from "@/features/spx/lib/spx-desk-session-client";
import {
  SPX_FLOW_POLL_MS,
  SPX_FULL_DESK_POLL_MS,
  SPX_PULSE_REST_POLL_MS,
  SPX_PULSE_REST_SSE_POLL_MS,
} from "@/features/spx/lib/spx-desk-poll-ms";

const PULSE_REST_MS = SPX_PULSE_REST_POLL_MS;
const PULSE_REST_SSE_MS = SPX_PULSE_REST_SSE_POLL_MS;
const FLOW_MS = SPX_FLOW_POLL_MS;
const FULL_DESK_MS = SPX_FULL_DESK_POLL_MS;
const DESK_CACHE_KEY = "spx-merged-desk";
/** Keep cached desk for the trading day across refresh/navigation. */
const DESK_CACHE_MAX_AGE_MS = 12 * 60 * 60 * 1000;
/**
 * Throttle the sessionStorage write of the merged desk. The desk re-merges on
 * every pulse tick (~1s); persisting that hot a stream to sessionStorage on each
 * change is wasteful (JSON.stringify of the full payload + a synchronous storage
 * write). 7.5s keeps a fresh-enough snapshot for refresh/navigation restore while
 * staying well under the pulse cadence. The latest value is always flushed on
 * visibilitychange/unmount, so throttling never loses the final state.
 */
const DESK_CACHE_WRITE_MS = 7_500;

const swrLiveOpts = {
  refreshWhenHidden: false,
  refreshWhenOffline: false,
  revalidateOnFocus: false,
  revalidateOnReconnect: true,
  keepPreviousData: true,
};


export function useMergedDesk() {
  const { mutate } = useSWRConfig();
  const sessionDateRef = useRef(todayEtYmd());
  // MUST start undefined — never read sessionStorage synchronously here. This ref decides
  // which of two structurally different trees SpxDashboard renders (deskLoading's skeleton
  // vs. the full desk), and readSessionCache() returns undefined on the server (no `window`)
  // but a real cached desk on the client's very first paint whenever the member reloaded (or
  // reopened the tab) mid-session — writeSessionCache runs every ~7.5s while the desk is
  // live, so any refresh during/shortly after RTH hits this. That divergence on the render
  // React uses for hydration reconciliation is a guaranteed React #418 crash, not a
  // possible one. Confirmed live 2026-09-01: /dashboard was the single most crash-prone
  // route in production telemetry (30 #418s over 5 days, 100% /dashboard, clustered on
  // trading-hours reloads, not deploy windows) — see
  // docs/audit/findings-staging/2026-09-01-spx-dashboard-hydration-crash-session-cache.md.
  // Hydrating from cache is still done — just one tick later, via the effect below, which is
  // a normal post-mount re-render (React is free to change the DOM there) rather than part
  // of hydration.
  const deskStable = useRef<SpxDeskPayload | undefined>(undefined);
  const [cacheHydrated, setCacheHydrated] = useState(false);
  const [pulseSseConnected, setPulseSseConnected] = useState(false);
  const [etSessionOpen, setEtSessionOpen] = useState(true);
  // Initialized becomes true after the first pulse or REST response arrives.
  // Prevents sessionActive from returning true before any data is loaded.
  const [initialized, setInitialized] = useState(false);
  const onPulseConnection = useCallback((connected: boolean) => {
    setPulseSseConnected(connected);
  }, []);

  // Populate deskStable from sessionStorage post-mount (see the ref's own comment above for
  // why this can't happen during the initial render). Declared first among this hook's
  // effects so it runs before the "discard stale cache" effect below on the same mount.
  useEffect(() => {
    const cached = readSessionCache<SpxDeskPayload>(DESK_CACHE_KEY, DESK_CACHE_MAX_AGE_MS);
    if (cached) {
      deskStable.current = cached;
      setCacheHydrated(true);
    }
  }, []);

  // ET session clock — prevents a post-close sessionStorage snapshot from pinning OFFLINE
  // during RTH when REST pulse is slow and SSE only overlays price (no market_open).
  useEffect(() => {
    const tick = () => setEtSessionOpen(isClientDeskSessionOpen());
    tick();
    const id = setInterval(tick, 60_000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (!shouldDiscardStaleClosedDeskCache(deskStable.current, etSessionOpen)) return;
    deskStable.current = undefined;
  }, [etSessionOpen]);

  // One bootstrap round-trip first — avoid 4 parallel cold lane XHRs on every dashboard load.
  const { data: bootstrap, isLoading: bootstrapLoading } = useSWR(
    "spx-desk-bootstrap",
    fetchSpxBootstrap,
    {
      ...swrLiveOpts,
      revalidateOnFocus: false,
      dedupingInterval: 8_000,
      onSuccess: (data) => {
        if (data.pulse) void mutate("spx-desk-pulse", data.pulse, { revalidate: false });
        if (data.flow) void mutate("spx-desk-flow", data.flow, { revalidate: false });
        if (data.desk) void mutate("spx-desk-full", data.desk, { revalidate: false });
        if (data.gexHeatmap && data.gexHeatmap.strikes?.length && data.gexHeatmap.spot > 0) {
          void mutate(
            "/api/market/gex-heatmap?ticker=SPX",
            {
              available: true,
              ...data.gexHeatmap,
            },
            { revalidate: false }
          );
        }
      },
    }
  );

  const bootstrapSettled = !bootstrapLoading;
  const bootstrapSeeded = Boolean(bootstrap);
  // Pulse is the fast lane (~50–200ms) — never wait on bootstrap or desk rebuild.
  const heavyLanesActive = bootstrapSettled;

  const { data: pulseRest, isValidating: pulseValidating } = useSWR(
    bootstrapLoading ? null : "spx-desk-pulse",
    fetchSpxDeskPulse,
    {
      ...swrLiveOpts,
      revalidateOnMount: !bootstrapSeeded,
      refreshInterval: (latest) => {
        if (!isDeskSessionLiveFromPulse(latest) && !isClientDeskSessionOpen()) return 0;
        return pulseSseConnected ? PULSE_REST_SSE_MS : PULSE_REST_MS;
      },
      dedupingInterval: 800,
      focusThrottleInterval: PULSE_REST_MS,
      onError: () => {
        /* REST pulse can fail transiently — ET session gate keeps RTH polling alive. */
      },
    }
  );

  const { pulse } = usePulseStream(pulseRest, onPulseConnection);

  // Midnight rollover: fires when pulse ticks AND every 60s as a safety net
  // (handles the case where pulse goes offline overnight).
  useEffect(() => {
    const today = todayEtYmd();
    if (sessionDateRef.current === today) return;
    sessionDateRef.current = today;
    resetSpxDeskMergeCache();
    deskStable.current = undefined;
  }, [pulse?.polled_at, pulseRest?.polled_at]);

  useEffect(() => {
    const id = setInterval(() => {
      const today = todayEtYmd();
      if (sessionDateRef.current !== today) {
        sessionDateRef.current = today;
        resetSpxDeskMergeCache();
        deskStable.current = undefined;
      }
    }, 60_000);
    return () => clearInterval(id);
  }, []);

  // Mark initialized after first data arrives so sessionActive is not
  // prematurely true during off-hours before any response lands.
  useEffect(() => {
    if (!initialized && (pulse != null || pulseRest != null)) {
      setInitialized(true);
    }
  }, [initialized, pulse, pulseRest]);

  const sessionActive = resolveDeskSessionActive({
    initialized,
    pulse,
    deskStable: deskStable.current,
    etSessionOpen,
  });

  const {
    data: desk,
    error: deskFetchError,
    isLoading: deskLoading,
    isValidating: deskValidating,
  } = useSWR(heavyLanesActive ? "spx-desk-full" : null, fetchSpxDesk, {
    ...swrLiveOpts,
    revalidateOnMount: !bootstrapSeeded,
    refreshInterval: sessionActive ? FULL_DESK_MS : 0,
    dedupingInterval: FULL_DESK_MS - 500,
    focusThrottleInterval: FULL_DESK_MS,
  });

  const { data: flow, isValidating: flowValidating } = useSWR(
    heavyLanesActive ? "spx-desk-flow" : null,
    fetchSpxDeskFlow,
    {
      ...swrLiveOpts,
      revalidateOnMount: !bootstrapSeeded,
      refreshInterval: sessionActive ? FLOW_MS : 0,
      dedupingInterval: 1_500,
      focusThrottleInterval: FLOW_MS,
    }
  );

  // PURE: derive the merged desk only. No ref mutation, no sessionStorage write
  // here — those are commit-phase side effects handled by the effect below.
  // Reading deskStable.current as the fallback base is safe: it holds the prior
  // committed value and the effect updates it only after this render commits.
  const merged = useMemo((): SpxDeskPayload | undefined => {
    let out: SpxDeskPayload | undefined;

    if (desk) {
      try {
        out = mergeDeskLayers(desk, flow, pulse);
      } catch {
        out = desk;
      }
    } else if (deskStable.current) {
      out = deskStable.current;
      if (pulse?.available) {
        try {
          out = mergePulseIntoDesk(out, pulse);
        } catch {
          // keep cached desk
        }
      } else if (pulse) {
        out = {
          ...out,
          market_open: pulse.market_open,
          market_status: pulse.market_status,
          market_label: pulse.market_label,
          polled_at: pulse.polled_at,
        };
      }
    }

    if (out && etSessionOpen && !isDeskSessionLiveFromPulse(out) && (out.price ?? 0) > 0) {
      out = {
        ...out,
        market_open: true,
        market_status: pulse?.market_status ?? "open",
        market_label: pulse?.market_label ?? "RTH OPEN",
      };
    }

    return out;
    // cacheHydrated is read only to force this memo to recompute once deskStable.current is
    // populated post-mount (see that effect above) — the memo body reads the ref directly,
    // which React does not track, so the dependency has to be named explicitly even though
    // eslint's static analysis can't see why it's needed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [desk, flow, pulse, etSessionOpen, cacheHydrated]);

  // Side effects for the merged desk, in commit phase:
  //  1. deskStable.current is updated on EVERY change (unthrottled) — sessionActive
  //     and the merge fallback above read it, so it must stay current.
  //  2. The sessionStorage write is throttled to DESK_CACHE_WRITE_MS to avoid a
  //     storage write on every ~1s pulse tick.
  const lastDeskWriteRef = useRef(0);
  const pendingDeskRef = useRef<SpxDeskPayload | undefined>(undefined);
  useEffect(() => {
    if (!merged) return;
    deskStable.current = merged;
    pendingDeskRef.current = merged;
    const now = Date.now();
    if (now - lastDeskWriteRef.current >= DESK_CACHE_WRITE_MS) {
      lastDeskWriteRef.current = now;
      pendingDeskRef.current = undefined;
      writeSessionCache(DESK_CACHE_KEY, merged);
    }
  }, [merged]);

  // Flush the latest desk to sessionStorage on tab-hide and unmount so a
  // throttled-but-not-yet-written snapshot is never lost across navigation/refresh.
  useEffect(() => {
    const flush = () => {
      const pending = pendingDeskRef.current;
      if (!pending) return;
      pendingDeskRef.current = undefined;
      lastDeskWriteRef.current = Date.now();
      writeSessionCache(DESK_CACHE_KEY, pending);
    };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") flush();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      flush();
    };
  }, []);

  const live = resolveDeskLive({ sessionActive, merged, etSessionOpen });

  const refreshing =
    sessionActive &&
    Boolean(merged) &&
    ((deskValidating && Boolean(desk)) || flowValidating || pulseValidating);

  // Keep skeleton until merged desk OR session cache exists — pulseRest alone must not
  // flip deskLoading false (that rendered OFFLINE/MARKET CLOSED while heavy lanes still load).
  const initialLoading = !merged && !deskStable.current;
  const deskLaneFailed = Boolean(deskFetchError) && !desk && bootstrapSettled;

  return {
    desk: merged,
    live,
    refreshing,
    deskLoading: initialLoading,
    deskLaneFailed,
    sessionActive,
    marketLabel: pulse?.market_label ?? merged?.market_label,
    laneFreshness: {
      pulsePolledAt: pulse?.polled_at ?? pulseRest?.polled_at ?? merged?.polled_at ?? null,
      deskPolledAt: desk?.polled_at ?? null,
      flowPolledAt: flow?.polled_at ?? null,
      pulseValidating,
      deskValidating,
      flowValidating,
      pulseSseConnected,
      feedStalled: Boolean(merged?.feed_stalled),
    },
  };
}
