"use client";

import clsx from "clsx";
import {
  VECTOR_NODE_DENSITY_OPTIONS,
  nodeDensityLabel,
  parseNodeDensity,
  type VectorNodeDensity,
} from "@/features/vector/lib/vector-node-density";

type Props = {
  value: VectorNodeDensity;
  onChange: (density: VectorNodeDensity) => void;
  /** Count AUTO currently resolves to, so the AUTO option shows a real number, not a promise. */
  autoCount: number;
  /** When false, omit data-testid (the compact toolbar row duplicates desktop controls in DOM). */
  exposeTestIds?: boolean;
};

/**
 * NODES — how many strike rows (wall guides + bead trails) the chart draws per side.
 *
 * A SELECT, not a chip row (member request 2026-08-19). Six always-visible chips
 * (AUTO 6 8 12 16 20) cost more toolbar width than a control this rarely touched deserves, and
 * that width is the scarce resource on this desk — the toolbar already wraps on a laptop, and in
 * fullscreen it competes with the DTE horizon, lens and Replay clusters for one row.
 *
 * AUTO keeps the timeframe heuristic (6 rows on 1m up to 20 on 4h) and stays the default; the
 * numbers pin it. The ladder stops at 20 because that is what the recorder persists per side —
 * see vector-node-density.ts.
 */
export function VectorNodesToggle({ value, onChange, autoCount, exposeTestIds = true }: Props) {
  return (
    <label className="vector-desk-seg vector-nodes-seg" aria-label="Bead rows per side">
      <span className="vector-desk-seg-label" aria-hidden="true">
        Nodes
      </span>
      <select
        className={clsx("vector-desk-seg-select", value !== "auto" && "is-nodes")}
        value={String(value)}
        onChange={(e) => onChange(parseNodeDensity(e.target.value) ?? "auto")}
        title="How many strike rows the chart draws per side"
        {...(exposeTestIds ? { "data-testid": "vector-nodes-select" } : {})}
      >
        {VECTOR_NODE_DENSITY_OPTIONS.map((option) => (
          <option key={String(option)} value={String(option)}>
            {option === "auto" ? nodeDensityLabel("auto", autoCount) : `${option} rows`}
          </option>
        ))}
      </select>
    </label>
  );
}
