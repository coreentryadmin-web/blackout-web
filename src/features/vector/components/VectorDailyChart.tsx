"use client";

import { useEffect, useRef, useState } from "react";
import {
  createChart,
  CandlestickSeries,
  HistogramSeries,
  LineSeries,
  ColorType,
  type HistogramData,
  type IChartApi,
  type ISeriesApi,
  type Time,
} from "lightweight-charts";
import { VECTOR_CHART_LOCALE } from "@/features/vector/lib/vector-chart-config";
import { smaSeries } from "@/features/vector/lib/vector-indicators";
import type { VectorDailyUnit } from "@/features/vector/lib/vector-daily-bars";
import type { VectorOhlcBar } from "@/features/vector/lib/vector-bar-timeframes";

const VOLUME_UP = "rgba(0, 230, 118, 0.55)";
const VOLUME_DOWN = "rgba(255, 45, 85, 0.55)";
const SMA50_COLOR = "#38bdf8";
const SMA200_COLOR = "#f472b6";

/** Historical (non-intraday-SSE) chart views this component can render: daily/weekly candles
 *  (`VectorDailyUnit`, Polygon daily aggs) plus "4H" (CTO audit P2 — multi-day intraday minute
 *  bars aggregated to 4h, see `vector-4h-bars.ts`). Widened from `VectorDailyUnit` alone so one
 *  component serves both instead of a near-duplicate 4h-only component; the fetch endpoint is
 *  the only thing that actually differs per view (see `endpointFor` below). */
export type VectorHistoricalView = VectorDailyUnit | "4H";

type Props = {
  ticker: string;
  /** Driven by the page shell's Intraday/1D/1W/4H toggle — this component has no toggle of its
   * own. It used to own a second, identically-labelled 1D/1W control that the outer toggle
   * didn't drive, so switching the page to "1W" silently left the chart on daily candles
   * (2026-08-05 live-UI audit: reported directly by a user confused by the two stacked,
   * disconnected toggles). One control now owns the view; this component just renders it. */
  unit: VectorHistoricalView;
};

type BarsResponse = { ticker: string; unit: string; bars: VectorOhlcBar[] };

function unitLabel(u: VectorHistoricalView): string {
  return u;
}

/** Endpoint for a given historical view. "4H" hits its own multi-day-intraday route
 *  (`/api/market/vector/4h-bars`) rather than `daily-bars` — a materially different upstream
 *  fetch (many days of 1m bars vs. Polygon daily aggs), not just a different `unit=` query
 *  value on the same route. See `4h-bars/route.ts`'s header comment for why. */
function endpointFor(ticker: string, unit: VectorHistoricalView): string {
  const t = encodeURIComponent(ticker);
  if (unit === "4H") return `/api/market/vector/4h-bars?ticker=${t}`;
  return `/api/market/vector/daily-bars?ticker=${t}&unit=${unit}`;
}

function lineData(bars: VectorOhlcBar[], values: (number | null)[]) {
  const out: { time: Time; value: number }[] = [];
  for (let i = 0; i < bars.length; i++) {
    const v = values[i];
    if (v != null) out.push({ time: bars[i]!.time as Time, value: v });
  }
  return out;
}

/**
 * Daily/Weekly/4H historical price view (CTO audit P2 #5, and P2 "4h remains open" 2026-08-05)
 * — a separate, deliberately simple chart surface from `VectorChart.tsx` rather than a mode
 * bolted onto it. `VectorChart` is already the highest-risk file in the feature (per the CTO
 * audit's own P3 recommendation to split it, not grow it further); 1D/1W/4H bars are also a
 * genuinely different data source (Polygon daily aggs for 1D/1W, multi-day aggregated intraday
 * minute bars for 4H — see `vector-4h-bars.ts` — neither is the live 1m intraday seed) with no
 * live SSE, no wall-history/beads, and no replay — none of which have any meaning on a
 * multi-session or multi-month candle. Keeping this as its own small component avoids threading
 * a second (now third) data mode through VectorChart's ~3800 lines of intraday-only state.
 *
 * Shows candles + volume + SMA50/SMA200 (indicators that generalize to any bar series, reusing the
 * exact same pure `smaSeries` VectorChart's intraday MAs use) for all three views. No GEX
 * walls/beads/max-pain/expected move here — those are intraday dealer-positioning reads with
 * nothing to show on daily or 4h bars, and the honest thing is to say so, not to omit them
 * silently or fake an equivalent.
 */
export function VectorDailyChart({ ticker, unit }: Props) {
  const [bars, setBars] = useState<VectorOhlcBar[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const volumeSeriesRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  const sma50SeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const sma200SeriesRef = useRef<ISeriesApi<"Line"> | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const chart = createChart(container, {
      autoSize: true,
      layout: { background: { type: ColorType.Solid, color: "transparent" }, textColor: "#94a3b8" },
      grid: {
        vertLines: { color: "rgba(148, 163, 184, 0.08)" },
        horzLines: { color: "rgba(148, 163, 184, 0.08)" },
      },
      rightPriceScale: { borderColor: "rgba(148, 163, 184, 0.15)" },
      timeScale: { borderColor: "rgba(148, 163, 184, 0.15)" },
      localization: { locale: VECTOR_CHART_LOCALE },
    });
    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: "#00e676",
      downColor: "#ff2d55",
      borderVisible: false,
      wickUpColor: "#00e676",
      wickDownColor: "#ff2d55",
    });
    const volumeSeries = chart.addSeries(HistogramSeries, {
      priceFormat: { type: "volume" },
      priceScaleId: "vector-daily-volume",
    });
    chart.priceScale("vector-daily-volume").applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
    const sma50 = chart.addSeries(LineSeries, { color: SMA50_COLOR, lineWidth: 1, priceLineVisible: false });
    const sma200 = chart.addSeries(LineSeries, { color: SMA200_COLOR, lineWidth: 1, priceLineVisible: false });

    chartRef.current = chart;
    candleSeriesRef.current = candleSeries;
    volumeSeriesRef.current = volumeSeries;
    sma50SeriesRef.current = sma50;
    sma200SeriesRef.current = sma200;

    return () => {
      chart.remove();
      chartRef.current = null;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    setState("loading");
    const load = async () => {
      try {
        const res = await fetch(endpointFor(ticker, unit));
        if (cancelled) return;
        if (!res.ok) {
          setState("error");
          return;
        }
        const data = (await res.json()) as BarsResponse;
        if (cancelled) return;
        setBars(data.bars ?? []);
        setState((data.bars ?? []).length ? "ready" : "error");
      } catch {
        if (!cancelled) setState("error");
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [ticker, unit]);

  useEffect(() => {
    const candleSeries = candleSeriesRef.current;
    const volumeSeries = volumeSeriesRef.current;
    if (!candleSeries || !volumeSeries) return;
    candleSeries.setData(bars as never);
    const volumeData: HistogramData<Time>[] = [];
    for (const bar of bars) {
      if (bar.volume == null || bar.volume <= 0) continue;
      volumeData.push({
        time: bar.time as Time,
        value: bar.volume,
        color: bar.close >= bar.open ? VOLUME_UP : VOLUME_DOWN,
      });
    }
    volumeSeries.setData(volumeData);
    const closes = bars.map((b) => b.close);
    sma50SeriesRef.current?.setData(lineData(bars, smaSeries(closes, 50)));
    sma200SeriesRef.current?.setData(lineData(bars, smaSeries(closes, 200)));
    chartRef.current?.timeScale().fitContent();
  }, [bars]);

  return (
    <div className="vector-daily-chart" data-testid="vector-daily-chart">
      <div className="vector-daily-chart-head">
        <span className="vector-daily-chart-note">
          {unitLabel(unit)} historical price — GEX walls, beads, and replay are intraday-only and
          not shown here.
        </span>
      </div>
      <div className="vector-daily-chart-canvas-wrap">
        <div ref={containerRef} className="vector-daily-chart-canvas" />
        {state === "loading" && (
          <div className="vector-daily-chart-overlay">Loading {unitLabel(unit)} history…</div>
        )}
        {state === "error" && (
          <div className="vector-daily-chart-overlay">No historical data available for {ticker}</div>
        )}
      </div>
    </div>
  );
}
