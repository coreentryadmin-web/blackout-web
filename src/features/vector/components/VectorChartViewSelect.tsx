"use client";

import clsx from "clsx";
import type { VectorHistoricalView } from "@/features/vector/components/VectorDailyChart";

export type VectorChartView = "intraday" | VectorHistoricalView;

const OPTIONS: { value: VectorChartView; label: string }[] = [
  { value: "intraday", label: "Intraday" },
  { value: "4H", label: "4H" },
  { value: "1D", label: "1D" },
  { value: "1W", label: "1W" },
];

type Props = {
  value: VectorChartView;
  onChange: (view: VectorChartView) => void;
  disabled?: boolean;
  idSuffix?: string;
};

/** Chart horizon — intraday session vs multi-day historical views. */
export function VectorChartViewSelect({ value, onChange, disabled = false, idSuffix = "" }: Props) {
  const selectId = `vector-chart-view${idSuffix}`;

  return (
    <div className="vector-desk-select-wrap">
      <label className="sr-only" htmlFor={selectId}>
        Chart view
      </label>
      <select
        id={selectId}
        data-testid="vector-chart-view-select"
        disabled={disabled}
        value={value}
        onChange={(e) => onChange(e.target.value as VectorChartView)}
        className={clsx("vector-desk-select vector-desk-select--view", disabled && "is-disabled")}
      >
        {OPTIONS.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    </div>
  );
}
