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
import { VectorCrosshairLegend, type VectorCrosshairState } from "@/components/vector/VectorCrosshairLegend";
import { VectorReplayControls } from "@/components/vector/VectorReplayControls";
import {
  createVectorEventSource,
  type VectorDarkPoolLevel,
  type VectorWallLevel,
  type VectorWalls,
} from "@/lib/api";
import { alphaForPct, radiusForPct, widthForPct } from "@/lib/providers/vector-wall-visual";
import {
  mergeWallHistory,
  pickActiveStrikes,
  trailForGammaFlip,
  trailsByStrike,
  type WallHistorySample,
} from "@/lib/providers/vector-wall-history";
import {
  buildReplayTimeline,
  formatReplayClock,
  gammaFlipAtReplayTime,
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
const GAMMA_FLIP_COLOR = "#22d3ee";
const DARK_POOL_COLOR = "#00d4ff";
const REPLAY_STEP_MS = 350;
const MAX_WALL_GUIDES = 3;
const MAX_DP_GUIDES = 6;

type Props = {
  initialBars: VectorBar[];
  initialWalls: VectorWalls | null;
  initialWallHistory: WallHistorySample[];
  initialGammaFlip: number | null;
  initialDarkPoolLevels: VectorDarkPoolLevel[];
  sessionYmd: string;
  liveSession: boolean;
};

function withAlpha(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function pinCandlesOnTop(candleSeries: ISeriesApi<"Candlestick">): void {
  const count = candleSeries.getPane().getSeries().length;
  if (count > 0) candleSeries.setSeriesOrder(count - 1);
}

function applyPriceGuides(
  series: ISeriesApi<"Candlestick">,
  guideRefs: React.MutableRefObject<(IPriceLine | null)[]>,
  levels: Array<{ strike: number; pct: number; label: string }>,
  baseColor: string,
  maxGuides: number
): void {
  for (let i = 0; i < maxGuides; i++) {
    const level = levels[i];
    const lineRef = guideRefs.current[i];
    if (!level) {
      if (lineRef) {
        series.removePriceLine(lineRef);
        guideRefs.current[i] = null;
      }
      continue;
    }
    const title = `${level.label} ${Math.round(level.strike)} — ${level.pct.toFixed(0)}%`;
    const color = withAlpha(baseColor, alphaForPct(level.pct) * 0.35);
    const lineWidth = widthForPct(level.pct);
    if (guideRefs.current[i]) {
      guideRefs.current[i]!.applyOptions({
        price: level.strike,
        title,
        color,
        lineWidth,
        lineStyle: LineStyle.Dashed,
      });
    } else {
      guideRefs.current[i] = series.createPriceLine({
        price: level.strike,
        color,
        lineWidth,
        lineStyle: LineStyle.Dashed,
        axisLabelVisible: true,
        title,
      });
    }
  }
}

function applyWallGuides(
  series: ISeriesApi<"Candlestick">,
  guideRefs: React.MutableRefObject<(IPriceLine | null)[]>,
  levels: VectorWallLevel[],
  baseColor: string,
  label: string
): void {
  applyPriceGuides(
    series,
    guideRefs,
    levels.slice(0, MAX_WALL_GUIDES).map((l) => ({ ...l, label })),
    baseColor,
    MAX_WALL_GUIDES
  );
}

function applyDarkPoolGuides(
  series: ISeriesApi<"Candlestick">,
  guideRefs: React.MutableRefObject<(IPriceLine | null)[]>,
  levels: VectorDarkPoolLevel[]
): void {
  if (guideRefs.current.length < MAX_DP_GUIDES) {
    guideRefs.current = [
      ...guideRefs.current,
      ...Array.from({ length: MAX_DP_GUIDES - guideRefs.current.length }, () => null),
    ];
  }
  applyPriceGuides(
    series,
    guideRefs,
    levels.slice(0, MAX_DP_GUIDES).map((l) => ({ strike: l.strike, pct: l.pct, label: "DP" })),
    DARK_POOL_COLOR,
    MAX_DP_GUIDES
  );
}

function applyGammaFlipGuide(
  series: ISeriesApi<"Candlestick">,
  lineRef: React.MutableRefObject<IPriceLine | null>,
  flip: number | null | undefined
): void {
  if (flip == null || !Number.isFinite(flip) || flip <= 0) {
    if (lineRef.current) {
      series.removePriceLine(lineRef.current);
      lineRef.current = null;
    }
    return;
  }
  const title = `Gamma flip ${Math.round(flip)}`;
  const color = withAlpha(GAMMA_FLIP_COLOR, 0.45);
  if (lineRef.current) {
    lineRef.current.applyOptions({ price: flip, title, color, lineWidth: 2, lineStyle: LineStyle.Dashed });
  } else {
    lineRef.current = series.createPriceLine({
      price: flip,
      color,
      lineWidth: 2,
      lineStyle: LineStyle.Dashed,
      axisLabelVisible: true,
      title,
    });
  }
}

function applyWallsToSeries(
  series: ISeriesApi<"Candlestick">,
  callGuideRefs: React.MutableRefObject<(IPriceLine | null)[]>,
  putGuideRefs: React.MutableRefObject<(IPriceLine | null)[]>,
  walls: VectorWalls | null | undefined
): void {
  if (!walls) return;
  applyWallGuides(series, callGuideRefs, walls.callWalls, CALL_WALL_COLOR, "Call wall");
  applyWallGuides(series, putGuideRefs, walls.putWalls, PUT_WALL_COLOR, "Put wall");
}

function applyStrikeTrails(
  chart: IChartApi,
  candleSeries: ISeriesApi<"Candlestick">,
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
      trailSeries.setSeriesOrder(0);
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
  pinCandlesOnTop(candleSeries);
}

function applyGammaFlipTrail(
  chart: IChartApi,
  candleSeries: ISeriesApi<"Candlestick">,
  flipSeriesRef: React.MutableRefObject<ISeriesApi<"Line"> | null>,
  history: WallHistorySample[]
): void {
  const points = trailForGammaFlip(history);
  if (!points.length) {
    if (flipSeriesRef.current) {
      chart.removeSeries(flipSeriesRef.current);
      flipSeriesRef.current = null;
    }
    return;
  }
  let flipSeries = flipSeriesRef.current;
  if (!flipSeries) {
    flipSeries = chart.addSeries(LineSeries, {
      color: GAMMA_FLIP_COLOR,
      lineVisible: false,
      pointMarkersVisible: true,
      pointMarkersRadius: 3,
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: false,
    });
    flipSeries.setSeriesOrder(0);
    flipSeriesRef.current = flipSeries;
  }
  const data: LineData<UTCTimestamp>[] = points.map((p) => ({
    time: p.time as UTCTimestamp,
    value: p.strike,
    color: withAlpha(GAMMA_FLIP_COLOR, 0.85),
  }));
  flipSeries.setData(data);
  pinCandlesOnTop(candleSeries);
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

function emptyGuideRefs(): (IPriceLine | null)[] {
  return Array.from({ length: MAX_WALL_GUIDES }, () => null);
}

export function VectorChart({
  initialBars,
  initialWalls,
  initialWallHistory,
  initialGammaFlip,
  initialDarkPoolLevels,
  sessionYmd,
  liveSession,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const callGuideRefs = useRef<(IPriceLine | null)[]>(emptyGuideRefs());
  const putGuideRefs = useRef<(IPriceLine | null)[]>(emptyGuideRefs());
  const dpGuideRefs = useRef<(IPriceLine | null)[]>([]);
  const flipGuideRef = useRef<IPriceLine | null>(null);
  const callStrikeSeriesRef = useRef(new Map<number, ISeriesApi<"Line">>());
  const putStrikeSeriesRef = useRef(new Map<number, ISeriesApi<"Line">>());
  const flipTrailSeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const wallHistoryRef = useRef<WallHistorySample[]>(initialWallHistory);
  const barsRef = useRef<VectorBar[]>(initialBars);
  const gammaFlipRef = useRef<number | null>(initialGammaFlip);
  const darkPoolRef = useRef<VectorDarkPoolLevel[]>(initialDarkPoolLevels);
  const wallsRef = useRef<VectorWalls | null>(initialWalls);
  const timelineRef = useRef<number[]>([]);
  const connRef = useRef<ReturnType<typeof createVectorEventSource> | null>(null);
  const replayTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const replayModeRef = useRef(false);
  const liveSessionRef = useRef(liveSession);

  const [sessionHistory, setSessionHistory] = useState(initialWallHistory);
  const [sessionBars, setSessionBars] = useState(initialBars);
  const [replayMode, setReplayMode] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [cursorIndex, setCursorIndex] = useState(0);
  const [replaySpeed, setReplaySpeed] = useState(1);
  const [crosshair, setCrosshair] = useState<VectorCrosshairState | null>(null);

  useEffect(() => {
    liveSessionRef.current = liveSession;
  }, [liveSession]);

  useEffect(() => {
    replayModeRef.current = replayMode;
  }, [replayMode]);

  const refreshTrails = useCallback(() => {
    const chart = chartRef.current;
    const series = seriesRef.current;
    if (!chart || !series) return;
    applyStrikeTrails(chart, series, callStrikeSeriesRef.current, wallHistoryRef.current, "callWalls", CALL_WALL_COLOR);
    applyStrikeTrails(chart, series, putStrikeSeriesRef.current, wallHistoryRef.current, "putWalls", PUT_WALL_COLOR);
    applyGammaFlipTrail(chart, series, flipTrailSeriesRef, wallHistoryRef.current);
  }, []);

  const refreshOverlays = useCallback(
    (walls: VectorWalls | null, flip: number | null, dp: VectorDarkPoolLevel[]) => {
      const series = seriesRef.current;
      if (!series) return;
      applyWallsToSeries(series, callGuideRefs, putGuideRefs, walls ?? undefined);
      applyGammaFlipGuide(series, flipGuideRef, flip);
      applyDarkPoolGuides(series, dpGuideRefs, dp);
    },
    []
  );

  const applyFrame = useCallback(
    (cursorTime: number, bars: VectorBar[], history: WallHistorySample[]) => {
      const chart = chartRef.current;
      const series = seriesRef.current;
      if (!chart || !series) return;

      const visibleBars = sliceBarsToTime(bars, cursorTime) as VectorBar[];
      series.setData(visibleBars);

      const visibleHistory = sliceHistoryToTime(history, cursorTime);
      applyStrikeTrails(chart, series, callStrikeSeriesRef.current, visibleHistory, "callWalls", CALL_WALL_COLOR);
      applyStrikeTrails(chart, series, putStrikeSeriesRef.current, visibleHistory, "putWalls", PUT_WALL_COLOR);
      applyGammaFlipTrail(chart, series, flipTrailSeriesRef, visibleHistory);

      const walls = wallsAtReplayTime(history, cursorTime) ?? initialWalls;
      const flip = gammaFlipAtReplayTime(history, cursorTime) ?? initialGammaFlip;
      refreshOverlays(walls, flip, darkPoolRef.current);
    },
    [initialWalls, initialGammaFlip, refreshOverlays]
  );

  const stopReplayTimer = useCallback(() => {
    if (replayTimerRef.current) {
      clearInterval(replayTimerRef.current);
      replayTimerRef.current = null;
    }
  }, []);

  const connectLive = useCallback(() => {
    if (!liveSessionRef.current) return;
    connRef.current?.close();

    let lastBarTime = barsRef.current.length ? barsRef.current[barsRef.current.length - 1]!.time : 0;
    let newBarOpened = false;

    connRef.current = createVectorEventSource((snap) => {
      if (replayModeRef.current) return;
      if (snap.sessionYmd && snap.sessionYmd !== sessionYmd) return;
      if (!liveSessionRef.current) return;

      if (snap.wallHistory?.length) {
        const merged = mergeWallHistory(wallHistoryRef.current, snap.wallHistory);
        if (merged !== wallHistoryRef.current) {
          wallHistoryRef.current = merged;
          setSessionHistory(merged);
          refreshTrails();
        }
      }

      if (snap.gammaFlip !== undefined) {
        gammaFlipRef.current = snap.gammaFlip ?? null;
      }
      if (snap.darkPoolLevels) {
        darkPoolRef.current = snap.darkPoolLevels;
      }
      if (snap.walls) {
        wallsRef.current = snap.walls;
      }

      if (snap.candle && snap.candle.time >= lastBarTime) {
        newBarOpened = snap.candle.time > lastBarTime;
        lastBarTime = snap.candle.time;
        const nextBars = upsertBar(barsRef.current, snap.candle as VectorBar);
        barsRef.current = nextBars;
        setSessionBars(nextBars);
        seriesRef.current?.update(snap.candle as VectorBar);
        if (newBarOpened && chartRef.current) {
          chartRef.current.timeScale().scrollToRealTime();
        }
      }

      refreshOverlays(wallsRef.current, gammaFlipRef.current, darkPoolRef.current);
    });
  }, [sessionYmd, refreshTrails, refreshOverlays]);

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
      crosshair: {
        vertLine: { color: "rgba(34, 211, 238, 0.35)", width: 1, style: LineStyle.Dashed },
        horzLine: { color: "rgba(34, 211, 238, 0.35)", width: 1, style: LineStyle.Dashed },
      },
    });

    const series = chart.addSeries(CandlestickSeries, {
      upColor: "#00e676",
      downColor: "#ff2d55",
      borderVisible: false,
      wickUpColor: "#00e676",
      wickDownColor: "#ff2d55",
      priceLineVisible: false,
      lastValueVisible: true,
    });

    series.setData(initialBars);
    if (initialBars.length) chart.timeScale().fitContent();

    chartRef.current = chart;
    seriesRef.current = series;

    refreshTrails();
    refreshOverlays(initialWalls, initialGammaFlip, initialDarkPoolLevels);
    pinCandlesOnTop(series);

    chart.subscribeCrosshairMove((param) => {
      if (!param.time || !param.point) {
        setCrosshair(null);
        return;
      }
      const bar = param.seriesData.get(series) as VectorBar | undefined;
      const time =
        typeof param.time === "number"
          ? formatReplayClock(param.time)
          : String(param.time);
      setCrosshair({
        time,
        close: bar?.close ?? null,
        gammaFlip: gammaFlipRef.current,
        callWalls: wallsRef.current?.callWalls ?? [],
        putWalls: wallsRef.current?.putWalls ?? [],
        darkPoolLevels: darkPoolRef.current,
      });
    });

    if (liveSession) connectLive();

    return () => {
      stopReplayTimer();
      connRef.current?.close();
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
      callGuideRefs.current = emptyGuideRefs();
      putGuideRefs.current = emptyGuideRefs();
      dpGuideRefs.current = [];
      flipGuideRef.current = null;
      callStrikeSeriesRef.current.clear();
      putStrikeSeriesRef.current.clear();
      flipTrailSeriesRef.current = null;
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
    refreshTrails();
    const walls = wallsAtReplayTime(history, history[history.length - 1]?.time ?? 0) ?? initialWalls;
    const flip = gammaFlipAtReplayTime(history, history[history.length - 1]?.time ?? 0) ?? initialGammaFlip;
    refreshOverlays(walls, flip, darkPoolRef.current);
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
          No SPX session bars available yet — gamma walls, flip, and dark-pool levels load when data is present.
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

      <div className="relative">
        <VectorCrosshairLegend state={crosshair} />
        <div
          ref={containerRef}
          className="vector-chart-canvas"
          style={{ height: "calc(100vh - 320px)", minHeight: 440 }}
          aria-busy={liveSession && !replayMode}
        />
      </div>
    </div>
  );
}
