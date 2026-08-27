"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { IChartApi, IPriceLine, ISeriesApi, MouseEventParams, Time } from "lightweight-charts";
import { resolveChartClickTime } from "@/features/vector/lib/vector-draw-click";
import {
  createDrawingFromClick,
  drawingNeedsSecondClick,
  hitTestDrawing,
  snapPriceToBar,
  type VectorDrawColorId,
  type VectorDrawing,
  type VectorDrawTool,
  VECTOR_DRAW_TOOL_SHORTCUTS,
} from "@/features/vector/lib/vector-drawings";
import { UserDrawingsPrimitive } from "@/features/vector/lib/vector-drawings-primitive";
import { applyUserHLines } from "@/features/vector/lib/vector-drawings-render";
import {
  DrawingUndoStack,
  loadDrawColor,
  loadDrawings,
  saveDrawColor,
  saveDrawings,
} from "@/features/vector/lib/vector-drawings-store";

type SessionBar = {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
};

export function useVectorChartDrawings(opts: {
  ticker: string;
  replayMode: boolean;
  chartReady: boolean;
  seriesRef: React.RefObject<ISeriesApi<"Candlestick"> | null>;
  // BUG FIX (2026-08-27): must be the currently-DISPLAYED (timeframe-aggregated) bars, not raw
  // 1-minute bars. resolveChartClickTime's empty-margin fallback indexes this array with a logical
  // index from chart.timeScale().coordinateToLogical(), which is an index into whatever series is
  // actually plotted — at any timeframe above 1m that's a shorter, aggregated array, so indexing
  // the raw minute bars landed on the wrong bar (and therefore the wrong time) entirely.
  displayBarsRef: React.RefObject<SessionBar[]>;
  drawingsPrimitiveRef: React.RefObject<UserDrawingsPrimitive | null>;
}) {
  const { ticker, replayMode, chartReady, seriesRef, displayBarsRef, drawingsPrimitiveRef } = opts;

  const [drawTool, setDrawTool] = useState<VectorDrawTool>("select");
  const [drawColor, setDrawColor] = useState<VectorDrawColorId>("cyan");
  const [textLabel, setTextLabel] = useState("");
  const [drawings, setDrawings] = useState<VectorDrawing[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const userHlineMapRef = useRef<Map<string, IPriceLine>>(new Map());
  const draftAnchorRef = useRef<{ t: number; p: number } | null>(null);
  const undoRef = useRef(new DrawingUndoStack());
  const shiftHeldRef = useRef(false);
  const replayModeRef = useRef(replayMode);
  const drawToolRef = useRef(drawTool);
  const drawColorRef = useRef(drawColor);
  const textLabelRef = useRef(textLabel);
  const drawingsRef = useRef(drawings);
  const selectedIdRef = useRef(selectedId);

  useEffect(() => {
    replayModeRef.current = replayMode;
  }, [replayMode]);
  useEffect(() => {
    drawToolRef.current = drawTool;
  }, [drawTool]);
  useEffect(() => {
    drawColorRef.current = drawColor;
  }, [drawColor]);
  useEffect(() => {
    textLabelRef.current = textLabel;
  }, [textLabel]);
  useEffect(() => {
    drawingsRef.current = drawings;
  }, [drawings]);
  useEffect(() => {
    selectedIdRef.current = selectedId;
  }, [selectedId]);

  const syncToChart = useCallback(() => {
    const series = seriesRef.current;
    const prim = drawingsPrimitiveRef.current;
    const list = drawingsRef.current;
    const sel = selectedIdRef.current;
    if (series) applyUserHLines(series, userHlineMapRef.current, list, sel);
    prim?.setDrawings(list, sel);
    prim?.setDraft(null, null);
  }, [drawingsPrimitiveRef, seriesRef]);

  useEffect(() => {
    setDrawColor(loadDrawColor());
    const loaded = loadDrawings(ticker);
    setDrawings(loaded);
    setSelectedId(null);
    setTextLabel("");
    draftAnchorRef.current = null;
    undoRef.current.clear();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- ticker switch only
  }, [ticker]);

  useEffect(() => {
    if (!chartReady) userHlineMapRef.current.clear();
  }, [chartReady]);

  useEffect(() => {
    saveDrawings(ticker, drawings);
  }, [ticker, drawings]);

  useEffect(() => {
    if (!chartReady) return;
    syncToChart();
  }, [chartReady, drawings, selectedId, syncToChart]);

  const pushUndo = useCallback(() => {
    undoRef.current.push(drawingsRef.current);
  }, []);

  const addDrawing = useCallback(
    (d: VectorDrawing) => {
      pushUndo();
      setDrawings((prev) => [...prev, d]);
      setSelectedId(d.id);
      draftAnchorRef.current = null;
      drawingsPrimitiveRef.current?.setDraft(null, null);
    },
    [drawingsPrimitiveRef, pushUndo]
  );

  const handleChartClick = useCallback(
    (chart: IChartApi, param: MouseEventParams<Time>, series: ISeriesApi<"Candlestick">) => {
      if (replayModeRef.current || !param.point) return;

      const t = resolveChartClickTime(chart, param, displayBarsRef.current ?? []);
      if (t == null) return;

      let p = series.coordinateToPrice(param.point.y) as number | null;
      if (p == null || !Number.isFinite(p)) return;

      const bar = param.seriesData.get(series) as SessionBar | undefined;
      if (shiftHeldRef.current) p = snapPriceToBar(p, bar ?? null);

      const tool = drawToolRef.current;
      const color = drawColorRef.current;

      if (tool === "select") {
        const hit = hitTestDrawing(drawingsRef.current, t, p, 900, Math.max(p * 0.002, 0.05));
        setSelectedId(hit);
        return;
      }

      if (tool === "text") {
        const label = textLabelRef.current.trim() || "Note";
        const d = createDrawingFromClick(tool, color, { t, p }, null, label);
        if (d) addDrawing(d);
        return;
      }

      if (drawingNeedsSecondClick(tool)) {
        const anchor = draftAnchorRef.current;
        if (!anchor) {
          draftAnchorRef.current = { t, p };
          drawingsPrimitiveRef.current?.setDraft({ t, p, color }, { t, p });
          return;
        }
        const d = createDrawingFromClick(tool, color, { t, p }, anchor);
        if (d) addDrawing(d);
        return;
      }

      const d = createDrawingFromClick(tool, color, { t, p }, null);
      if (d) addDrawing(d);
    },
    [addDrawing, drawingsPrimitiveRef, displayBarsRef]
  );

  const handleUndo = useCallback(() => {
    const prev = undoRef.current.pop();
    if (!prev) return;
    setDrawings(prev);
    setSelectedId(null);
  }, []);

  const handleClear = useCallback(() => {
    if (!drawings.length) return;
    pushUndo();
    setDrawings([]);
    setSelectedId(null);
  }, [drawings.length, pushUndo]);

  const handleDeleteSelected = useCallback(() => {
    const id = selectedIdRef.current;
    if (!id) return;
    pushUndo();
    setDrawings((prev) => prev.filter((d) => d.id !== id));
    setSelectedId(null);
  }, [pushUndo]);

  const handleDrawColor = useCallback((c: VectorDrawColorId) => {
    setDrawColor(c);
    saveDrawColor(c);
  }, []);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Shift") shiftHeldRef.current = true;
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;
      if (replayModeRef.current) return;

      const key = e.key.length === 1 ? e.key.toUpperCase() : e.key;

      if (key === "Delete" || key === "Backspace") {
        if (selectedIdRef.current) {
          e.preventDefault();
          handleDeleteSelected();
        }
        return;
      }

      if (e.metaKey || e.ctrlKey || e.altKey) return;

      const entry = Object.entries(VECTOR_DRAW_TOOL_SHORTCUTS).find(([, k]) => k === key);
      if (entry) {
        e.preventDefault();
        setDrawTool(entry[0] as VectorDrawTool);
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === "Shift") shiftHeldRef.current = false;
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, [handleDeleteSelected]);

  const bindChartClick = useCallback(
    (chart: IChartApi, series: ISeriesApi<"Candlestick">) => {
      const handler = (param: MouseEventParams<Time>) => handleChartClick(chart, param, series);
      chart.subscribeClick(handler);
      return () => chart.unsubscribeClick(handler);
    },
    [handleChartClick]
  );

  const updateDraftCursor = useCallback((t: number | null, p: number | null) => {
    const anchor = draftAnchorRef.current;
    if (!anchor || t == null || p == null) return;
    drawingsPrimitiveRef.current?.setDraft(
      { t: anchor.t, p: anchor.p, color: drawColorRef.current },
      { t, p }
    );
  }, [drawingsPrimitiveRef]);

  return {
    drawTool,
    setDrawTool,
    drawColor,
    setDrawColor: handleDrawColor,
    textLabel,
    setTextLabel,
    drawings,
    selectedId,
    handleUndo,
    handleClear,
    handleDeleteSelected,
    bindChartClick,
    syncToChart,
    updateDraftCursor,
  };
}
