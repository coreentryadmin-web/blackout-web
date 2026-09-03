"use client";

import { useEffect, useMemo, useState } from "react";
import { clsx } from "clsx";
import { FreshnessChip } from "@/components/ui";
import { spxDeskLaneFreshness } from "@/features/spx/lib/spx-desk-lane-freshness";

type Props = {
  sessionActive?: boolean;
  pulsePolledAt?: string | null;
  deskPolledAt?: string | null;
  flowPolledAt?: string | null;
  pulseValidating?: boolean;
  deskValidating?: boolean;
  flowValidating?: boolean;
  pulseSseConnected?: boolean;
  feedStalled?: boolean;
  className?: string;
};

export function SpxDeskLaneFreshness({
  sessionActive = false,
  pulsePolledAt,
  deskPolledAt,
  flowPolledAt,
  pulseValidating = false,
  deskValidating = false,
  flowValidating = false,
  pulseSseConnected = false,
  feedStalled = false,
  className,
}: Props) {
  const [nowMs, setNowMs] = useState<number | null>(null);

  useEffect(() => {
    setNowMs(Date.now());
    const id = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const layers = useMemo(() => {
    if (nowMs == null) return null;
    return spxDeskLaneFreshness({
      nowMs,
      sessionActive,
      pulsePolledAt,
      deskPolledAt,
      flowPolledAt,
      pulseValidating,
      deskValidating,
      flowValidating,
      pulseSseConnected,
      feedStalled,
    });
  }, [
    nowMs,
    sessionActive,
    pulsePolledAt,
    deskPolledAt,
    flowPolledAt,
    pulseValidating,
    deskValidating,
    flowValidating,
    pulseSseConnected,
    feedStalled,
  ]);

  return (
    <div
      className={clsx(
        "spx-desk-lane-freshness flex flex-wrap items-center gap-1.5",
        className
      )}
      aria-label="SPX desk lane freshness"
    >
      {layers ? (
        layers.map((layer) => (
          <FreshnessChip
            key={layer.lane}
            status={layer.status}
            asOf={layer.asOf}
            label={layer.label}
            title={layer.title}
          />
        ))
      ) : (
        <>
          <FreshnessChip status="syncing" label="Pulse" />
          <FreshnessChip status="syncing" label="Desk" />
          <FreshnessChip status="syncing" label="Flow" />
        </>
      )}
    </div>
  );
}
