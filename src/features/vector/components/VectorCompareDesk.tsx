"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import clsx from "clsx";
import { useRouter } from "next/navigation";
import { PageShell } from "@/components/ui";
import { VectorCompareAddSlot } from "@/features/vector/components/VectorCompareAddSlot";
import { VectorCompareCommandBar } from "@/features/vector/components/VectorCompareCommandBar";
import {
  VectorComparePane,
  type VectorComparePaneMeta,
} from "@/features/vector/components/VectorComparePane";
import { fetchVectorClientSeed } from "@/features/vector/lib/vector-client-seed";
import {
  VECTOR_COMPARE_MAX_PANES,
  comparePath,
  deskPath,
  type VectorComparePreset,
} from "@/features/vector/lib/vector-compare";
import type { VectorClientSeed } from "@/features/vector/lib/vector-client-seed";
import { VECTOR_DEFAULT_TIMEFRAME } from "@/features/vector/lib/vector-bar-timeframes";
import type { VectorDteHorizon } from "@/features/vector/lib/vector-dte-horizon";
import type { VectorTimeframeMinutes } from "@/features/vector/lib/vector-bar-timeframes";
import type { VectorWallLens } from "@/features/vector/lib/vector-wall-history";
import { todayEtYmd } from "@/lib/providers/spx-session";

type Props = {
  initialSeeds: VectorClientSeed[];
  defaultDteHorizon?: VectorDteHorizon;
};

export function VectorCompareDesk({ initialSeeds, defaultDteHorizon }: Props) {
  const router = useRouter();
  const [seeds, setSeeds] = useState<VectorClientSeed[]>(initialSeeds.slice(0, VECTOR_COMPARE_MAX_PANES));
  const [loadingTickers, setLoadingTickers] = useState<Set<string>>(new Set());
  const [linked, setLinked] = useState(true);
  const [syncEpoch, setSyncEpoch] = useState(0);
  const [timeframe, setTimeframe] = useState<VectorTimeframeMinutes>(VECTOR_DEFAULT_TIMEFRAME);
  const [dteHorizon, setDteHorizon] = useState<VectorDteHorizon>(defaultDteHorizon ?? "weekly");
  const [lens, setLens] = useState<VectorWallLens>("gex");
  const [focusedTicker, setFocusedTicker] = useState<string | null>(seeds[0]?.ticker ?? null);
  const [metaByTicker, setMetaByTicker] = useState<Record<string, VectorComparePaneMeta>>({});
  const [syncFlash, setSyncFlash] = useState(false);

  const exclude = useMemo(() => new Set(seeds.map((s) => s.ticker)), [seeds]);
  const liveSession = seeds.some((s) => s.liveSession) || todayEtYmd() === seeds[0]?.sessionYmd;
  const emptySlots = Math.max(0, VECTOR_COMPARE_MAX_PANES - seeds.length);

  const syncUrl = useCallback((next: VectorClientSeed[]) => {
    const path = comparePath(next.map((s) => s.ticker));
    window.history.replaceState(null, "", path);
  }, []);

  const bumpSync = useCallback(() => {
    setSyncEpoch((e) => e + 1);
    setSyncFlash(true);
    window.setTimeout(() => setSyncFlash(false), 420);
  }, []);

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
        const loaded = await Promise.all(
          preset.tickers.slice(0, VECTOR_COMPARE_MAX_PANES).map((t) => fetchVectorClientSeed(t))
        );
        setSeeds(loaded);
        syncUrl(loaded);
        setFocusedTicker(loaded[0]?.ticker ?? null);
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
    if (initialSeeds.length > 1 && seeds.length === 1) {
      setSeeds(initialSeeds.slice(0, VECTOR_COMPARE_MAX_PANES));
    }
  }, [initialSeeds, seeds.length]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      const idx = Number(e.key) - 1;
      if (idx >= 0 && idx < seeds.length) setFocusedTicker(seeds[idx]!.ticker);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [seeds]);

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
          timeframe={timeframe}
          onTimeframe={onTimeframe}
          dteHorizon={dteHorizon}
          onDteHorizon={onDte}
          lens={lens}
          onLens={onLens}
          onExitCompare={() => router.push(deskPath(seeds[0]?.ticker ?? "SPX"))}
          onApplyPreset={applyPreset}
          liveSession={liveSession}
        />

        <div className="vector-compare-mobile-gate" role="status">
          <p className="vector-compare-mobile-gate-title">Compare needs a wider screen</p>
          <p className="vector-compare-mobile-gate-copy">
            Open Vector Compare on desktop (1280px+) for up to four linked charts.
          </p>
        </div>

        <div
          className={clsx(
            "vector-compare-grid",
            `vector-compare-grid--${seeds.length}`,
            syncFlash && "is-sync-flash"
          )}
          data-pane-count={seeds.length}
        >
          {seeds.map((seed, i) => (
            <VectorComparePane
              key={seed.ticker}
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
            />
          ))}
          {Array.from({ length: emptySlots }).map((_, i) => (
            <div key={`empty-${i}`} className="vector-compare-slot-empty">
              <VectorCompareAddSlot
                onPick={(t) => void loadTicker(t)}
                exclude={exclude}
                disabled={loadingTickers.size > 0}
              />
            </div>
          ))}
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
