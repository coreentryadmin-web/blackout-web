"use client";

import clsx from "clsx";
import {
  VECTOR_BEAD_DISPLAY,
  type VectorBeadDisplayId,
  type VectorIndicatorId,
} from "@/features/vector/lib/vector-indicators-config";
import type { VectorWallLens } from "@/features/vector/lib/vector-wall-history";

type Props = {
  enabled: Set<VectorIndicatorId>;
  onToggle: (id: VectorBeadDisplayId) => void;
  lens: VectorWallLens;
  /** When false, omit data-testid (compact toolbar row duplicates desktop controls in DOM). */
  exposeTestIds?: boolean;
};

/** Independent on/off chips for bead-rail canvas channels (integrity halos, $ gamma sizing). */
export function VectorBeadRailToggle({
  enabled,
  onToggle,
  lens,
  exposeTestIds = true,
}: Props) {
  return (
    <div className="vector-desk-seg vector-bead-rail-seg" role="group" aria-label="Bead rail display">
      {VECTOR_BEAD_DISPLAY.map((bead) => {
        const on = enabled.has(bead.id);
        const gexOnly = bead.id === "bead-integrity-rings";
        const disabled = gexOnly && lens !== "gex";
        return (
          <button
            key={bead.id}
            type="button"
            disabled={disabled}
            onClick={() => onToggle(bead.id)}
            aria-pressed={on}
            title={disabled ? "Switch to GEX lens to show integrity rings" : bead.hint}
            {...(exposeTestIds ? { "data-testid": `vector-bead-${bead.id}` } : {})}
            className={clsx(
              "vector-desk-seg-btn",
              on && bead.id === "bead-integrity-rings" && "is-active is-bead-rings",
              on && bead.id === "bead-event-glyphs" && "is-active is-bead-events",
              disabled && "is-disabled"
            )}
          >
            {bead.toolbarLabel}
          </button>
        );
      })}
    </div>
  );
}
