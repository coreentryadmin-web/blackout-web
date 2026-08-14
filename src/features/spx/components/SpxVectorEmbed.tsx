"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import type { VectorBar } from "@/features/vector/components/VectorChart";
import { fetchVectorClientSeed } from "@/features/vector/lib/vector-client-seed";
import { todayEtYmd } from "@/lib/providers/spx-session";

const VectorPageShell = dynamic(
  () =>
    import("@/features/vector/components/VectorPageShell").then((m) => ({
      default: m.VectorPageShell,
    })),
  {
    loading: () => (
      <div
        className="vector-embed-loading flex min-h-[min(36dvh,320px)] flex-1 items-center justify-center rounded-xl border border-cyan-500/20 bg-black/40 text-sm text-cyan-300"
        role="status"
        aria-live="polite"
      >
        Loading Vector chart…
      </div>
    ),
  }
);

type SpxVectorEmbedProps = {
  onPriceScaleRender?: (map: import("@/features/vector/lib/vector-price-scale-map").VectorPriceScaleMap) => void;
  focusLevel?: { price: number; label: string; tone: string; seq: number } | null;
  playLevels?: import("@/features/vector/lib/vector-play-levels").PlayLevelsInput;
  toolbarReplayLeadSlot?: React.ReactNode;
};

type VectorBarsSeed = {
  bars: VectorBar[];
  sessionYmd: string;
  wallHistory: import("@/features/vector/lib/vector-wall-history").WallHistorySample[];
  horizonWallHistory: import("@/features/vector/lib/vector-wall-history").WallHistorySample[];
  walls: import("@/lib/api").VectorWalls | null;
  gammaFlip: number | null;
  wallTrailSec: number;
};

/**
 * Client-side Vector embed for the SPX desk — intentionally does NOT SSR-load
 * loadVectorSeedProps. That helper can block HTML for 30–90s (Polygon chain
 * reconstruct + wall history) and was the main source of multi-second dashboard
 * TTFB.
 *
 * Bars + sessionYmd MUST come from `/api/market/vector/bars`: fetchVectorSeedBars
 * pins sessionYmd to the latest trading day that actually has minute bars (often
 * yesterday pre-open / weekend). Hardcoding calendar today caused connectLive to
 * reject every backfill (`data.sessionYmd !== sessionYmd`) → blank chart on SPX.
 */
export function SpxVectorEmbed({
  onPriceScaleRender,
  focusLevel,
  playLevels,
  toolbarReplayLeadSlot,
}: SpxVectorEmbedProps) {
  const [seed, setSeed] = useState<VectorBarsSeed | null>(null);

  useEffect(() => {
    let cancelled = false;
    void fetchVectorClientSeed("SPX")
      .then((seed) => {
        if (cancelled) return;
        setSeed({
          bars: seed.initialBars,
          sessionYmd: seed.sessionYmd,
          wallHistory: seed.initialWallHistory,
          horizonWallHistory: seed.initialHorizonWallHistory,
          walls: seed.initialWalls,
          gammaFlip: seed.initialGammaFlip,
          wallTrailSec: seed.initialWallTrailSec,
        });
      })
      .catch(() => {
        if (cancelled) return;
        setSeed({
          bars: [],
          sessionYmd: todayEtYmd(),
          wallHistory: [],
          horizonWallHistory: [],
          walls: null,
          gammaFlip: null,
          wallTrailSec: 5,
        });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!seed) {
    return (
      <div
        className="vector-embed-loading flex min-h-[min(36dvh,320px)] flex-1 items-center justify-center rounded-xl border border-cyan-500/20 bg-black/40 text-sm text-cyan-300"
        role="status"
        aria-live="polite"
      >
        Loading Vector chart…
      </div>
    );
  }

  const liveSession = seed.sessionYmd === todayEtYmd();

  return (
    <VectorPageShell
      ticker="SPX"
      initialBars={seed.bars}
      initialWalls={seed.walls}
      initialVexWalls={null}
      initialWallHistory={seed.wallHistory}
      initialHorizonWallHistory={seed.horizonWallHistory}
      initialGammaFlip={seed.gammaFlip}
      initialVexFlip={null}
      initialDarkPoolLevels={[]}
      sessionYmd={seed.sessionYmd}
      liveSession={liveSession}
      initialWallTrailSec={seed.wallTrailSec}
      embed="chart-only"
      defaultDteHorizon="0dte"
      defaultChartViewport="session"
      defaultTimeframe={3}
      onPriceScaleRender={onPriceScaleRender}
      focusLevel={focusLevel}
      playLevels={playLevels}
      toolbarReplayLeadSlot={toolbarReplayLeadSlot}
    />
  );
}
