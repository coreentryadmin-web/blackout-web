"use client";

import { useEffect, useState } from "react";
import { fmtPrice } from "@/lib/api";
import {
  screenUniverse,
  screenerRegimeOf,
  type ScreenerPreset,
} from "@/features/vector/lib/vector-screener";
import { useVectorUniverseSnapshot } from "@/features/vector/lib/vector-universe-client";
import { formatVectorAge } from "@/features/vector/lib/vector-age-format";

/** Past this age the snapshot is old enough to call out — the universe cache tolerates one
 *  missed 5-minute cron run by design, so anything past two runs is worth a visible flag rather
 *  than silently rendering an unchanged table that looks indistinguishable from a live scan. */
const VECTOR_SCANNER_STALE_MS = 10 * 60 * 1000;

type Props = {
  activeTicker: string;
  onSelect: (ticker: string) => void;
};

/** Signed distance from spot to a level, in %, for the proximity read. */
function distPct(spot: number | null, level: number | null): number | null {
  if (spot == null || level == null || spot <= 0) return null;
  return ((level - spot) / spot) * 100;
}

function fmtDist(pct: number | null): string {
  if (pct == null) return "—";
  const s = pct >= 0 ? "+" : "";
  return `${s}${pct.toFixed(1)}%`;
}

const PRESETS: Array<{ key: ScreenerPreset; label: string; hint: string }> = [
  { key: "all", label: "All", hint: "Every covered name, A–Z" },
  { key: "nearest-flip", label: "Nearest flip", hint: "Closest to a regime change — most actionable" },
  { key: "most-pinned", label: "Most pinned", hint: "Above flip with the strongest walls — mean-revert" },
  { key: "most-explosive", label: "Most explosive", hint: "Below flip and near it — vol-expansion risk" },
];

export function VectorScanner({ activeTicker, onSelect }: Props) {
  const { data, error, isLoading } = useVectorUniverseSnapshot();
  const [preset, setPreset] = useState<ScreenerPreset>("all");
  const [now, setNow] = useState<number | null>(null);

  // BUG FIX (2026-08-27): the universe snapshot's `updatedAt` was plumbed all the way to the
  // client (server comment: "for consumers to age-gate" against a 48h Redis TTL — "staleness is
  // disclosed, not hidden via expiry") but nothing ever rendered it. If the 5-minute rebuild cron
  // stops firing, this table keeps showing the last cached scan, unchanged, for up to 48 hours
  // with zero visual difference from a live one — a member has no way to tell a frozen scan from
  // a live scan just by looking at it.
  useEffect(() => {
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  if (isLoading && !data) {
    return (
      <p className="vector-scanner-note" role="status">
        Loading universe…
      </p>
    );
  }

  if (error || !data?.rows?.length) {
    return (
      <p className="vector-scanner-note" role="status">
        Universe snapshot unavailable — pick a symbol above.
      </p>
    );
  }

  const activePreset = PRESETS.find((p) => p.key === preset) ?? PRESETS[0]!;
  const displayRows = screenUniverse(data.rows, { preset });
  const age = formatVectorAge(data.updatedAt, now);
  const isStale = now != null && data.updatedAt > 0 && now - data.updatedAt >= VECTOR_SCANNER_STALE_MS;

  return (
    <div className="vector-scanner-table-wrap">
      <div className="vector-screener-controls" role="group" aria-label="Screener view">
        {PRESETS.map((p) => (
          <button
            key={p.key}
            type="button"
            className={`vector-screener-chip${p.key === preset ? " is-active" : ""}`}
            aria-pressed={p.key === preset}
            title={p.hint}
            onClick={() => setPreset(p.key)}
          >
            {p.label}
          </button>
        ))}
        <span className="vector-screener-hint">{activePreset.hint}</span>
        {age != null && (
          <span
            className={`vector-screener-age${isStale ? " is-stale" : ""}`}
            title={isStale ? "Universe scan hasn't refreshed recently — showing the last cached snapshot" : "Universe scan age"}
          >
            {isStale ? "⚠ " : ""}Updated {age} ago
          </span>
        )}
      </div>
      {displayRows.length === 0 && (
        <p className="vector-scanner-note" role="status">
          No names match “{activePreset.label}” right now.
        </p>
      )}
      <table className="vector-scanner-table">
        <thead>
          <tr>
            <th scope="col">Ticker</th>
            <th scope="col" className="vs-num">Spot</th>
            <th scope="col" className="vs-num">Regime</th>
            <th scope="col" className="vs-num">Gamma flip</th>
            <th scope="col" className="vs-num">Call wall</th>
            <th scope="col" className="vs-num">Put wall</th>
          </tr>
        </thead>
        <tbody>
          {displayRows.map((row) => {
            const selected = row.ticker === activeTicker;
            const regime = screenerRegimeOf(row);
            const flipDist = distPct(row.spot, row.gammaFlip);
            const callDist = distPct(row.spot, row.topCallWall);
            const putDist = distPct(row.spot, row.topPutWall);
            return (
              <tr
                key={row.ticker}
                className={`vector-scanner-row vs-regime-${regime}${selected ? " is-active" : ""}`}
                onClick={() => onSelect(row.ticker)}
                aria-current={selected ? "true" : undefined}
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onSelect(row.ticker);
                  }
                }}
              >
                <td className="vs-ticker">
                  <span className="vs-regime-dot" aria-hidden="true" />
                  {row.ticker}
                </td>
                <td className="vs-num">{fmtPrice(row.spot)}</td>
                <td className="vs-num">
                  <span className={`vs-regime-tag vs-regime-tag-${regime}`}>
                    {regime === "above" ? "▲ above" : regime === "below" ? "▼ below" : "—"}
                  </span>
                </td>
                <td className="vs-num">
                  {fmtPrice(row.gammaFlip)}
                  <span className="vs-dist">{fmtDist(flipDist)}</span>
                </td>
                <td className="vs-num vs-call">
                  {fmtPrice(row.topCallWall)}
                  <span className="vs-dist">{fmtDist(callDist)}</span>
                </td>
                <td className="vs-num vs-put">
                  {fmtPrice(row.topPutWall)}
                  <span className="vs-dist">{fmtDist(putDist)}</span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
