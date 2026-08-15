import type { IChartApi, MouseEventParams, Time } from "lightweight-charts";

/**
 * Resolve unix-sec time for a chart click. lightweight-charts only sets param.time when the
 * click lands on a bar — with session zoom / 1H coarsen most of the canvas is empty margin,
 * so drawings silently no-op unless we map x → time ourselves.
 */
export function resolveChartClickTime(
  chart: IChartApi,
  param: MouseEventParams<Time>,
  bars: readonly { time: number }[]
): number | null {
  if (!param.point) return null;

  const direct = param.time;
  if (typeof direct === "number") return direct;

  const fromX = chart.timeScale().coordinateToTime(param.point.x);
  if (typeof fromX === "number") return fromX;

  const logical = chart.timeScale().coordinateToLogical(param.point.x);
  if (logical == null || !bars.length) return null;

  const idx = Math.max(0, Math.min(bars.length - 1, Math.round(logical)));
  return bars[idx]!.time;
}
