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

/** Chart horizon — intraday session vs multi-day historical views. Segmented control so the
 *  active view stays visible when the intraday chart unmounts for 1D/4H/1W. */
export function VectorChartViewSelect({ value, onChange, disabled = false, idSuffix = "" }: Props) {
  const groupId = `vector-chart-view${idSuffix}`;

  return (
    <div
      className="vector-desk-seg vector-chart-view-seg"
      role="group"
      aria-label="Chart view"
      id={groupId}
      data-testid="vector-chart-view-select"
    >
      {OPTIONS.map((opt) => {
        const active = value === opt.value;
        return (
          <button
            key={opt.value}
            type="button"
            disabled={disabled}
            aria-pressed={active}
            data-testid={`vector-chart-view-${opt.value.toLowerCase()}`}
            className={clsx(
              "vector-desk-seg-btn",
              active && "is-active",
              disabled && "is-disabled"
            )}
            onClick={() => onChange(opt.value)}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
