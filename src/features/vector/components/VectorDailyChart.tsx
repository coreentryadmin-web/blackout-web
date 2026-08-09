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
  createSeriesMarkers,
  type Time,
} from "lightweight-charts";
import { VECTOR_CHART_LOCALE } from "@/features/vector/lib/vector-chart-config";
import { smaSeries } from "@/features/vector/lib/vector-indicators";
import type { VectorDailyUnit } from "@/features/vector/lib/vector-daily-bars";
import {
  VECTOR_ZOOM_PRESETS,
  VECTOR_ZOOM_STORAGE_KEY,
  initialLogicalRange,
  isIndexTicker,
  readPersisted,
  writePersisted,
  zoomPresetBars,
  type VectorZoomPreset,
} from "@/features/vector/lib/vector-chart-view";
import type { VectorOhlcBar } from "@/features/vector/lib/vector-bar-timeframes";
import { isQuarterlyOpex, opexDatesInRange } from "@/features/vector/lib/vector-opex";

const VOLUME_UP = "rgba(0, 230, 118, 0.55)";
const VOLUME_DOWN = "rgba(255, 45, 85, 0.55)";
const SMA50_COLOR = "#38bdf8";
const SMA200_COLOR = "#f472b6";
/* Brand tokens (see scripts/check-brand.mjs): gold for the monthly, cyan for the heavier
   quarterly, so OPEX never reads as a bull/bear signal — it is a calendar fact, not a direction. */
const OPEX_MONTHLY = "#ffd23f";
const OPEX_QUARTERLY = "#22d3ee";

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
  /** Emits the price under the crosshair (null when the cursor leaves the plot), so the GEX
   *  ladder beside this chart can highlight the strike at that level. */
  onHoverPrice?: (price: number | null) => void;
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
 * Frame the chart for the active zoom preset.
 *
 * "ALL" and any preset wider than the loaded history both fall through to the default recent
 * window (or fitContent for short histories) rather than pinning a range past the data, which
 * would render dead space on the left.
 */
function applyZoom(
  chart: IChartApi | null,
  barCount: number,
  unit: VectorHistoricalView,
  zoom: VectorZoomPreset
): void {
  if (!chart || barCount <= 0) return;
  const want = zoomPresetBars(zoom, unit);
  if (want != null && want < barCount) {
    chart.timeScale().setVisibleLogicalRange({ from: barCount - want, to: barCount + 1 });
    return;
  }
  if (zoom === "ALL") {
    chart.timeScale().fitContent();
    return;
  }
  const range = initialLogicalRange(barCount, unit);
  if (range) chart.timeScale().setVisibleLogicalRange(range);
  else chart.timeScale().fitContent();
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
export function VectorDailyChart({ ticker, unit, onHoverPrice }: Props) {
  const [bars, setBars] = useState<VectorOhlcBar[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  // Lazy initialiser: localStorage is unavailable during SSR, and reading it in a plain
  // useState(...) call would run on the server and throw. This runs client-side on first paint.
  const [zoom, setZoom] = useState<VectorZoomPreset>(() =>
    readPersisted(VECTOR_ZOOM_STORAGE_KEY, VECTOR_ZOOM_PRESETS, "ALL")
  );
  const [showOpex, setShowOpex] = useState(true);
  const [hover, setHover] = useState<
    { open: number; high: number; low: number; close: number; changePct: number } | null
  >(null);
  // Held in a ref so the chart-creation effect keeps its empty dependency list. Taking
  // onHoverPrice as a direct dependency would tear down and rebuild the entire chart every time
  // the parent re-rendered with a new function identity — which it does on every hover.
  const onHoverPriceRef = useRef(onHoverPrice);
  onHoverPriceRef.current = onHoverPrice;
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

    // Crosshair readout. Reading OHLC off the event (not off `bars`) keeps this effect free of
    // the bars dependency, so the chart is never torn down and rebuilt just because data arrived.
    chart.subscribeCrosshairMove((param) => {
      const d = param.seriesData.get(candleSeries) as
        | { open: number; high: number; low: number; close: number }
        | undefined;
      if (!param.time || !d) {
        setHover(null);
        onHoverPriceRef.current?.(null);
        return;
      }
      // Price under the CURSOR, not the bar close — the ladder should highlight the level the
      // member is pointing at, which is the whole point of linking the two panels.
      const y = param.point?.y;
      onHoverPriceRef.current?.(
        y == null ? null : (candleSeries.coordinateToPrice(y) as number | null)
      );
      setHover({
        ...d,
        changePct: d.open ? ((d.close - d.open) / d.open) * 100 : 0,
      });
    });

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

    // Frame the most RECENT window rather than every loaded bar. fitContent() squeezed the full
    // ~2-year history (which the 200-SMA requires us to FETCH) into the canvas at ~1.8px per
    // candle — legible as a trend line, useless as candles. The history is still loaded and one
    // scroll away; only the initial viewport changed. Falls back to fitContent when the history
    // is shorter than the window, where pinning would leave dead space.
    // OPEX verticals. Standard monthlies expire on the third Friday; on that date the open
    // interest — and the dealer gamma hedging it — stops existing, so the surrounding days behave
    // differently. On a dealer-positioning chart an unmarked OPEX is a missing explanatory
    // variable. Quarterlies (triple witching) get a heavier mark because the unwind is larger.
    //
    // Rendered as series markers rather than a custom overlay so they pan and zoom with the data
    // for free, and are automatically clipped to the visible range by the library.
    if (showOpex && bars.length) {
      const firstMs = Number(bars[0]!.time) * 1000;
      const lastMs = Number(bars[bars.length - 1]!.time) * 1000;
      const marks = opexDatesInRange(firstMs, lastMs).map((d) => {
        const quarterly = isQuarterlyOpex(d);
        return {
          time: (Date.parse(`${d}T00:00:00Z`) / 1000) as Time,
          position: "belowBar" as const,
          color: quarterly ? OPEX_QUARTERLY : OPEX_MONTHLY,
          shape: "arrowUp" as const,
          text: quarterly ? "OPEX·Q" : "OPEX",
        };
      });
      createSeriesMarkers(candleSeries, marks);
    } else {
      createSeriesMarkers(candleSeries, []);
    }

    applyZoom(chartRef.current, bars.length, unit, zoom);
  }, [bars, unit, zoom, showOpex]);

  return (
    <div className="vector-daily-chart" data-testid="vector-daily-chart">
      <div className="vector-daily-chart-head">
        <span className="vector-daily-chart-note">
          {unitLabel(unit)} historical price — GEX walls, beads, and replay are intraday-only and
          not shown here.
          {/* An index has no shares, so the volume strip is legitimately empty. Saying so beats
              leaving a blank band that reads as a data failure — it was reported as one. */}
          {isIndexTicker(ticker) ? " Volume is not published for index tickers." : ""}
        </span>
        <div className="vector-daily-chart-zoom" role="group" aria-label="Chart options">
          <button
            type="button"
            className={`vector-daily-chart-zoom-btn${showOpex ? " is-active" : ""}`}
            aria-pressed={showOpex}
            title="Monthly options expiration (third Friday). Q = quarterly triple witching."
            onClick={() => setShowOpex((v) => !v)}
          >
            OPEX
          </button>
          {VECTOR_ZOOM_PRESETS.map((p) => (
            <button
              key={p}
              type="button"
              className={`vector-daily-chart-zoom-btn${zoom === p ? " is-active" : ""}`}
              aria-pressed={zoom === p}
              onClick={() => {
                setZoom(p);
                writePersisted(VECTOR_ZOOM_STORAGE_KEY, p);
              }}
            >
              {p}
            </button>
          ))}
        </div>
      </div>
      <div className="vector-daily-chart-canvas-wrap">
        <div ref={containerRef} className="vector-daily-chart-canvas" />
        {hover && (
          <div className="vector-daily-chart-readout" data-testid="vector-daily-readout">
            <span>O {hover.open}</span>
            <span>H {hover.high}</span>
            <span>L {hover.low}</span>
            <span>C {hover.close}</span>
            <span className={hover.changePct >= 0 ? "is-up" : "is-down"}>
              {hover.changePct >= 0 ? "+" : ""}
              {hover.changePct.toFixed(2)}%
            </span>
          </div>
        )}
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
