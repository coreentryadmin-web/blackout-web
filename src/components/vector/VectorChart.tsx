"use client";

import { useEffect, useRef } from "react";
import {
  createChart,
  CandlestickSeries,
  ColorType,
  LineStyle,
  type IChartApi,
  type IPriceLine,
  type ISeriesApi,
  type UTCTimestamp,
} from "lightweight-charts";
import { createVectorEventSource, type VectorWallLevel, type VectorWalls } from "@/lib/api";
import { alphaForPct, widthForPct } from "@/lib/providers/vector-wall-visual";

export type VectorBar = {
  time: UTCTimestamp;
  open: number;
  high: number;
  low: number;
  close: number;
};

// Purple = put wall (support), yellow = call wall (resistance) — matches the reference
// competitor product's color convention, confirmed against a user-provided screenshot.
const PUT_WALL_COLOR = "#b26bff";
const CALL_WALL_COLOR = "#ffd60a";

type Props = {
  initialBars: VectorBar[];
  initialWalls: VectorWalls | null;
  liveSession: boolean;
};

function withAlpha(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function applyWallLines(
  series: ISeriesApi<"Candlestick">,
  linesRef: React.MutableRefObject<(IPriceLine | null)[]>,
  levels: VectorWallLevel[] | undefined,
  baseColor: string,
  label: string
): void {
  const list = levels ?? [];
  const lines = linesRef.current;
  const max = Math.max(list.length, lines.length);
  for (let i = 0; i < max; i++) {
    const level = list[i];
    if (!level) {
      if (lines[i]) {
        series.removePriceLine(lines[i]!);
        lines[i] = null;
      }
      continue;
    }
    const title = `${label} ${Math.round(level.strike)} — ${level.pct.toFixed(0)}%`;
    const color = withAlpha(baseColor, alphaForPct(level.pct));
    const lineWidth = widthForPct(level.pct);
    if (lines[i]) {
      lines[i]!.applyOptions({ price: level.strike, title, color, lineWidth });
    } else {
      lines[i] = series.createPriceLine({
        price: level.strike,
        color,
        lineWidth,
        lineStyle: LineStyle.Solid,
        axisLabelVisible: true,
        title,
      });
    }
  }
  lines.length = list.length;
}

function applyWallsToSeries(
  series: ISeriesApi<"Candlestick">,
  callWallLinesRef: React.MutableRefObject<(IPriceLine | null)[]>,
  putWallLinesRef: React.MutableRefObject<(IPriceLine | null)[]>,
  walls: VectorWalls | null | undefined
): void {
  if (!walls) return;
  applyWallLines(series, callWallLinesRef, walls.callWalls, CALL_WALL_COLOR, "Call wall");
  applyWallLines(series, putWallLinesRef, walls.putWalls, PUT_WALL_COLOR, "Put wall");
}

export function VectorChart({ initialBars, initialWalls, liveSession }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const callWallLinesRef = useRef<(IPriceLine | null)[]>([]);
  const putWallLinesRef = useRef<(IPriceLine | null)[]>([]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const chart = createChart(container, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: "#9fb4d4",
      },
      grid: {
        vertLines: { color: "rgba(255,255,255,0.06)" },
        horzLines: { color: "rgba(255,255,255,0.06)" },
      },
      timeScale: { timeVisible: true, secondsVisible: false },
      rightPriceScale: { borderColor: "rgba(255,255,255,0.12)" },
    });
    const series = chart.addSeries(CandlestickSeries, {
      upColor: "#00e676",
      downColor: "#ff2d55",
      borderVisible: false,
      wickUpColor: "#00e676",
      wickDownColor: "#ff2d55",
    });
    series.setData(initialBars);
    if (initialBars.length) chart.timeScale().fitContent();
    applyWallsToSeries(series, callWallLinesRef, putWallLinesRef, initialWalls);

    chartRef.current = chart;
    seriesRef.current = series;

    let lastBarTime = initialBars.length ? initialBars[initialBars.length - 1].time : 0;
    const conn = createVectorEventSource((snap) => {
      if (snap.candle && snap.candle.time >= lastBarTime) {
        lastBarTime = snap.candle.time;
        seriesRef.current?.update(snap.candle as VectorBar);
      }
      if (seriesRef.current && snap.walls) {
        applyWallsToSeries(seriesRef.current, callWallLinesRef, putWallLinesRef, snap.walls);
      }
    });

    return () => {
      conn?.close();
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
      callWallLinesRef.current = [];
      putWallLinesRef.current = [];
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="vector-chart-wrap">
      {!initialBars.length && (
        <p className="mb-3 font-mono text-xs text-sky-300">
          No SPX session bars available yet — gamma walls will still load when data is present.
        </p>
      )}
      <div
        ref={containerRef}
        className="vector-chart-canvas"
        style={{ height: "calc(100vh - 280px)", minHeight: 480 }}
        aria-busy={liveSession}
      />
    </div>
  );
}
