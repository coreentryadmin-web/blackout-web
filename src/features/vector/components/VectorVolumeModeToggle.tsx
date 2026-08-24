"use client";

import clsx from "clsx";
import {
  VECTOR_VOLUME_MODES,
  isVectorVolumeMode,
  volumeModeLabel,
  type VectorVolumeMode,
} from "@/features/vector/lib/vector-volume-render";

type Props = {
  value: VectorVolumeMode;
  onChange: (mode: VectorVolumeMode) => void;
  exposeTestIds?: boolean;
};

const MODE_HINT: Record<VectorVolumeMode, string> = {
  relative:
    "Relative volume (RVOL) — bar height is share volume; color shows participation vs the 20-bar average (amber = climax spike).",
  pressure:
    "Buy/sell pressure — color estimates aggressive side from where price closed inside the bar range (not candle direction).",
  direction:
    "Direction — classic green/red bars matching candle up/down (legacy).",
};

/** Cycles RVOL → Pressure → Direction on the volume sub-pane. */
export function VectorVolumeModeToggle({ value, onChange, exposeTestIds = true }: Props) {
  return (
    <label className="vector-desk-seg vector-volume-mode-seg" aria-label="Volume pane style">
      <span className="vector-desk-seg-label" aria-hidden="true">
        Vol
      </span>
      <select
        className={clsx("vector-desk-seg-select", value !== "direction" && "is-volume-mode")}
        value={value}
        onChange={(e) => {
          const next = e.target.value;
          if (isVectorVolumeMode(next)) onChange(next);
        }}
        title={MODE_HINT[value]}
        {...(exposeTestIds ? { "data-testid": "vector-volume-mode-select" } : {})}
      >
        {VECTOR_VOLUME_MODES.map((mode) => (
          <option key={mode} value={mode}>
            {volumeModeLabel(mode)}
          </option>
        ))}
      </select>
    </label>
  );
}
