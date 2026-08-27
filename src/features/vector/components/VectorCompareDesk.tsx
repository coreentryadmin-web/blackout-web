"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import clsx from "clsx";
import { useRouter } from "next/navigation";
import { PageShell } from "@/components/ui";
import { VectorCompareCommandBar } from "@/features/vector/components/VectorCompareCommandBar";
import {
  VectorComparePane,
  type VectorComparePaneMeta,
} from "@/features/vector/components/VectorComparePane";
import { VectorPaneErrorBoundary } from "@/features/vector/components/VectorPaneErrorBoundary";
import { fetchVectorClientSeed } from "@/features/vector/lib/vector-client-seed";
import {
  VECTOR_COMPARE_MAX_PANES,
  comparePath,
  deskPath,
  loadCompareSeedsBounded,
  type VectorComparePreset,
} from "@/features/vector/lib/vector-compare";
import type { VectorClientSeed } from "@/features/vector/lib/vector-client-seed";
import { VECTOR_DEFAULT_TIMEFRAME } from "@/features/vector/lib/vector-bar-timeframes";
import { VECTOR_COMPARE_DEFAULT_TIMEFRAME } from "@/features/vector/lib/vector-cadence";
import { VECTOR_DEFAULT_DTE_HORIZON, type VectorDteHorizon } from "@/features/vector/lib/vector-dte-horizon";
import type { VectorTimeframeMinutes } from "@/features/vector/lib/vector-bar-timeframes";
import type { VectorWallLens } from "@/features/vector/lib/vector-wall-history";
import type { VectorCompareLinkedReplayProps } from "@/features/vector/components/VectorCompareCommandBar";
import {
  LINKED_REPLAY_STEP_MS,
  clampTimelineIndex,
  linkedReplayClockLabel,
  mergeReplayTimelines,
  timelineIndexAtOrAfterEtClock,
  timelineIndexAtOrBeforeEtClock,
  type VectorLinkedReplayBind,
} from "@/features/vector/lib/vector-compare-replay";
import { todayEtYmd } from "@/lib/providers/spx-session";
import type { VectorCompareChartSyncBind } from "@/features/vector/lib/vector-compare-sync";
import type { IntradayZoomPreset } from "@/features/vector/lib/vector-candle-render";

type Props = {
  initialSeeds: VectorClientSeed[];
  defaultDteHorizon?: VectorDteHorizon;
};

export function VectorCompareDesk({ initialSeeds, defaultDteHorizon }: Props) {
  const router = useRouter();
  const [seeds, setSeeds] = useState<VectorClientSeed[]>(initialSeeds.slice(0, VECTOR_COMPARE_MAX_PANES));
  const [loadingTickers, setLoadingTickers] = useState<Set<string>>(new Set());
  const [linked, setLinked] = useState(true);
  const [linkedZoom, setLinkedZoom] = useState(true);
  const [syncEpoch, setSyncEpoch] = useState(0);
  // Compare opens on 5m, not the desk's default — see VECTOR_COMPARE_DEFAULT_TIMEFRAME.
  const [timeframe, setTimeframe] = useState<VectorTimeframeMinutes>(
    VECTOR_COMPARE_DEFAULT_TIMEFRAME as VectorTimeframeMinutes
  );
  const [dteHorizon, setDteHorizon] = useState<VectorDteHorizon>(
    defaultDteHorizon ?? VECTOR_DEFAULT_DTE_HORIZON
  );
  const [lens, setLens] = useState<VectorWallLens>("gex");
  const [focusedTicker, setFocusedTicker] = useState<string | null>(seeds[0]?.ticker ?? null);
  const [focusExpanded, setFocusExpanded] = useState(false);
  const [metaByTicker, setMetaByTicker] = useState<Record<string, VectorComparePaneMeta>>({});
  const [syncFlash, setSyncFlash] = useState(false);
  const [linkedReplayMode, setLinkedReplayMode] = useState(false);
  const [linkedReplayPlaying, setLinkedReplayPlaying] = useState(false);
  const [linkedReplayIndex, setLinkedReplayIndex] = useState(0);
  const [linkedReplaySpeed, setLinkedReplaySpeed] = useState(1);
  const [linkedReplayLoop, setLinkedReplayLoop] = useState(false);
  const [linkedReplayTick, setLinkedReplayTick] = useState(0);
  const [unionTimeline, setUnionTimeline] = useState<number[]>([]);
  const timelinesRef = useRef<Map<string, number[]>>(new Map());

  const sessionYmd = seeds[0]?.sessionYmd ?? todayEtYmd();
  const canLinkReplay = linked && seeds.length >= 2;
  const linkedReplayCursorTime =
    linkedReplayMode && unionTimeline.length > 0 ? (unionTimeline[linkedReplayIndex] ?? null) : null;

  const linkedReplayBind: VectorLinkedReplayBind | null = canLinkReplay
    ? {
        active: linkedReplayMode,
        cursorTimeSec: linkedReplayCursorTime,
        tick: linkedReplayTick,
      }
    : null;

  const bumpLinkedReplay = useCallback(() => {
    setLinkedReplayTick((t) => t + 1);
  }, []);

  const exitLinkedReplay = useCallback(() => {
    setLinkedReplayMode(false);
    setLinkedReplayPlaying(false);
    bumpLinkedReplay();
  }, [bumpLinkedReplay]);

  const handleReplayTimeline = useCallback(
    (ticker: string, timeline: number[]) => {
      timelinesRef.current.set(ticker, timeline);
      const active = new Set(seeds.map((s) => s.ticker));
      for (const key of timelinesRef.current.keys()) {
        if (!active.has(key)) timelinesRef.current.delete(key);
      }
      setUnionTimeline(mergeReplayTimelines([...timelinesRef.current.values()]));
    },
    [seeds]
  );

  const linkedReplayUi = useMemo((): VectorCompareLinkedReplayProps | null => {
    if (!canLinkReplay) return null;
    const stepCount = unionTimeline.length;
    const cursorIndex = clampTimelineIndex(unionTimeline, linkedReplayIndex);
    return {
      mode: linkedReplayMode,
      playing: linkedReplayPlaying,
      canReplay: stepCount > 1,
      cursorIndex,
      stepCount,
      clockLabel: linkedReplayClockLabel(unionTimeline, cursorIndex),
      speed: linkedReplaySpeed,
      loop: linkedReplayLoop,
      onToggleReplay: () => {
        if (linkedReplayMode) {
          exitLinkedReplay();
          return;
        }
        setLinkedReplayMode(true);
        setLinkedReplayPlaying(false);
        setLinkedReplayIndex(0);
        bumpLinkedReplay();
      },
      onTogglePlay: () => setLinkedReplayPlaying((p) => !p),
      onScrub: (index: number) => {
        setLinkedReplayPlaying(false);
        setLinkedReplayIndex(clampTimelineIndex(unionTimeline, index));
        bumpLinkedReplay();
      },
      onSpeed: setLinkedReplaySpeed,
      onStep: (delta: number) => {
        setLinkedReplayPlaying(false);
        setLinkedReplayIndex((prev) => clampTimelineIndex(unionTimeline, prev + delta));
        bumpLinkedReplay();
      },
      onJumpOpen: () => {
        setLinkedReplayPlaying(false);
        setLinkedReplayIndex(timelineIndexAtOrAfterEtClock(unionTimeline, sessionYmd, 9, 30));
        bumpLinkedReplay();
      },
      onJumpClose: () => {
        setLinkedReplayPlaying(false);
        setLinkedReplayIndex(timelineIndexAtOrBeforeEtClock(unionTimeline, sessionYmd, 16, 0));
        bumpLinkedReplay();
      },
      onToggleLoop: () => setLinkedReplayLoop((v) => !v),
    };
  }, [
    bumpLinkedReplay,
    canLinkReplay,
    exitLinkedReplay,
    linkedReplayIndex,
    linkedReplayLoop,
    linkedReplayMode,
    linkedReplayPlaying,
    linkedReplaySpeed,
    sessionYmd,
    unionTimeline,
  ]);

  const canFocusExpand = seeds.length >= 2;
  const canLinkTime = linked && seeds.length >= 2;
  const [crosshairSyncTick, setCrosshairSyncTick] = useState(0);
  const [crosshairSync, setCrosshairSync] = useState<{ sourceId: string; timeSec: number | null } | null>(
    null
  );
  const [rangeSyncTick, setRangeSyncTick] = useState(0);
  const [rangeSync, setRangeSync] = useState<{ sourceId: string; fromSec: number; toSec: number } | null>(
    null
  );
  const [syncZoomPreset, setSyncZoomPreset] = useState<IntradayZoomPreset | null>(null);
  const [syncZoomPresetTick, setSyncZoomPresetTick] = useState(0);

  const handleCompareCrosshair = useCallback(
    (paneId: string, timeSec: number | null) => {
      if (!canLinkTime) return;
      setCrosshairSync({ sourceId: paneId, timeSec });
      setCrosshairSyncTick((t) => t + 1);
    },
    [canLinkTime]
  );

  const handleCompareVisibleRange = useCallback(
    (paneId: string, fromSec: number, toSec: number) => {
      if (!canLinkTime || !linkedZoom) return;
      setRangeSync({ sourceId: paneId, fromSec, toSec });
      setRangeSyncTick((t) => t + 1);
    },
    [canLinkTime, linkedZoom]
  );

  const compareSyncBind = useMemo((): VectorCompareChartSyncBind | null => {
    if (!canLinkTime) return null;
    return {
      paneId: "",
      linkCrosshair: true,
      linkZoom: linkedZoom,
      crosshair: crosshairSync
        ? { ...crosshairSync, tick: crosshairSyncTick }
        : null,
      visibleRange: rangeSync ? { ...rangeSync, tick: rangeSyncTick } : null,
      zoomPreset:
        syncZoomPreset != null ? { preset: syncZoomPreset, tick: syncZoomPresetTick } : null,
    };
  }, [
    canLinkTime,
    linkedZoom,
    crosshairSync,
    crosshairSyncTick,
    rangeSync,
    rangeSyncTick,
    syncZoomPreset,
    syncZoomPresetTick,
  ]);

  const paneCompareSync = useCallback(
    (ticker: string): VectorCompareChartSyncBind | null => {
      if (!compareSyncBind) return null;
      return { ...compareSyncBind, paneId: ticker };
    },
    [compareSyncBind]
  );

  /**
   * Leave compare mode, back to the desk for the ticker the member came in on.
   *
   * A FULL navigation, not `router.push`. Measured live on prod 2026-08-19 with the exit button
   * instrumented: the click event dispatches (native listener saw it), the button is the topmost
   * element at its own centre (no overlay), nothing throws — and the URL never changes, at +200ms
   * through +8s. `router.push` INTO compare works from the same app, and a manual
   * `history.pushState` to the very same target changes the URL fine, so the swallowed navigation
   * is specific to pushing out of compare — the target differs from the current URL only by
   * REMOVING the `compare` param, and App Router declines to move.
   *
   * A hard navigation costs one SSR round trip on an explicit "leave this mode" action, which is
   * the right trade for a control that currently does nothing at all. It also tears the compare
   * grid's SSE streams down cleanly rather than relying on unmount ordering across four panes.
   *
   * `seeds[0]` IS the origin ticker: VectorPageClient builds the compare list primary-first from
   * the page's own seed, so this returns to the desk the member pressed Compare on.
   */
  const exitCompareTo = useCallback((ticker: string) => {
    const target = deskPath(ticker);
    if (typeof window === "undefined") {
      router.push(target);
      return;
    }
    window.location.assign(target);
  }, [router]);

  const exclude = useMemo(() => new Set(seeds.map((s) => s.ticker)), [seeds]);
  const liveSession = seeds.some((s) => s.liveSession) || todayEtYmd() === seeds[0]?.sessionYmd;
  /** Grid holds live charts only — add-symbol lives in the command bar. */
  const canAddSymbol = seeds.length < VECTOR_COMPARE_MAX_PANES;
  const gridSlotCount = seeds.length;

  /** Keep App Router URL in sync — raw replaceState breaks <Link> nav (Features → SPX Slayer, etc.). */
  const syncUrl = useCallback(
    (next: VectorClientSeed[]) => {
      router.replace(comparePath(next.map((s) => s.ticker)), { scroll: false });
    },
    [router]
  );

  const flashSync = useCallback(() => {
    setSyncFlash(true);
    window.setTimeout(() => setSyncFlash(false), 420);
  }, []);

  const bumpSync = useCallback(() => {
    setSyncEpoch((e) => e + 1);
    flashSync();
  }, [flashSync]);

  const applySyncZoomPreset = useCallback(
    (preset: IntradayZoomPreset) => {
      // Deliberately skips the full-remount path below: VectorChart already applies a synced zoom preset
      // reactively via the syncZoomPreset/tick props (no remount) — see the effect keyed on
      // `compareSync?.zoomPreset` tick. bumpSync() bumps `syncEpoch`, which VectorComparePane
      // folds into the pane's React `key`, forcing React to fully destroy and rebuild all 4
      // VectorChart instances (tearing down each lightweight-charts instance, WallRailPrimitive,
      // and SSE connection) for something the reactive path already applies for free. Measured
      // 2026-08-27: every Sync-zoom click was doing a redundant 4x full remount on top of the
      // cheap path, discarding the very WallRailPrimitive._derivedCache the perf fix (#2939) keeps
      // warm across repaints. flashSync() alone still gives the visual "synced" pulse.
      setSyncZoomPreset(preset);
      setSyncZoomPresetTick((t) => t + 1);
      flashSync();
    },
    [flashSync]
  );

  const enterFocusExpand = useCallback(
    (ticker?: string) => {
      if (seeds.length < 2) return;
      if (ticker) setFocusedTicker(ticker);
      setFocusExpanded(true);
    },
    [seeds.length]
  );

  const exitFocusExpand = useCallback(() => setFocusExpanded(false), []);

  const toggleFocusExpand = useCallback(() => {
    if (seeds.length < 2) return;
    setFocusExpanded((v) => !v);
  }, [seeds.length]);

  const loadTicker = useCallback(
    async (ticker: string) => {
      if (exclude.has(ticker) || seeds.length >= VECTOR_COMPARE_MAX_PANES) return;
      setLoadingTickers((prev) => new Set(prev).add(ticker));
      try {
        const seed = await fetchVectorClientSeed(ticker);
        setSeeds((prev) => {
          if (prev.length >= VECTOR_COMPARE_MAX_PANES || prev.some((s) => s.ticker === ticker)) return prev;
          const next = [...prev, seed];
          syncUrl(next);
          return next;
        });
        setFocusedTicker(ticker);
        bumpSync();
      } finally {
        setLoadingTickers((prev) => {
          const n = new Set(prev);
          n.delete(ticker);
          return n;
        });
      }
    },
    [exclude, seeds.length, syncUrl, bumpSync]
  );

  const removeTicker = useCallback(
    (ticker: string) => {
      setSeeds((prev) => {
        if (prev.length <= 1) return prev;
        const next = prev.filter((s) => s.ticker !== ticker);
        syncUrl(next);
        return next;
      });
      setMetaByTicker((prev) => {
        const copy = { ...prev };
        delete copy[ticker];
        return copy;
      });
      bumpSync();
    },
    [syncUrl, bumpSync]
  );

  const applyPreset = useCallback(
    async (preset: VectorComparePreset) => {
      setLoadingTickers(new Set(preset.tickers));
      try {
        const loaded = await loadCompareSeedsBounded(
          preset.tickers.slice(0, VECTOR_COMPARE_MAX_PANES),
          (t) => fetchVectorClientSeed(t),
          2
        );
        // Drop panes that failed to load rather than letting one bad ticker sink the preset.
        // Applying "Mag 7" and getting nothing because a single name 502'd is worse than getting
        // the three that loaded; the loader returns a null slot per failure precisely so this
        // choice is available here.
        const ok = loaded.filter(Boolean) as VectorClientSeed[];
        if (!ok.length) return; // keep the existing grid — never blank the desk on a failed preset
        setSeeds(ok);
        syncUrl(ok);
        setFocusedTicker(ok[0]?.ticker ?? null);
        bumpSync();
      } finally {
        setLoadingTickers(new Set());
      }
    },
    [syncUrl, bumpSync]
  );

  const handleMeta = useCallback((ticker: string, meta: VectorComparePaneMeta) => {
    setMetaByTicker((prev) => ({ ...prev, [ticker]: meta }));
  }, []);

  useEffect(() => {
    setLinkedReplayIndex((prev) => clampTimelineIndex(unionTimeline, prev));
  }, [unionTimeline]);

  useEffect(() => {
    if (!linked) exitLinkedReplay();
  }, [linked, exitLinkedReplay]);

  useEffect(() => {
    if (!linkedReplayMode || !linkedReplayPlaying || unionTimeline.length < 2) return;
    const id = window.setInterval(() => {
      setLinkedReplayIndex((prev) => {
        const next = prev + 1;
        if (next >= unionTimeline.length) {
          if (linkedReplayLoop) return 0;
          setLinkedReplayPlaying(false);
          return prev;
        }
        return next;
      });
      bumpLinkedReplay();
    }, LINKED_REPLAY_STEP_MS / Math.max(0.25, linkedReplaySpeed));
    return () => window.clearInterval(id);
  }, [
    bumpLinkedReplay,
    linkedReplayLoop,
    linkedReplayMode,
    linkedReplayPlaying,
    linkedReplaySpeed,
    unionTimeline.length,
  ]);

  useEffect(() => {
    if (initialSeeds.length > 1 && seeds.length === 1) {
      setSeeds(initialSeeds.slice(0, VECTOR_COMPARE_MAX_PANES));
    }
  }, [initialSeeds, seeds.length]);

  useEffect(() => {
    if (!focusExpanded) return;
    window.dispatchEvent(new Event("resize"));
  }, [focusExpanded, focusedTicker]);

  useEffect(() => {
    if (!canFocusExpand) setFocusExpanded(false);
  }, [canFocusExpand]);

  useEffect(() => {
    if (focusedTicker && !seeds.some((s) => s.ticker === focusedTicker)) {
      setFocusedTicker(seeds[0]?.ticker ?? null);
    }
  }, [seeds, focusedTicker]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

      if (linkedReplayMode) {
        if (e.key === "Escape") {
          e.preventDefault();
          exitLinkedReplay();
          return;
        }
        if (e.key === " " || e.code === "Space") {
          e.preventDefault();
          setLinkedReplayPlaying((p) => !p);
          return;
        }
        if (e.key === "ArrowLeft") {
          e.preventDefault();
          linkedReplayUi?.onStep(-1);
          return;
        }
        if (e.key === "ArrowRight") {
          e.preventDefault();
          linkedReplayUi?.onStep(1);
          return;
        }
      }

      if (e.key === "Escape" && focusExpanded) {
        e.preventDefault();
        exitFocusExpand();
        return;
      }

      if ((e.key === "f" || e.key === "F") && !e.metaKey && !e.ctrlKey && !e.altKey && canFocusExpand) {
        e.preventDefault();
        toggleFocusExpand();
        return;
      }

      const idx = Number(e.key) - 1;
      if (idx >= 0 && idx < seeds.length) setFocusedTicker(seeds[idx]!.ticker);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [
    seeds,
    linkedReplayMode,
    exitLinkedReplay,
    linkedReplayUi,
    focusExpanded,
    canFocusExpand,
    exitFocusExpand,
    toggleFocusExpand,
  ]);

  const onTimeframe = (tf: VectorTimeframeMinutes) => {
    setTimeframe(tf);
    bumpSync();
  };
  const onDte = (h: VectorDteHorizon) => {
    setDteHorizon(h);
    bumpSync();
  };
  const onLens = (l: VectorWallLens) => {
    setLens(l);
    bumpSync();
  };

  return (
    <PageShell
      fullBleed
      backdrop={false}
      contentClassName="vector-compare-page-inner"
      className="vector-compare-page ios-native-page ios-native-page-vector"
    >
      <div className="vector-compare-shell">
        <VectorCompareCommandBar
          paneCount={seeds.length}
          linked={linked}
          onToggleLinked={() => setLinked((v) => !v)}
          linkedZoom={linkedZoom}
          onToggleLinkedZoom={() => setLinkedZoom((v) => !v)}
          canLinkTime={canLinkTime}
          focusExpanded={focusExpanded}
          canFocusExpand={canFocusExpand}
          onToggleFocusExpand={toggleFocusExpand}
          linkedReplay={linkedReplayUi}
          timeframe={timeframe}
          onTimeframe={onTimeframe}
          dteHorizon={dteHorizon}
          onDteHorizon={onDte}
          lens={lens}
          onLens={onLens}
          onExitCompare={() => exitCompareTo(seeds[0]?.ticker ?? "SPX")}
          onApplyPreset={applyPreset}
          liveSession={liveSession}
          canAddSymbol={canAddSymbol}
          addExclude={exclude}
          addDisabled={loadingTickers.size > 0}
          onAddSymbol={(t) => void loadTicker(t)}
          syncZoomPreset={syncZoomPreset}
          onSyncZoomPreset={applySyncZoomPreset}
        />

        <div className="vector-compare-mobile-gate" role="status">
          <p className="vector-compare-mobile-gate-title">Compare needs a wider screen</p>
          <p className="vector-compare-mobile-gate-copy">
            Open Vector Compare on desktop (1280px+) — start with one chart and add symbols as you go.
          </p>
        </div>

        <div
          className={clsx(
            "vector-compare-grid",
            syncFlash && "is-sync-flash",
            focusExpanded && canFocusExpand && "is-focus-expanded"
          )}
          data-pane-count={gridSlotCount}
          data-four-up-perf={gridSlotCount >= 4 ? "true" : undefined}
        >
          {seeds.map((seed, i) => {
            const isHero = focusExpanded && focusedTicker === seed.ticker;
            const isRail = focusExpanded && focusedTicker !== seed.ticker;
            const railRow = isRail
              ? seeds.filter((s) => s.ticker !== focusedTicker).findIndex((s) => s.ticker === seed.ticker) +
                1
              : undefined;

            return (
              // Per-pane isolation: an uncaught render error in one pane (bad ticker, malformed
              // live payload reaching an overlay) must not take down the other (working) panes and
              // the desk chrome via the app-level route error boundary. Keyed by ticker like the
              // pane itself, so swapping tickers naturally resets any tripped boundary.
              <VectorPaneErrorBoundary key={seed.ticker} ticker={seed.ticker} onRemove={() => removeTicker(seed.ticker)}>
                <VectorComparePane
                  seed={seed}
                  slotIndex={i}
                  syncEpoch={syncEpoch}
                  linked={linked}
                  linkedTimeframe={timeframe}
                  linkedDteHorizon={dteHorizon}
                  linkedLens={lens}
                  toolbarHideLinkedControls={linked}
                  onRemove={() => removeTicker(seed.ticker)}
                  removable={seeds.length > 1}
                  onMeta={handleMeta}
                  focused={focusedTicker === seed.ticker}
                  onFocus={() => setFocusedTicker(seed.ticker)}
                  focusHero={isHero}
                  focusRail={isRail}
                  focusRailRow={railRow}
                  onRequestFocusExpand={() => enterFocusExpand(seed.ticker)}
                  compareSync={paneCompareSync(seed.ticker)}
                  onCompareCrosshair={handleCompareCrosshair}
                  onCompareVisibleRange={handleCompareVisibleRange}
                  linkedReplay={linkedReplayBind}
                  hideReplayControls={linked}
                  onReplayTimeline={(timeline) => handleReplayTimeline(seed.ticker, timeline)}
                  compareFourUp={seeds.length >= 4}
                  compareFourUpBackground={seeds.length >= 4 && focusedTicker !== seed.ticker}
                />
              </VectorPaneErrorBoundary>
            );
          })}
        </div>

        {seeds.length >= 2 ? (
          <footer className="vector-compare-strip" aria-label="Compare summary">
            {seeds.map((s) => {
              const meta = metaByTicker[s.ticker];
              const posture = meta?.regime?.posture ?? "unknown";
              return (
                <div key={s.ticker} className={clsx("vector-compare-strip-chip", `is-${posture}`)}>
                  <span className="vector-compare-strip-ticker">{s.ticker}</span>
                  <span className="vector-compare-strip-posture">
                    {posture === "long" ? "▲ long γ" : posture === "short" ? "▼ short γ" : "—"}
                  </span>
                </div>
              );
            })}
          </footer>
        ) : null}
      </div>
    </PageShell>
  );
}
