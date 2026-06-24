"use client";

import { useMemo } from "react";
import useSWR from "swr";
import { clsx } from "clsx";
import { Panel, Badge, EmptyState, Skeleton } from "@/components/ui";

/** Net dealer dollar-gamma matrix from /api/market/gex-heatmap. */
type GexHeatmapResponse = {
  available: boolean;
  underlying?: string;
  spot?: number;
  change_pct?: number;
  asof?: string;
  expiries?: string[];
  strikes?: number[];
  cells?: Record<string, Record<string, number>>;
  strike_totals?: Record<string, number>;
  zero_gamma_flip?: number | null;
  total_gex?: number;
  error?: string;
};

async function fetchGexHeatmap(url: string): Promise<GexHeatmapResponse> {
  const res = await fetch(url, {
    cache: "no-store",
    credentials: "same-origin",
    headers: { "Cache-Control": "no-cache", Pragma: "no-cache" },
  });
  if (!res.ok) throw new Error(`GEX heatmap → ${res.status}`);
  return res.json();
}

/** Compact signed dollar-gamma: $22.1K / -$45.2M. */
function fmtGamma(n: number): string {
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  if (abs >= 1_000_000_000) return `${sign}$${(abs / 1_000_000_000).toFixed(1)}B`;
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${sign}$${(abs / 1_000).toFixed(1)}K`;
  if (abs < 1) return "·";
  return `${sign}$${abs.toFixed(0)}`;
}

function fmtPct(n: number): string {
  const sign = n >= 0 ? "+" : "";
  return `${sign}${n.toFixed(2)}%`;
}

/** Format an expiry (YYYY-MM-DD) as a compact column header, e.g. "Jun 27". */
function fmtExpiry(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  if (!y || !m || !d) return ymd;
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${months[m - 1]} ${d}`;
}

/**
 * Cell background: green (positive dealer gamma) ↔ violet/purple (negative), opacity
 * scaled by magnitude relative to the matrix peak. Brand tokens only (bull / purple),
 * never grey. Returns an inline style so the alpha can vary continuously.
 */
function cellStyle(value: number, peak: number): React.CSSProperties {
  if (!value || peak <= 0) return {};
  const mag = Math.min(1, Math.abs(value) / peak);
  // Ease so small values still read; floor at 0.08 alpha, ceil ~0.6.
  const alpha = 0.08 + Math.pow(mag, 0.7) * 0.52;
  // bull #00e676 / purple #bf5fff
  const rgb = value > 0 ? "0,230,118" : "191,95,255";
  return {
    backgroundColor: `rgba(${rgb},${alpha.toFixed(3)})`,
    boxShadow: mag > 0.6 ? `inset 0 0 14px rgba(${rgb},0.25)` : undefined,
  };
}

export function GexHeatmap({ ticker = "SPY" }: { ticker?: string }) {
  const { data, isLoading, error } = useSWR<GexHeatmapResponse>(
    `/api/market/gex-heatmap?ticker=${encodeURIComponent(ticker)}`,
    fetchGexHeatmap,
    { refreshInterval: 45_000, revalidateOnFocus: false }
  );

  const live = !error && Boolean(data?.available);
  const fetchFailed = Boolean(error) && !isLoading;
  const empty = !isLoading && data != null && !data.available;

  const spot = data?.spot ?? 0;
  const expiries = useMemo(() => data?.expiries ?? [], [data?.expiries]);
  const strikes = useMemo(() => data?.strikes ?? [], [data?.strikes]);
  const cells = data?.cells ?? {};
  const strikeTotals = data?.strike_totals ?? {};
  const flip = data?.zero_gamma_flip ?? null;

  // Peak magnitude across all cells drives the color scale.
  const peak = useMemo(() => {
    let p = 0;
    for (const row of Object.values(cells)) {
      for (const v of Object.values(row)) {
        const a = Math.abs(v);
        if (a > p) p = a;
      }
    }
    return p;
  }, [cells]);

  const totalPeak = useMemo(() => {
    let p = 0;
    for (const v of Object.values(strikeTotals)) {
      const a = Math.abs(v);
      if (a > p) p = a;
    }
    return p;
  }, [strikeTotals]);

  // The strike row nearest spot — highlighted as the "spot" band.
  const spotStrike = useMemo(() => {
    if (!(spot > 0) || strikes.length === 0) return null;
    return strikes.reduce((best, s) =>
      Math.abs(s - spot) < Math.abs(best - spot) ? s : best
    );
  }, [strikes, spot]);

  // The strike row nearest the zero-gamma flip — gets the flip marker.
  const flipStrike = useMemo(() => {
    if (flip == null || strikes.length === 0) return null;
    return strikes.reduce((best, s) =>
      Math.abs(s - flip) < Math.abs(best - flip) ? s : best
    );
  }, [strikes, flip]);

  const changePct = data?.change_pct ?? 0;
  const changeBull = changePct >= 0;

  return (
    <Panel
      accent="bull"
      kicker="Dealer gamma exposure · Polygon options"
      title={
        <span className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span>{data?.underlying ?? ticker} GEX Heatmap</span>
          {live && spot > 0 && (
            <>
              <span className="font-mono text-sm font-semibold text-white">
                {spot.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </span>
              <span className={clsx("font-mono text-xs font-bold", changeBull ? "text-bull" : "text-bear")}>
                {fmtPct(changePct)}
              </span>
            </>
          )}
        </span>
      }
      actions={
        live ? (
          <Badge tone="bull" dot>
            Live
          </Badge>
        ) : (
          <Badge tone="neutral">Offline</Badge>
        )
      }
    >
      {fetchFailed && (
        <div
          role="alert"
          className="mb-4 flex items-center gap-2 rounded-xl border border-bear/40 bg-bear/[0.08] px-4 py-3"
          style={{ boxShadow: "inset 0 0 16px rgba(255,45,85,0.06)" }}
        >
          <span className="text-bear text-sm leading-none">⚠</span>
          <span className="font-mono text-[12px] font-bold text-bear tracking-wide">
            GEX feed unavailable — retrying
          </span>
        </div>
      )}

      {isLoading && !data ? (
        <div className="space-y-2" aria-hidden>
          <Skeleton height={28} rounded="lg" />
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} height={30} rounded="md" />
          ))}
        </div>
      ) : empty || strikes.length === 0 ? (
        <EmptyState
          icon="◆"
          title="GAMMA MATRIX IDLE"
          description="The dealer gamma surface prints from the live options chain during RTH. Standby until the bell."
        />
      ) : (
        <>
          {/* Legend */}
          <div className="mb-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-[10px] font-mono uppercase tracking-widest">
            <span className="flex items-center gap-1.5 text-sky-300">
              <span className="inline-block h-3 w-3 rounded-sm" style={{ backgroundColor: "rgba(0,230,118,0.5)" }} />
              Long gamma (+)
            </span>
            <span className="flex items-center gap-1.5 text-sky-300">
              <span className="inline-block h-3 w-3 rounded-sm" style={{ backgroundColor: "rgba(191,95,255,0.5)" }} />
              Short gamma (−)
            </span>
            {flip != null && (
              <span className="flex items-center gap-1.5 text-gold">
                <span aria-hidden>◀ flip</span>
                <span className="text-white">{flip.toLocaleString("en-US", { maximumFractionDigits: 0 })}</span>
              </span>
            )}
            {spot > 0 && (
              <span className="flex items-center gap-1.5 text-cyan-400">
                <span aria-hidden>● spot</span>
              </span>
            )}
          </div>

          <div
            className="overflow-x-auto"
            role="region"
            aria-label={`${data?.underlying ?? ticker} dealer gamma exposure heatmap, strikes by expiration`}
          >
            <table className="w-full border-separate border-spacing-0 font-mono text-[11px]">
              <thead>
                <tr>
                  <th className="sticky left-0 z-10 bg-[rgba(8,9,14,0.92)] px-2 py-2 text-left text-[10px] uppercase tracking-widest text-cyan-400 backdrop-blur">
                    Strike
                  </th>
                  {expiries.map((e) => (
                    <th
                      key={e}
                      className="whitespace-nowrap px-2 py-2 text-center text-[10px] uppercase tracking-wide text-sky-300"
                    >
                      {fmtExpiry(e)}
                    </th>
                  ))}
                  <th className="whitespace-nowrap px-2 py-2 text-right text-[10px] uppercase tracking-wide text-cyan-400">
                    Net
                  </th>
                </tr>
              </thead>
              <tbody>
                {strikes.map((strike) => {
                  const row = cells[String(strike)] ?? {};
                  const isSpot = strike === spotStrike;
                  const isFlip = strike === flipStrike;
                  const total = strikeTotals[String(strike)] ?? 0;
                  return (
                    <tr
                      key={strike}
                      className={clsx(
                        isSpot && "outline outline-1 outline-cyan-400/70",
                      )}
                    >
                      <th
                        scope="row"
                        className={clsx(
                          "sticky left-0 z-10 whitespace-nowrap px-2 py-1.5 text-left font-semibold tabular-nums backdrop-blur",
                          isSpot
                            ? "bg-cyan-400/[0.12] text-white"
                            : isFlip
                              ? "bg-gold/[0.10] text-gold"
                              : "bg-[rgba(8,9,14,0.92)] text-white"
                        )}
                      >
                        <span className="inline-flex items-center gap-1">
                          {isSpot && <span aria-hidden className="text-cyan-400">●</span>}
                          {isFlip && !isSpot && <span aria-hidden className="text-gold">◀</span>}
                          {strike.toLocaleString("en-US", { maximumFractionDigits: 0 })}
                        </span>
                      </th>
                      {expiries.map((e) => {
                        const v = row[e];
                        const has = typeof v === "number";
                        return (
                          <td
                            key={e}
                            className={clsx(
                              "whitespace-nowrap px-2 py-1.5 text-center tabular-nums",
                              has ? (v > 0 ? "text-bull" : "text-purple-light") : "text-sky-300/30"
                            )}
                            style={has ? cellStyle(v, peak) : undefined}
                            title={has ? `${strike} · ${fmtExpiry(e)} · ${fmtGamma(v)}` : undefined}
                          >
                            {has ? fmtGamma(v) : "·"}
                          </td>
                        );
                      })}
                      <td
                        className={clsx(
                          "whitespace-nowrap px-2 py-1.5 text-right font-semibold tabular-nums",
                          total > 0 ? "text-bull" : total < 0 ? "text-purple-light" : "text-sky-300/40"
                        )}
                        style={total ? cellStyle(total, totalPeak) : undefined}
                      >
                        {total ? fmtGamma(total) : "·"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <p className="mt-3 text-[10px] font-mono uppercase tracking-widest text-sky-300/60">
            Net dealer $-gamma per strike × expiry · green long / violet short · total{" "}
            <span className={clsx((data?.total_gex ?? 0) >= 0 ? "text-bull" : "text-purple-light")}>
              {fmtGamma(data?.total_gex ?? 0)}
            </span>
          </p>
        </>
      )}
    </Panel>
  );
}
