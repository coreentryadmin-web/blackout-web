import type {
  IChartApi,
  ISeriesApi,
  SeriesType,
  Time,
  ISeriesPrimitive,
  IPrimitivePaneView,
  IPrimitivePaneRenderer,
  PrimitivePaneViewZOrder,
  SeriesAttachedParameter,
} from "lightweight-charts";
import type { GexHeatmapGrid } from "./vector-gex-reconstruct";
import { heatmapRects, type HeatmapRect } from "./vector-gex-heatmap-paint";

/**
 * Strike×time GEX positioning heatmap as a lightweight-charts SERIES PRIMITIVE (task #14).
 *
 * Why a primitive (not a series): the surface must render UNDER the candles/walls/overlays yet map
 * onto the SAME axes — x = time (the chart's time scale), y = strike (the candle series' price
 * scale). lightweight-charts v5's primitive contract is exactly this: `paneViews()` returns a view
 * whose `zOrder()` is `"bottom"` (drawn beneath the series) and whose `renderer().draw()` fills rects
 * on the pane canvas. The library re-invokes `renderer()` every frame, so mapping time→x and
 * strike→y INSIDE the renderer keeps the surface pinned to the axes through every pan/zoom/crosshair.
 *
 * Data + visibility are pushed via `setData(grid, visible)`; a null/empty grid or `visible === false`
 * makes `renderer()` return null → nothing is drawn (honest absence, never a fabricated surface).
 * The heavy per-frame work is just the coordinate projection + fills; the pure geometry/colour lives
 * in `vector-gex-heatmap-paint.ts` (unit-tested without a DOM).
 */

// The renderer's draw target is `CanvasRenderingTarget2D` (from fancy-canvas). lightweight-charts
// doesn't re-export that name, so derive it from the interface rather than importing fancy-canvas.
type PaneRendererTarget = Parameters<IPrimitivePaneRenderer["draw"]>[0];
// `attached()` hands us a series typed over the full options map — alias it so the field is precise.
type AttachedSeries = ISeriesApi<SeriesType, Time>;

const SPOT_LINE_COLOR = "rgba(34, 211, 238, 0.85)"; // gamma-flip cyan — spot axis guide

class GexHeatmapRenderer implements IPrimitivePaneRenderer {
  constructor(
    private readonly _rects: readonly HeatmapRect[],
    private readonly _spotY: number | null
  ) {}

  draw(target: PaneRendererTarget): void {
    target.useMediaCoordinateSpace((scope) => {
      const ctx = scope.context;
      for (const r of this._rects) {
        ctx.fillStyle = r.color;
        ctx.fillRect(r.x, r.y, r.w, r.h);
      }
      if (this._spotY != null && Number.isFinite(this._spotY)) {
        const y = this._spotY;
        ctx.save();
        ctx.strokeStyle = SPOT_LINE_COLOR;
        ctx.lineWidth = 1.5;
        ctx.setLineDash([6, 4]);
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(scope.mediaSize.width, y);
        ctx.stroke();
        ctx.restore();
      }
    });
  }
}

class GexHeatmapPaneView implements IPrimitivePaneView {
  constructor(private readonly _source: GexHeatmapPrimitive) {}

  // Bottom of the visual stack → under candles, walls, beads, and every overlay series.
  zOrder(): PrimitivePaneViewZOrder {
    return "bottom";
  }

  renderer(): IPrimitivePaneRenderer | null {
    const rects = this._source.computeRects();
    const spotY = this._source.spotCoordinate();
    if (!rects.length && spotY == null) return null;
    return new GexHeatmapRenderer(rects, spotY);
  }
}

export class GexHeatmapPrimitive implements ISeriesPrimitive<Time> {
  private _chart: IChartApi | null = null;
  private _series: AttachedSeries | null = null;
  private _requestUpdate: (() => void) | null = null;
  private _grid: GexHeatmapGrid | null = null;
  private _visible = false;
  /** Live spot — horizontal guide aligned with candle price scale. */
  private _spot: number | null = null;
  // A stable single-view array — the library caches on the array reference, so it must not churn.
  private readonly _paneViews: readonly IPrimitivePaneView[] = [new GexHeatmapPaneView(this)];

  attached(param: SeriesAttachedParameter<Time>): void {
    this._chart = param.chart;
    this._series = param.series;
    this._requestUpdate = param.requestUpdate;
  }

  detached(): void {
    this._chart = null;
    this._series = null;
    this._requestUpdate = null;
  }

  paneViews(): readonly IPrimitivePaneView[] {
    return this._paneViews;
  }

  /**
   * Push the horizon-scoped grid + the toggle state. Requests a redraw so the surface appears/clears
   * the instant the fetch lands or the member flips the toggle — no wait for the next tick.
   */
  setData(grid: GexHeatmapGrid | null, visible: boolean): void {
    this._grid = grid;
    this._visible = visible;
    this._requestUpdate?.();
  }

  /** Pin spot price line to chart y-axis (updates every SSE tick). */
  setSpot(spot: number | null): void {
    if (this._spot === spot) return;
    this._spot = spot;
    this._requestUpdate?.();
  }

  /**
   * Project the current grid to media-space rects using the LIVE axis coordinates (recomputed every
   * frame by the caller). Returns [] whenever there's nothing honest to draw — invisible, no grid,
   * empty grid, or not yet attached — which the pane view turns into a null renderer.
   */
  computeRects(): HeatmapRect[] {
    if (!this._visible || !this._grid || !this._chart || !this._series) return [];
    const timeScale = this._chart.timeScale();
    const series = this._series;
    return heatmapRects(
      this._grid,
      (time) => timeScale.timeToCoordinate(time as Time),
      (strike) => series.priceToCoordinate(strike)
    );
  }

  spotCoordinate(): number | null {
    if (!this._series || this._spot == null || !Number.isFinite(this._spot)) return null;
    return this._series.priceToCoordinate(this._spot);
  }
}
