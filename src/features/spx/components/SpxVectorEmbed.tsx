"use client";

import dynamic from "next/dynamic";
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

/**
 * Client-side Vector embed for the SPX desk — intentionally does NOT SSR-load
 * loadVectorSeedProps. That helper can block HTML for 30–90s (Polygon chain
 * reconstruct + wall history) and was the main source of multi-second dashboard
 * TTFB. VectorChart already hydrates bars/walls/history via /api/market/vector/*.
 */
export function SpxVectorEmbed({
  onPriceScaleRender,
  focusLevel,
  playLevels,
  toolbarReplayLeadSlot,
}: SpxVectorEmbedProps) {
  const sessionYmd = todayEtYmd();

  return (
    <VectorPageShell
      ticker="SPX"
      initialBars={[]}
      initialWalls={null}
      initialVexWalls={null}
      initialWallHistory={[]}
      initialHorizonWallHistory={[]}
      initialGammaFlip={null}
      initialVexFlip={null}
      initialDarkPoolLevels={[]}
      sessionYmd={sessionYmd}
      liveSession
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
