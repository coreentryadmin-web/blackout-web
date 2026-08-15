import type { IPriceLine, ISeriesApi, LineStyle } from "lightweight-charts";
import { LineStyle as LS } from "lightweight-charts";
import { VECTOR_DRAW_COLORS, type VectorDrawing } from "./vector-drawings";

function withAlpha(hex: string, alpha: number): string {
  const h = hex.replace("#", "");
  if (h.length !== 6) return hex;
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

/**
 * Reconcile member horizontal lines on the candle series — same diff pattern as applyLevelLines.
 */
export function applyUserHLines(
  series: ISeriesApi<"Candlestick">,
  map: Map<string, IPriceLine>,
  drawings: readonly VectorDrawing[],
  selectedId: string | null
): void {
  const desired = new Map<string, { price: number; color: string; title: string }>();
  for (const d of drawings) {
    if (d.kind !== "hline") continue;
    const hex = VECTOR_DRAW_COLORS[d.color];
    const selected = d.id === selectedId;
    desired.set(d.id, {
      price: d.price,
      color: withAlpha(selected ? "#ffffff" : hex, 0.92),
      title: d.label ?? `Line ${Math.round(d.price)}`,
    });
  }

  for (const [id, pl] of map) {
    if (!desired.has(id)) {
      series.removePriceLine(pl);
      map.delete(id);
    }
  }

  for (const [id, spec] of desired) {
    const opts = {
      price: spec.price,
      color: spec.color,
      lineWidth: (selectedId === id ? 2 : 1) as 1 | 2,
      lineStyle: LS.Solid as LineStyle,
      lineVisible: true,
      axisLabelVisible: true,
      title: spec.title,
    };
    const existing = map.get(id);
    if (existing) existing.applyOptions(opts);
    else map.set(id, series.createPriceLine(opts));
  }
}
