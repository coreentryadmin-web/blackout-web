"use client";

import { useEffect, useState } from "react";
import { clsx } from "clsx";
import { FreshnessChip } from "@/components/ui";
import {
  thermalLayerFreshness,
  wallScopeLabel,
  type ThermalLayerFreshness,
} from "@/features/thermal/lib/thermal-desk-state";

export function ThermalFreshnessBar({
  matrixAsof,
  overlaysAt,
  hasOverlays,
  crossValUwAsof,
  crossValPresent,
  nearTermExpiries,
  matrixLoading,
  className,
}: {
  matrixAsof?: string | null;
  overlaysAt?: string | null;
  hasOverlays: boolean;
  crossValUwAsof?: string | null;
  crossValPresent: boolean;
  nearTermExpiries?: string[] | null;
  matrixLoading?: boolean;
  className?: string;
}) {
  const [nowMs, setNowMs] = useState<number | null>(null);
  useEffect(() => {
    setNowMs(Date.now());
    const id = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const layers: ThermalLayerFreshness | null =
    nowMs == null
      ? null
      : thermalLayerFreshness({
          nowMs,
          matrixAsof,
          overlaysAt,
          hasOverlays,
          crossValUwAsof,
          crossValPresent,
          matrixLoading,
        });

  const walls = wallScopeLabel(nearTermExpiries);

  return (
    <div
      className={clsx(
        "flex flex-wrap items-center gap-2 rounded-xl border border-white/10 bg-[rgba(8,9,14,0.4)] px-3 py-2",
        className
      )}
      aria-label="Thermal data freshness"
    >
      {layers ? (
        <>
          <FreshnessChip
            status={layers.matrix.status}
            asOf={layers.matrix.asOf}
            label="Matrix"
          />
          <FreshnessChip
            status={layers.overlays.status}
            asOf={layers.overlays.asOf}
            label={layers.overlays.label}
          />
          <FreshnessChip
            status={layers.crossVal.status}
            asOf={layers.crossVal.asOf}
            label={layers.crossVal.label}
            title={layers.crossVal.title}
          />
        </>
      ) : (
        <FreshnessChip status="syncing" label="Matrix" />
      )}
      <span
        className="inline-flex items-center rounded-full border border-cyan-400/30 bg-cyan-400/10 px-2.5 py-1 font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-cyan-400"
        title={walls.title}
      >
        {walls.short}
      </span>
    </div>
  );
}
