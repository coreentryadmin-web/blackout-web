"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  createChart,
  CandlestickSeries,
  ColorType,
  LineSeries,
  LineStyle,
  type IChartApi,
  type IPriceLine,
  type ISeriesApi,
  type LineData,
  type UTCTimestamp,
} from "lightweight-charts";
import { VectorReplayControls } from "@/components/vector/VectorReplayControls";
import { createVectorEventSource, type VectorWallLevel, type VectorWalls } from "@/lib/api";
import { alphaForPct, radiusForPct, widthForPct } from "@/lib/providers/vector-wall-visual";
import {
  mergeWallHistory,
  pickActiveStrikes,
  recordWallSample,
  trailsByStrike,
  type WallHistorySample,
} from "@/lib/providers/vector-wall-history";
import { bucketWallSampleTime } from "@/lib/providers/vector-wall-sample";
import {
  buildReplayTimeline,
  formatReplayClock,
  sliceBarsToTime,
  sliceHistoryToTime,
  wallsAtReplayTime,
} from "@/lib/vector-replay";

export type VectorBar = {
  time: UTCTimestamp;
  open: number;
  high: number;
  low: number;
  close: number;
};

const PUT_WALL_COLOR = "#b26bff";
const CALL_WALL_COLOR = "#ffd60a";
const REPLAY_STEP_MS = 350;

type Props = {
  initialBars: VectorBar[];
  initialWalls: VectorWalls | null;
  initialWallHistory: WallHistorySample[];
  liveSession: boolean;
};

function withAlpha(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function applyTopWallGuide(
  series: ISeriesApi<"Candlestick">,
  lineRef: React.MutableRefObject<IPriceLine | null>,
  level: VectorWallLevel | undefined,
  baseColor: string,
  label: string
): void {
  if (!level) {
    if (lineRef.current) {
      series.removePriceLine(lineRef.current);
      lineRef.current = null;
    }
    return;
  }
  const title = `${label} ${Math.round(level.strike)} — ${level.pct.toFixed(0)}%`;
  const color = withAlpha(baseColor, alphaForPct(level.pct) * 0.35);
  const lineWidth = widthForPct(level.pct);
  if (lineRef.current) {
    lineRef.current.applyOptions({
      price: level.strike,
      title,
      color,
      lineWidth,
      lineStyle: LineStyle.Dashed,
    });
  } else {
    lineRef.current = series.createPriceLine({
      price: level.strike,
      color,
      lineWidth,
      lineStyle: LineStyle.Dashed,
      axisLabelVisible: true,
      title,
    });
  }
}

function applyWallsToSeries(
  series: ISeriesApi<"Candlestick">,
  callGuideRef: React.MutableRefObject<IPriceLine | null>,
  putGuideRef: React.MutableRefObject<IPriceLine | null>,
  walls: VectorWalls | null | undefined
): void {
  if (!walls) return;
  applyTopWallGuide(series, callGuideRef, walls.callWalls[0], CALL_WALL_COLOR, "Call wall");
  applyTopWallGuide(series, putGuideRef, walls.putWalls[0], PUT_WALL_COLOR, "Put wall");
}

function applyStrikeTrails(
  chart: IChartApi,
  seriesByStrike: Map<number, ISeriesApi<"Line">>,
  history: WallHistorySample[],
  side: "callWalls" | "putWalls",
  baseColor: string
): void {
  const trails = trailsByStrike(history, side);
  const active = new Set(pickActiveStrikes(trails));

  for (const [strike, trailSeries] of seriesByStrike) {
    if (!active.has(strike)) {
      chart.removeSeries(trailSeries);
      seriesByStrike.delete(strike);
    }
  }

  for (const strike of active) {
    const points = trails.get(strike)!;
    let trailSeries = seriesByStrike.get(strike);
    if (!trailSeries) {
      trailSeries = chart.addSeries(LineSeries, {
        color: baseColor,
        lineVisible: false,
        pointMarkersVisible: true,
        pointMarkersRadius: radiusForPct(0),
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false,
      });
      seriesByStrike.set(strike, trailSeries);
    }
    const data: LineData<UTCTimestamp>[] = points.map((p) => ({
      time: p.time as UTCTimestamp,
      value: strike,
      color: withAlpha(baseColor, alphaForPct(p.pct)),
    }));
    trailSeries.setData(data);
    const latestPct = points[points.length - 1]?.pct ?? 0;
    trailSeries.applyOptions({ pointMarkersRadius: radiusForPct(latestPct) });
  }
}

function upsertBar(bars: VectorBar[], candle: VectorBar): VectorBar[] {
  const last = bars[bars.length - 1];
  if (last && last.time === candle.time) {
    return [...bars.slice(0, -1), candle];
  }
  if (!last || candle.time > last.time) {
    return [...bars, candle];
  }
  return bars;
}

export function VectorChart({ initialBars, initialWalls, initialWallHistory, liveSession }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const callGuideRef = useRef<IPriceLine | null>(null);
  const putGuideRef = useRef<IPriceLine | null>(null);
  const callStrikeSeriesRef = useRef(new Map<number, ISeriesApi<"Line">>());
  const putStrikeSeriesRef = useRef(new Map<number, ISeriesApi<"Line">>());
  const wallHistoryRef = useRef<WallHistorySample[]>(initialWallHistory);
  const barsRef = useRef<VectorBar[]>(initialBars);
  const timelineRef = useRef<number[]>([]);
  const connRef = useRef<ReturnType<typeof createVectorEventSource> | null>(null);
  const replayTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const [sessionHistory, setSessionHistory] = useState(initialWallHistory);
  const [sessionBars, setSessionBars] = useState(initialBars);
  const [replayMode, setReplayMode] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [cursorIndex, setCursorIndex] = useState(0);
  const [replaySpeed, setReplaySpeed] = useState(1);

  const applyFrame = useCallback((cursorTime: number, bars: VectorBar[], history: WallHistorySample[]) => {
    const chart = chartRef.current;
    const series = seriesRef.current;
    if (!chart || !series) return;

    const visibleBars = sliceBarsToTime(bars, cursorTime) as VectorBar[];
    series.setData(visibleBars);

    const visibleHistory = sliceHistoryToTime(history, cursorTime);
    applyStrikeTrails(chart, callStrikeSeriesRef.current, visibleHistory, "callWalls", CALL_WALL_COLOR);
    applyStrikeTrails(chart, putStrikeSeriesRef.current, visibleHistory, "putWalls", PUT_WALL_COLOR);

    const walls = wallsAtReplayTime(history, cursorTime) ?? initialWalls;
    applyWallsToSeries(series, callGuideRef, putGuideRef, walls);
  }, [initialWalls]);

  const refreshLiveTrails = useCallback(() => {
    const chart = chartRef.current;
    if (!chart) return;
    applyStrikeTrails(chart, callStrikeSeriesRef.current, wallHistoryRef.current, "callWalls", CALL_WALL_COLOR);
    applyStrikeTrails(chart, putStrikeSeriesRef.current, wallHistoryRef.current, "putWalls", PUT_WALL_COLOR);
  }, []);

  const stopReplayTimer = useCallback(() => {
    if (replayTimerRef.current) {
      clearInterval(replayTimerRef.current);
      replayTimerRef.current = null;
    }
  }, []);

  const connectLive = useCallback(() => {
    connRef.current?.close();
    let lastBarTime = barsRef.current.length ? barsRef.current[barsRef.current.length - 1]!.time : 0;

    connRef.current = createVectorEventSource((snap) => {
      if (snap.wallHistory?.length) {
        const merged = mergeWallHistory(wallHistoryRef.current, snap.wallHistory);
        if (merged !== wallHistoryRef.current) {
          wallHistoryRef.current = merged;
          setSessionHistory(merged);
          refreshLiveTrails();
        }
      }
      if (snap.candle && snap.candle.time >= lastBarTime) {
        lastBarTime = snap.candle.time;
        const nextBars = upsertBar(barsRef.current, snap.candle as VectorBar);
        barsRef.current = nextBars;
        setSessionBars(nextBars);
        seriesRef.current?.update(snap.candle as VectorBar);
      }
      if (seriesRef.current && snap.walls) {
        applyWallsToSeries(seriesRef.current, callGuideRef, putGuideRef, snap.walls);
      }
      if (snap.walls) {
        const bucket = bucketWallSampleTime(Math.floor(Date.now() / 1000));
        const next = recordWallSample(wallHistoryRef.current, {
          time: bucket,
          walls: snap.walls,
        });
        wallHistoryRef.current = next;
        setSessionHistory(next);
        refreshLiveTrails();
      }
    });
  }, [refreshLiveTrails]);

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
      timeScale: { timeVisible: true, secondsVisible: true },
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
    applyWallsToSeries(series, callGuideRef, putGuideRef, initialWalls);
    refreshLiveTrails();

    chartRef.current = chart;
    seriesRef.current = series;

    connectLive();

    return () => {
      stopReplayTimer();
      connRef.current?.close();
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
      callGuideRef.current = null;
      putGuideRef.current = null;
      callStrikeSeriesRef.current.clear();
      putStrikeSeriesRef.current.clear();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!replayMode || !playing || timelineRef.current.length === 0) {
      stopReplayTimer();
      return;
    }
    replayTimerRef.current = setInterval(() => {
      setCursorIndex((idx) => {
        const next = idx + 1;
        if (next >= timelineRef.current.length) {
          setPlaying(false);
          return idx;
        }
        const t = timelineRef.current[next]!;
        applyFrame(t, barsRef.current, wallHistoryRef.current);
        return next;
      });
    }, REPLAY_STEP_MS / Math.max(0.25, replaySpeed));

    return stopReplayTimer;
  }, [replayMode, playing, replaySpeed, applyFrame, stopReplayTimer]);

  const replayTimeline = buildReplayTimeline(sessionHistory, sessionBars);
  const canReplay = replayTimeline.length > 1;

  const enterReplay = () => {
    connRef.current?.close();
    connRef.current = null;
    timelineRef.current = replayTimeline;
    setReplayMode(true);
    setPlaying(false);
    setCursorIndex(0);
    if (replayTimeline.length > 0) {
      applyFrame(replayTimeline[0]!, barsRef.current, wallHistoryRef.current);
    }
  };

  const exitReplay = () => {
    stopReplayTimer();
    setReplayMode(false);
    setPlaying(false);
    const bars = barsRef.current;
    const history = wallHistoryRef.current;
    seriesRef.current?.setData(bars);
    refreshLiveTrails();
    if (seriesRef.current) {
      const walls = wallsAtReplayTime(history, history[history.length - 1]?.time ?? 0) ?? initialWalls;
      applyWallsToSeries(seriesRef.current, callGuideRef, putGuideRef, walls);
    }
    chartRef.current?.timeScale().fitContent();
    connectLive();
  };

  const toggleReplay = () => {
    if (replayMode) exitReplay();
    else enterReplay();
  };

  const scrubTo = (index: number) => {
    setPlaying(false);
    setCursorIndex(index);
    const t = timelineRef.current[index];
    if (t != null) applyFrame(t, barsRef.current, wallHistoryRef.current);
  };

  const stepCount = replayMode ? timelineRef.current.length : replayTimeline.length;
  const cursorTime = timelineRef.current[cursorIndex] ?? 0;
  const clockLabel = cursorTime ? formatReplayClock(cursorTime) : "—";

  return (
    <div className="vector-chart-wrap">
      {!initialBars.length && (
        <p className="mb-3 font-mono text-xs text-sky-300">
          No SPX session bars available yet — gamma walls will still load when data is present.
        </p>
      )}

      <VectorReplayControls
        replayMode={replayMode}
        playing={playing}
        canReplay={canReplay}
        cursorIndex={cursorIndex}
        stepCount={stepCount}
        clockLabel={clockLabel}
        speed={replaySpeed}
        onToggleReplay={toggleReplay}
        onTogglePlay={() => setPlaying((p) => !p)}
        onScrub={scrubTo}
        onSpeed={setReplaySpeed}
      />

      <div
        ref={containerRef}
        className="vector-chart-canvas"
        style={{ height: "calc(100vh - 320px)", minHeight: 440 }}
        aria-busy={liveSession && !replayMode}
      />
    </div>
  );
}
