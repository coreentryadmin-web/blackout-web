"use client";

import { Suspense } from "react";
import dynamic from "next/dynamic";
import { clsx } from "clsx";
import { ThermalSkeleton } from "@/features/thermal/components/ThermalSkeleton";

// Code-split the ~4k-line GexHeatmap so it doesn't sit in the shared bundle or block
// hydration. ssr:false → the page shell + skeleton paint immediately on navigation,
// then the heavy chart chunk loads and hydrates. (/heatmap also has a route loading.tsx.)
// Both fallbacks below share ONE `<ThermalSkeleton>` so the outer paint → inner paint
// no longer shape-jumps between two shapes.
const GexHeatmap = dynamic(
  () => import("@/features/thermal/components/GexHeatmap").then((m) => ({ default: m.GexHeatmap })),
  {
    ssr: false,
    loading: () => <ThermalSkeleton variant="hero" />,
  }
);

/**
 * /heatmap is the GEX positioning tool: regime header + gamma profile (with a
 * Profile|Matrix toggle inside GexHeatmap). The legacy GEX|Sectors switch and the
 * sector thermal / movers view were removed — those source components still exist
 * (used by other tools) but no longer render here.
 *
 * The "BlackOut Data Desk · live" EngineStatusBar sub-bar was removed (UI refactor):
 * it duplicated the in-panel Live/Quote-only badge + spot, and the engine still
 * surfaces its status there. The component file is kept for other desks.
 */
export function Heatmap({ nativeShell = false }: { nativeShell?: boolean }) {
  return (
    <div className={clsx("desk-layout gex-heatmap-desk space-y-2", nativeShell && "gex-heatmap-desk-native")}>
      {/* Suspense: GexHeatmap reads useSearchParams for ?ticker=&lens=&compare= deep-links. */}
      <Suspense fallback={<ThermalSkeleton variant="hero" />}>
        <GexHeatmap ticker="SPY" nativeShell={nativeShell} />
      </Suspense>
    </div>
  );
}
