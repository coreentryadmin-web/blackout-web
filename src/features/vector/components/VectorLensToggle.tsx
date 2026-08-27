"use client";

import { useEffect, useState } from "react";
import clsx from "clsx";
import type { VectorWallLens } from "@/features/vector/lib/vector-wall-history";
import { formatVectorAge } from "@/features/vector/lib/vector-age-format";

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

  const gexAge = formatVectorAge(gexAsOf, now);
  const vexAge = formatVectorAge(vexAsOf, now);

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
