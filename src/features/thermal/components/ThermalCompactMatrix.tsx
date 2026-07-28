"use client";

import type { CSSProperties } from "react";
import type { GexHeatmapLens } from "@/lib/gex-heatmap-display";
import {
  heatmapCellStyle,
  heatmapCellTextStyle,
} from "@/lib/gex-heatmap-display";
import {
  bandStrikesAroundSpot,
  compactMatrixPeak,
  fmtCompactExpiry,
  fmtCompactHeatMoney,
  nearestStrikeIndex,
  resolveCompactExpiries,
} from "@/features/thermal/lib/thermal-compact-matrix";

export type ThermalCompactPayload = {
  ticker: string;
  spot?: number | null;
  strikes: number[];
  expiries: string[];
  nearTermExpiries?: string[] | null;
  cells: Record<string, Record<string, number>>;
};

type Props = {
  data: ThermalCompactPayload;
  lens: GexHeatmapLens;
  pinnedStrikes: number[];
  onTogglePin: (strike: number) => void;
};

export default function ThermalCompactMatrix({
  data,
  lens,
  pinnedStrikes,
  onTogglePin,
}: Props) {
  const expiries = resolveCompactExpiries(data.nearTermExpiries, data.expiries, 8);
  const strikes = bandStrikesAroundSpot(data.strikes, data.spot, 14);
  const spotIdx = nearestStrikeIndex(strikes, data.spot ?? null);
  const pinSet = new Set(pinnedStrikes);
  const peak = compactMatrixPeak(data.cells, strikes, expiries);

  if (expiries.length === 0 || strikes.length === 0) {
    return (
      <div className="thermal-compact-empty" role="status">
        Matrix empty — waiting for live cells.
      </div>
    );
  }

  return (
    <div className="thermal-compact-scroll is-dense">
      <table
        className="thermal-compact-table"
        aria-label={`${data.ticker} ${lens.toUpperCase()} matrix`}
      >
        <thead>
          <tr>
            <th className="thermal-compact-corner" scope="col">
              K
            </th>
            {expiries.map((exp) => (
              <th key={exp} className="thermal-compact-exp" scope="col" title={exp}>
                {fmtCompactExpiry(exp)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {strikes.map((strike, si) => {
            const isSpot = si === spotIdx;
            const pinned = pinSet.has(strike);
            const row = data.cells[String(strike)] ?? {};
            return (
              <tr
                key={strike}
                className={[
                  "thermal-compact-row",
                  isSpot ? "is-spot" : "",
                  pinned ? "is-pinned" : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
              >
                <th scope="row" className="thermal-compact-strike">
                  <button
                    type="button"
                    className="thermal-compact-strike-btn"
                    onClick={() => onTogglePin(strike)}
                    title={pinned ? `Unpin ${strike}` : `Pin ${strike}`}
                    aria-pressed={pinned}
                  >
                    <span className="thermal-compact-pin" aria-hidden>
                      {pinned ? "◆" : "◇"}
                    </span>
                    {Number.isFinite(strike)
                      ? strike.toFixed(strike % 1 === 0 ? 0 : 1)
                      : "—"}
                  </button>
                </th>
                {expiries.map((exp) => {
                  const val = row[exp];
                  const n = typeof val === "number" && Number.isFinite(val) ? val : 0;
                  const style: CSSProperties = {
                    ...heatmapCellStyle(n, peak, lens),
                    ...heatmapCellTextStyle(n, peak),
                  };
                  return (
                    <td
                      key={`${strike}-${exp}`}
                      className="thermal-compact-cell"
                      style={style}
                      title={`${data.ticker} ${strike} ${exp} · ${lens.toUpperCase()} ${fmtCompactHeatMoney(n)}`}
                    >
                      <span className="thermal-compact-cell-val">
                        {fmtCompactHeatMoney(n)}
                      </span>
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
