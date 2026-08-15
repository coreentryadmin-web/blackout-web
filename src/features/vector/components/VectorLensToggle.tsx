"use client";

import { useEffect, useState } from "react";
import clsx from "clsx";
import type { VectorWallLens } from "@/features/vector/lib/vector-wall-history";

type Props = {
  lens: VectorWallLens;
  vexAvailable: boolean;
  onLens: (lens: VectorWallLens) => void;
  gexAsOf?: number | null;
  vexAsOf?: number | null;
  liveSession?: boolean;
  /** When false, omit data-testid (compact toolbar row duplicates desktop controls in DOM). */
  exposeTestIds?: boolean;
};

function formatLensAge(asOf: number | null | undefined, now: number | null): string | null {
  if (asOf == null || now == null || asOf <= 0) return null;
  const s = Math.max(0, Math.floor((now - asOf) / 1000));
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m`;
}

/** Compact GEX / VEX lens toggle — no helper copy (toolbar). */
export function VectorLensToggle({
  lens,
  vexAvailable,
  onLens,
  gexAsOf,
  vexAsOf,
  liveSession = false,
  exposeTestIds = true,
}: Props) {
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    if (!liveSession) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [liveSession]);

  const gexAge = formatLensAge(gexAsOf, now);
  const vexAge = formatLensAge(vexAsOf, now);

  return (
    <div className="vector-desk-seg" role="group" aria-label="Wall exposure lens">
      {(["gex", "vex"] as const).map((key) => {
        const active = lens === key;
        const disabled = key === "vex" && !vexAvailable;
        const age = key === "gex" ? gexAge : vexAge;
        return (
          <button
            key={key}
            type="button"
            disabled={disabled}
            onClick={() => onLens(key)}
            aria-pressed={active}
            {...(exposeTestIds ? { "data-testid": `vector-lens-${key}` } : {})}
            className={clsx(
              "vector-desk-seg-btn",
              active && key === "gex" && "is-active is-gex",
              active && key === "vex" && "is-active is-vex",
              disabled && "is-disabled"
            )}
          >
            {key === "gex" ? "GEX" : "VEX"}
            {liveSession && age != null ? (
              <span className="vector-desk-seg-meta">· {age}</span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
