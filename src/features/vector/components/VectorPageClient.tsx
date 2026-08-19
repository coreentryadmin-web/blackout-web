"use client";

import dynamic from "next/dynamic";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { VectorPageShell } from "@/features/vector/components/VectorPageShell";
import {
  fetchVectorClientSeed,
  fetchVectorEmbedFastSeed,
} from "@/features/vector/lib/vector-client-seed";
import type { VectorClientSeed } from "@/features/vector/lib/vector-client-seed";
import { VECTOR_DEFAULT_TICKER } from "@/features/vector/lib/vector-ticker";
import {
  comparePath,
  isCompareMode,
  loadCompareSeedsBounded,
  parseCompareTickers,
  resolveCompareRaw,
} from "@/features/vector/lib/vector-compare";
import type { VectorDteHorizon } from "@/features/vector/lib/vector-dte-horizon";
import { todayEtYmd } from "@/lib/providers/spx-session";
import { PhosphorBoot } from "@/components/ui/loading/PhosphorBoot";

const VectorCompareDesk = dynamic(
  () =>
    import("@/features/vector/components/VectorCompareDesk").then((m) => ({
      default: m.VectorCompareDesk,
    })),
  {
    loading: () => (
      <div
        className="flex min-h-[60vh] items-center justify-center font-mono text-sm text-cyan-300"
        role="status"
      >
        Loading Vector Compare…
      </div>
    ),
  }
);

export type VectorPageClientProps = {
  /** Normalized ticker from the page URL — seed loads client-side (see bootstrap effect). */
  ticker: string;
  initialCompareRaw?: string | null;
  defaultDteHorizon?: VectorDteHorizon;
  defaultChartViewport?: "session" | "live";
  defaultTimeframe?: import("@/features/vector/lib/vector-bar-timeframes").VectorTimeframeMinutes;
};

function fastToClientSeed(ticker: string, fast: Awaited<ReturnType<typeof fetchVectorEmbedFastSeed>>): VectorClientSeed {
  return {
    ticker,
    initialBars: fast.initialBars,
    initialWalls: fast.initialWalls,
    initialVexWalls: null,
    initialWallHistory: fast.initialWallHistory,
    initialHorizonWallHistory: fast.initialHorizonWallHistory,
    initialGammaFlip: fast.initialGammaFlip,
    initialVexFlip: null,
    initialDarkPoolLevels: [],
    sessionYmd: fast.sessionYmd,
    liveSession: fast.sessionYmd === todayEtYmd(),
    initialWallTrailSec: fast.initialWallTrailSec,
  };
}

/**
 * /vector client wrapper — desk mode (full terminal) or compare mode (linked chart panes).
 *
 * Intentionally does NOT consume SSR `loadVectorSeedProps` — that path blocked HTML for 30–90s
 * (Polygon reconstruct + wall-history enrich) and was the dominant desk TTFB failure. Same
 * two-phase client bootstrap as SpxVectorEmbed: fast rail-bootstrap first paint, full seed upgrade.
 */
export function VectorPageClient({
  ticker: bootstrapTicker,
  initialCompareRaw: _initialCompareRaw,
  defaultDteHorizon,
  defaultChartViewport,
  defaultTimeframe,
}: VectorPageClientProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const compareRaw = resolveCompareRaw(searchParams.get("compare"));
  const compareTickers = useMemo(() => parseCompareTickers(compareRaw), [compareRaw]);
  const inCompare = isCompareMode(compareRaw) && compareTickers.length > 0;

  const [seed, setSeed] = useState<VectorClientSeed | null>(null);
  const [navBusy, setNavBusy] = useState(false);
  const [compareSeeds, setCompareSeeds] = useState<VectorClientSeed[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    setSeed(null);
    void (async () => {
      try {
        const fast = await fetchVectorEmbedFastSeed(bootstrapTicker);
        if (cancelled) return;
        setSeed(fastToClientSeed(bootstrapTicker, fast));
        const full = await fetchVectorClientSeed(bootstrapTicker);
        if (cancelled) return;
        setSeed(full);
      } catch {
        if (cancelled) return;
        setSeed({
          ticker: bootstrapTicker,
          initialBars: [],
          initialWalls: null,
          initialVexWalls: null,
          initialWallHistory: [],
          initialHorizonWallHistory: [],
          initialGammaFlip: null,
          initialVexFlip: null,
          initialDarkPoolLevels: [],
          sessionYmd: todayEtYmd(),
          liveSession: false,
          initialWallTrailSec: 15,
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [bootstrapTicker]);

  useEffect(() => {
    if (!inCompare || !seed) {
      setCompareSeeds(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      const primary = seed;
      const others = compareTickers.filter((t) => t !== primary.ticker);
      if (!others.length) {
        if (!cancelled) setCompareSeeds([primary]);
        return;
      }
      let loaded: Array<VectorClientSeed | null> = [];
      try {
        loaded = await loadCompareSeedsBounded(others, (t) => fetchVectorClientSeed(t), 2);
      } catch {
        loaded = [];
      }
      if (cancelled) return;
      const available = [primary, ...loaded.filter(Boolean)] as VectorClientSeed[];
      const ordered = compareTickers
        .map((t) => available.find((s) => s.ticker === t))
        .filter(Boolean) as VectorClientSeed[];
      setCompareSeeds(ordered.length ? ordered : [primary]);
    })();
    return () => {
      cancelled = true;
    };
  }, [inCompare, compareTickers, seed]);

  const onTickerSelect = useCallback(
    async (next: string) => {
      if (!seed || next === seed.ticker) return;
      setNavBusy(true);
      const path =
        next === VECTOR_DEFAULT_TICKER ? "/vector" : `/vector?ticker=${encodeURIComponent(next)}`;
      router.replace(path, { scroll: false });
      try {
        const clientSeed = await fetchVectorClientSeed(next);
        setSeed(clientSeed);
      } finally {
        setNavBusy(false);
      }
    },
    [router, seed]
  );

  const onEnterCompare = useCallback(() => {
    if (!seed) return;
    router.push(comparePath([seed.ticker]));
  }, [router, seed]);

  if (!seed) {
    return (
      <div className="desk-route-loading flex min-h-[60vh] items-center justify-center px-4">
        <PhosphorBoot label="Loading Vector" />
      </div>
    );
  }

  if (inCompare) {
    if (!compareSeeds?.length) {
      return (
        <div
          className="vector-compare-boot flex min-h-[60vh] items-center justify-center font-mono text-sm text-cyan-300"
          role="status"
        >
          Loading Vector Compare…
        </div>
      );
    }
    return (
      <VectorCompareDesk initialSeeds={compareSeeds} defaultDteHorizon={defaultDteHorizon} />
    );
  }

  return (
    <VectorPageShell
      {...seed}
      defaultDteHorizon={defaultDteHorizon}
      defaultChartViewport={defaultChartViewport}
      defaultTimeframe={defaultTimeframe}
      onTickerSelect={onTickerSelect}
      tickerNavBusy={navBusy}
      onEnterCompare={onEnterCompare}
    />
  );
}
