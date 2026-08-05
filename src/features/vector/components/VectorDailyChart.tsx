"use client";

import { useEffect, useRef, useState } from "react";
import clsx from "clsx";
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
import { VECTOR_DAILY_UNITS, type VectorDailyUnit } from "@/features/vector/lib/vector-daily-bars";
import type { VectorOhlcBar } from "@/features/vector/lib/vector-bar-timeframes";

const VOLUME_UP = "rgba(0, 230, 118, 0.55)";
const VOLUME_DOWN = "rgba(255, 45, 85, 0.55)";
const SMA50_COLOR = "#38bdf8";
const SMA200_COLOR = "#f472b6";

type Props = {
  ticker: string;
};

type DailyBarsResponse = { ticker: string; unit: VectorDailyUnit; bars: VectorOhlcBar[] };

function unitLabel(u: VectorDailyUnit): string {
  return u === "1D" ? "1D" : "1W";
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
 * Daily/Weekly historical price view (CTO audit P2 #5) — a separate, deliberately simple chart
 * surface from `VectorChart.tsx` rather than a mode bolted onto it. `VectorChart` is already the
 * highest-risk file in the feature (per the CTO audit's own P3 recommendation to split it, not
 * grow it further); daily/weekly bars are also a genuinely different data source (Polygon daily
 * aggs, not the 1m intraday seed) with no live SSE, no wall-history/beads, and no replay — none of
 * which have any meaning on a multi-month daily candle. Keeping this as its own small component
 * avoids threading a second data mode through VectorChart's ~3800 lines of intraday-only state.
 *
 * Shows candles + volume + SMA50/SMA200 (indicators that generalize to any bar series, reusing the
 * exact same pure `smaSeries` VectorChart's intraday MAs use). No GEX walls/beads/max-pain/expected
 * move here — those are intraday dealer-positioning reads with nothing to show on daily bars, and
 * the honest thing is to say so, not to omit them silently or fake a daily equivalent.
 */
export function VectorDailyChart({ ticker }: Props) {
  const [unit, setUnit] = useState<VectorDailyUnit>("1D");
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
        const res = await fetch(
          `/api/market/vector/daily-bars?ticker=${encodeURIComponent(ticker)}&unit=${unit}`
        );
        if (cancelled) return;
        if (!res.ok) {
          setState("error");
          return;
        }
        const data = (await res.json()) as DailyBarsResponse;
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
        <div className="vector-daily-chart-unit-toggle" role="group" aria-label="Daily/weekly interval">
          {VECTOR_DAILY_UNITS.map((u) => (
            <button
              key={u}
              type="button"
              onClick={() => setUnit(u)}
              className={clsx("vector-daily-chart-unit-btn", u === unit && "is-active")}
            >
              {unitLabel(u)}
            </button>
          ))}
        </div>
        <span className="vector-daily-chart-note">
          Historical price — GEX walls, beads, and replay are intraday-only and not shown here.
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
