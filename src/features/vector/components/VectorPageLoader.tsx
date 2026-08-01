"use client";

import { useEffect, useState } from "react";
import { VectorPageShell } from "@/features/vector/components/VectorPageShell";
import type { VectorSeedProps } from "@/features/vector/lib/vector-seed-props";
import type { VectorDteHorizon } from "@/features/vector/lib/vector-dte-horizon";

type Props = {
  ticker: string;
  defaultDteHorizon?: VectorDteHorizon;
  defaultChartViewport?: "session" | "live";
};

/**
 * /vector entry — client-fetches trimmed seed so HTML is not blocked on cold Polygon
 * reconstruct and wall rails are not embedded as a multi‑MB RSC payload.
 */
export function VectorPageLoader({ ticker, defaultDteHorizon, defaultChartViewport }: Props) {
  const [seed, setSeed] = useState<VectorSeedProps | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void fetch(`/api/market/vector/seed?ticker=${encodeURIComponent(ticker)}`, { cache: "no-store" })
      .then(async (res) => {
        if (!res.ok) throw new Error(`seed ${res.status}`);
        return (await res.json()) as VectorSeedProps;
      })
      .then((data) => {
        if (cancelled) return;
        setSeed(data);
      })
      .catch(() => {
        if (cancelled) return;
        setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [ticker]);

  if (failed) {
    return (
      <div
        className="flex min-h-[min(72vh,640px)] items-center justify-center rounded-xl border border-rose-500/30 bg-black/40 px-6 text-center text-sm text-rose-300"
        role="alert"
      >
        Vector chart data is temporarily unavailable. Refresh to retry.
      </div>
    );
  }

  if (!seed) {
    return (
      <div
        className="flex min-h-[min(72vh,640px)] items-center justify-center rounded-xl border border-cyan-500/20 bg-black/40 text-sm text-cyan-300"
        role="status"
        aria-live="polite"
      >
        Loading Vector chart…
      </div>
    );
  }

  return (
    <VectorPageShell
      {...seed}
      defaultDteHorizon={defaultDteHorizon}
      defaultChartViewport={defaultChartViewport}
    />
  );
}
