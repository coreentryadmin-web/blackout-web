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
import { gammaSurfaceRects, type SurfaceRect } from "./vector-gamma-surface-paint";

/**
 * Gamma Surface series primitive — a continuous call/neutral/put zone background behind candles.
 *
 * Follows the exact `GexHeatmapPrimitive` contract but renders aggregate ZONES (gold call territory
 * above the flip, teal neutral corridor around it, crimson put territory below) instead of per-cell
 * signed GEX. Consumes the same `GexHeatmapGrid` data — no new endpoint — but also needs a
 * `flipAtTime` callback to know where the regime boundary sits at each time column.
 *
 * Toggle: "gamma-surface" in the indicator menu. Default OFF. Does not disturb the bead model.
 */

type PaneRendererTarget = Parameters<IPrimitivePaneRenderer["draw"]>[0];
type AttachedSeries = ISeriesApi<SeriesType, Time>;

class GammaSurfaceRenderer implements IPrimitivePaneRenderer {
  constructor(private readonly _rects: readonly SurfaceRect[]) {}

  draw(target: PaneRendererTarget): void {
    target.useMediaCoordinateSpace((scope) => {
      const ctx = scope.context;
      for (const r of this._rects) {
        ctx.fillStyle = r.color;
        ctx.fillRect(r.x, r.y, r.w, r.h);
      }
    });
  }
}

class GammaSurfacePaneView implements IPrimitivePaneView {
  constructor(private readonly _source: GammaSurfacePrimitive) {}

  zOrder(): PrimitivePaneViewZOrder {
    return "bottom";
  }

  renderer(): IPrimitivePaneRenderer | null {
    const rects = this._source.computeRects();
    return rects.length ? new GammaSurfaceRenderer(rects) : null;
  }
}

export class GammaSurfacePrimitive implements ISeriesPrimitive<Time> {
  private _chart: IChartApi | null = null;
  private _series: AttachedSeries | null = null;
  private _requestUpdate: (() => void) | null = null;
  private _grid: GexHeatmapGrid | null = null;
  private _visible = false;
  private _flipAtTime: ((time: number) => number | null) | null = null;
  private readonly _paneViews: readonly IPrimitivePaneView[] = [new GammaSurfacePaneView(this)];

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
   * Push the horizon-scoped grid, toggle state, and flip callback. The flip callback lets the
   * surface resolve the gamma flip at each time column — it reads the live (possibly horizon-scoped)
   * flip so the zones track the regime in real time.
   */
  setData(
    grid: GexHeatmapGrid | null,
    visible: boolean,
    flipAtTime?: (time: number) => number | null
  ): void {
    this._grid = grid;
    this._visible = visible;
    if (flipAtTime !== undefined) this._flipAtTime = flipAtTime;
    this._requestUpdate?.();
  }

  computeRects(): SurfaceRect[] {
    if (!this._visible || !this._grid || !this._chart || !this._series || !this._flipAtTime)
      return [];
    const timeScale = this._chart.timeScale();
    const series = this._series;
    return gammaSurfaceRects(
      this._grid,
      (time) => timeScale.timeToCoordinate(time as Time),
      (strike) => series.priceToCoordinate(strike),
      this._flipAtTime
    );
  }
}
