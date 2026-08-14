"use client";

import { useCallback, useState } from "react";
import { VectorPageShell } from "@/features/vector/components/VectorPageShell";
import type { VectorSeedProps } from "@/features/vector/lib/vector-seed-props";
import { fetchVectorClientSeed } from "@/features/vector/lib/vector-client-seed";
import { VECTOR_DEFAULT_TICKER } from "@/features/vector/lib/vector-ticker";
import type { VectorDteHorizon } from "@/features/vector/lib/vector-dte-horizon";

type Props = VectorSeedProps & {
  defaultDteHorizon?: VectorDteHorizon;
  defaultChartViewport?: "session" | "live";
  defaultTimeframe?: import("@/features/vector/lib/vector-bar-timeframes").VectorTimeframeMinutes;
};

/**
 * /vector client nav wrapper — first paint uses SSR seed; ticker switches fetch client-side
 * so soft navigation stays under ~1s instead of re-running loadVectorSeedProps on every push.
 */
export function VectorPageClient(initial: Props) {
  const [seed, setSeed] = useState(initial);
  const [navBusy, setNavBusy] = useState(false);

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

  return (
    <VectorPageShell
      {...seed}
      defaultDteHorizon={initial.defaultDteHorizon}
      defaultChartViewport={initial.defaultChartViewport}
      defaultTimeframe={initial.defaultTimeframe}
      onTickerSelect={onTickerSelect}
      tickerNavBusy={navBusy}
    />
  );
}
