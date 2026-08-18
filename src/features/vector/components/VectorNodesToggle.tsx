"use client";

import clsx from "clsx";
import {
  VECTOR_NODE_DENSITY_OPTIONS,
  nodeDensityLabel,
  type VectorNodeDensity,
} from "@/features/vector/lib/vector-node-density";

type Props = {
  value: VectorNodeDensity;
  onChange: (density: VectorNodeDensity) => void;
  /** Count AUTO currently resolves to, so the AUTO chip shows a real number, not a promise. */
  autoCount: number;
  /** When false, omit data-testid (the compact toolbar row duplicates desktop controls in DOM). */
  exposeTestIds?: boolean;
};

/**
 * NODES — how many strike rows (wall guides + bead trails) the chart draws per side.
 *
 * AUTO keeps the timeframe heuristic (6 rows on 1m up to 20 on 4h); the numbers pin it. The ladder
 * stops at 20 because that is what the recorder persists per side — see vector-node-density.ts.
 */
export function VectorNodesToggle({ value, onChange, autoCount, exposeTestIds = true }: Props) {
  return (
    <div className="vector-desk-seg vector-nodes-seg" role="group" aria-label="Bead rows per side">
      <span className="vector-desk-seg-label" aria-hidden="true">
        Nodes
      </span>
      {VECTOR_NODE_DENSITY_OPTIONS.map((option) => {
        const on = option === value;
        return (
          <button
            key={String(option)}
            type="button"
            onClick={() => onChange(option)}
            aria-pressed={on}
            title={
              option === "auto"
                ? `Follow the timeframe (currently ${autoCount} rows per side)`
                : `Pin ${option} wall rows per side`
            }
            {...(exposeTestIds ? { "data-testid": `vector-nodes-${option}` } : {})}
            // `is-active` alone is unstyled in this design system — every segment carries its own
            // active variant (is-gex / is-vex / is-dte / …), so NODES gets `is-nodes`.
            className={clsx("vector-desk-seg-btn", on && "is-active is-nodes")}
          >
            {option === "auto" ? nodeDensityLabel("auto", autoCount) : option}
          </button>
        );
      })}
    </div>
  );
}
