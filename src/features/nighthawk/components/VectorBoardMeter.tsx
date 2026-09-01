"use client";

import { clsx } from "clsx";
import type { VectorBoardMeter as VectorBoardMeterData } from "@/features/nighthawk/lib/vector-board-table-utils";

const EM = "—";

/** X Ads "Budget remaining" meter — value on top, thin bar, percent below. */
export function VectorBoardMeter({
  meter,
  compact = false,
}: {
  meter: VectorBoardMeterData | null;
  compact?: boolean;
}) {
  if (!meter) {
    return <span className="vector-board-em">{EM}</span>;
  }

  return (
    <div className={clsx("vector-board-meter", compact && "is-compact")} title={meter.caption}>
      <span className={clsx("vector-board-meter-value tabular-nums", `is-${meter.tone}`)}>
        {meter.valueLabel}
      </span>
      <div className="vector-board-meter-track" aria-hidden>
        <div
          className={clsx("vector-board-meter-fill", `is-${meter.tone}`)}
          style={{ width: `${meter.fillPct}%` }}
        />
      </div>
      <span className="vector-board-meter-caption tabular-nums">{meter.caption}</span>
    </div>
  );
}
