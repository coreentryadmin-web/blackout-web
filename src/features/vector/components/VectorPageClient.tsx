"use client";

import dynamic from "next/dynamic";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { VectorPageShell } from "@/features/vector/components/VectorPageShell";
import type { VectorSeedProps } from "@/features/vector/lib/vector-seed-props";
import { fetchVectorClientSeed } from "@/features/vector/lib/vector-client-seed";
import type { VectorClientSeed } from "@/features/vector/lib/vector-client-seed";
import { VECTOR_DEFAULT_TICKER } from "@/features/vector/lib/vector-ticker";
import {
  comparePath,
  isCompareMode,
  parseCompareTickers,
} from "@/features/vector/lib/vector-compare";
import type { VectorDteHorizon } from "@/features/vector/lib/vector-dte-horizon";

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

type Props = VectorSeedProps & {
  initialCompareRaw?: string | null;
  defaultDteHorizon?: VectorDteHorizon;
  defaultChartViewport?: "session" | "live";
  defaultTimeframe?: import("@/features/vector/lib/vector-bar-timeframes").VectorTimeframeMinutes;
};

function seedFromProps(props: VectorSeedProps): VectorClientSeed {
  return {
    ticker: props.ticker,
    initialBars: props.initialBars,
    initialWalls: props.initialWalls,
    initialVexWalls: props.initialVexWalls,
    initialWallHistory: props.initialWallHistory,
    initialHorizonWallHistory: props.initialHorizonWallHistory ?? [],
    initialGammaFlip: props.initialGammaFlip,
    initialVexFlip: props.initialVexFlip,
    initialDarkPoolLevels: props.initialDarkPoolLevels,
    sessionYmd: props.sessionYmd,
    liveSession: props.liveSession,
    initialWallTrailSec: props.initialWallTrailSec ?? 15,
  };
}

/**
 * /vector client wrapper — desk mode (full terminal) or compare mode (up to 4 chart-only panes).
 */
export function VectorPageClient(initial: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const compareRaw = searchParams.get("compare") ?? initial.initialCompareRaw ?? null;
  const compareTickers = useMemo(() => parseCompareTickers(compareRaw), [compareRaw]);
  const inCompare = isCompareMode(compareRaw) && compareTickers.length > 0;

  const [seed, setSeed] = useState(initial);
  const [navBusy, setNavBusy] = useState(false);
  const [compareSeeds, setCompareSeeds] = useState<VectorClientSeed[] | null>(null);

  useEffect(() => {
    if (!inCompare) {
      setCompareSeeds(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      const primary = seedFromProps(initial);
      const others = compareTickers.filter((t) => t !== primary.ticker);
      if (!others.length) {
        if (!cancelled) setCompareSeeds([primary]);
        return;
      }
      const loaded = await Promise.all(others.map((t) => fetchVectorClientSeed(t)));
      if (cancelled) return;
      const ordered = compareTickers
        .map((t) => [primary, ...loaded].find((s) => s.ticker === t))
        .filter(Boolean) as VectorClientSeed[];
      setCompareSeeds(ordered.length ? ordered : [primary]);
    })();
    return () => {
      cancelled = true;
    };
  }, [inCompare, compareTickers, initial]);

  const onTickerSelect = useCallback(async (next: string) => {
    if (next === seed.ticker) return;
    setNavBusy(true);
    const path =
      next === VECTOR_DEFAULT_TICKER ? "/vector" : `/vector?ticker=${encodeURIComponent(next)}`;
    window.history.replaceState(null, "", path);
    try {
      const clientSeed = await fetchVectorClientSeed(next);
      setSeed((prev) => ({
        ...prev,
        ...clientSeed,
        defaultDteHorizon: prev.defaultDteHorizon,
        defaultChartViewport: prev.defaultChartViewport,
        defaultTimeframe: prev.defaultTimeframe,
      }));
    } finally {
      setNavBusy(false);
    }
  }, [seed.ticker]);

  const onEnterCompare = useCallback(() => {
    router.push(comparePath([seed.ticker]));
  }, [router, seed.ticker]);

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
      <VectorCompareDesk
        initialSeeds={compareSeeds}
        defaultDteHorizon={initial.defaultDteHorizon}
      />
    );
  }

  return (
    <VectorPageShell
      {...seed}
      defaultDteHorizon={initial.defaultDteHorizon}
      defaultChartViewport={initial.defaultChartViewport}
      defaultTimeframe={initial.defaultTimeframe}
      onTickerSelect={onTickerSelect}
      tickerNavBusy={navBusy}
      onEnterCompare={onEnterCompare}
    />
  );
}
