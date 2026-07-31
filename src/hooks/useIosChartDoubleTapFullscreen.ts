"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useIosNativeShell } from "@/hooks/useIosNativeShell";

/**
 * Double-tap a chart container to toggle immersive fullscreen on iOS native shell.
 * Returns a ref callback for the chart stage wrapper.
 */
export function useIosChartDoubleTapFullscreen(enabled = true) {
  const nativeShell = useIosNativeShell();
  const active = enabled && nativeShell;
  const [fullscreen, setFullscreen] = useState(false);
  const [chartNode, setChartNode] = useState<HTMLElement | null>(null);
  const lastTapRef = useRef(0);

  const chartStageRef = useCallback((node: HTMLElement | null) => {
    setChartNode(node);
  }, []);

  useEffect(() => {
    if (!active || !chartNode) return;

    const onTouchEnd = (e: TouchEvent) => {
      const now = Date.now();
      if (now - lastTapRef.current < 320) {
        setFullscreen((v) => !v);
        e.preventDefault();
      }
      lastTapRef.current = now;
    };

    chartNode.addEventListener("touchend", onTouchEnd, { passive: false });
    return () => chartNode.removeEventListener("touchend", onTouchEnd);
  }, [active, chartNode]);

  useEffect(() => {
    if (!active) {
      setFullscreen(false);
      return;
    }
    document.documentElement.classList.toggle("ios-chart-fullscreen", fullscreen);
    return () => document.documentElement.classList.remove("ios-chart-fullscreen");
  }, [active, fullscreen]);

  useEffect(() => {
    if (!fullscreen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setFullscreen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [fullscreen]);

  return {
    fullscreen,
    exitFullscreen: () => setFullscreen(false),
    chartStageRef,
  };
}
