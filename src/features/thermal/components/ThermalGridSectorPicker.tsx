"use client";

import { clsx } from "clsx";
import {
  THERMAL_COMPARE_PRESETS,
  type ThermalComparePresetId,
} from "@/features/thermal/lib/thermal-compare-presets";

type Props = {
  value: ThermalComparePresetId;
  onChange: (id: ThermalComparePresetId) => void;
  compact?: boolean;
  nativeShell?: boolean;
  className?: string;
};

/** Desk-native sector picker — matches Grid / lens chip styling (not a raw OS select). */
export function ThermalGridSectorPicker({
  value,
  onChange,
  compact = false,
  nativeShell = false,
  className,
}: Props) {
  const current = THERMAL_COMPARE_PRESETS.find((p) => p.id === value)?.label ?? value;
  return (
    <label
      className={clsx(
        "thermal-grid-sector-picker",
        compact && "thermal-grid-sector-picker--compact",
        nativeShell && "thermal-grid-sector-picker--native",
        className,
      )}
    >
      <span className="thermal-grid-sector-picker-value">{current}</span>
      <span className="thermal-grid-sector-picker-chevron" aria-hidden>
        ▾
      </span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as ThermalComparePresetId)}
        className="thermal-grid-sector-picker-select"
        aria-label="Sector compare preset"
      >
        {THERMAL_COMPARE_PRESETS.map((p) => (
          <option key={p.id} value={p.id}>
            {p.label}
          </option>
        ))}
      </select>
    </label>
  );
}
