"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import type { VectorBar } from "@/features/vector/components/VectorChart";
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
    void fetch("/api/market/vector/bars?ticker=SPX", { cache: "no-store" })
      .then(async (res) => {
        if (!res.ok) throw new Error(`bars ${res.status}`);
        return (await res.json()) as { bars?: VectorBar[]; sessionYmd?: string };
      })
      .then((data) => {
        if (cancelled) return;
        setSeed({
          bars: data.bars ?? [],
          sessionYmd: data.sessionYmd ?? todayEtYmd(),
        });
      })
      .catch(() => {
        if (cancelled) return;
        setSeed({ bars: [], sessionYmd: todayEtYmd() });
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
      initialWalls={null}
      initialVexWalls={null}
      initialWallHistory={[]}
      initialHorizonWallHistory={[]}
      initialGammaFlip={null}
      initialVexFlip={null}
      initialDarkPoolLevels={[]}
      sessionYmd={seed.sessionYmd}
      liveSession={liveSession}
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
