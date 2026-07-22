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

/**
 * EOD PIN CONE as a lightweight-charts SERIES PRIMITIVE (SPX desk). Draws the Monte-Carlo close
 * distribution as a shaded p10–p90 band + a p50 centre line, projected into the chart's RIGHT MARGIN
 * from "now" (the last candle) toward the 16:00 close — so it reads as a curve converging on the pin.
 *
 * WHY a right-margin projection (not future-time whitespace): the cone lives in the future (now→
 * 16:00), which the chart's time axis doesn't cover, so `timeToCoordinate` can't map it. Rather than
 * mutate the candle series with future whitespace bars (which would compress the whole day's tape),
 * this maps each cone step by its FRACTION of time-to-close into a fixed pixel band to the right of
 * the last candle: x = lastCandleX + (1 − tMin/tMinNow)·bandWidth. Price still maps through the real
 * price scale (`priceToCoordinate`), so the band sits at the correct heights. The caller widens the
 * chart's `rightOffset` so the band has room.
 *
 * Data + visibility via `setData(cone, lastBarTime, visible)`; empty/invisible → renderer returns
 * null → nothing drawn (honest absence). Colours match the pin line (--sig-king gold).
 */

export type PinConeStep = { tMin: number; p10: number; p50: number; p90: number };

type PaneRendererTarget = Parameters<IPrimitivePaneRenderer["draw"]>[0];
type AttachedSeries = ISeriesApi<SeriesType, Time>;

const CONE_GOLD = "#ffd23f";
const BAND_FILL = "rgba(255, 210, 63, 0.10)"; // translucent gold band (p10–p90)
const P50_LINE = "rgba(255, 210, 63, 0.85)";
const EDGE_LINE = "rgba(255, 210, 63, 0.30)";
/** Fraction of the space between the last candle and the right edge the cone spans. */
const BAND_RIGHT_PAD_PX = 6;

type ConeProjected = { xs: number[]; p10y: number[]; p50y: number[]; p90y: number[] };

class PinConeRenderer implements IPrimitivePaneRenderer {
  constructor(private readonly _p: ConeProjected) {}

  draw(target: PaneRendererTarget): void {
    target.useMediaCoordinateSpace((scope) => {
      const ctx = scope.context;
      const { xs, p10y, p50y, p90y } = this._p;
      if (xs.length < 2) return;
      // Filled p10–p90 polygon: p90 path left→right, then p10 path right→left.
      ctx.beginPath();
      ctx.moveTo(xs[0]!, p90y[0]!);
      for (let i = 1; i < xs.length; i++) ctx.lineTo(xs[i]!, p90y[i]!);
      for (let i = xs.length - 1; i >= 0; i--) ctx.lineTo(xs[i]!, p10y[i]!);
      ctx.closePath();
      ctx.fillStyle = BAND_FILL;
      ctx.fill();
      // Edge lines (p10 / p90) — faint gold.
      ctx.strokeStyle = EDGE_LINE;
      ctx.lineWidth = 1;
      for (const ys of [p10y, p90y]) {
        ctx.beginPath();
        ctx.moveTo(xs[0]!, ys[0]!);
        for (let i = 1; i < xs.length; i++) ctx.lineTo(xs[i]!, ys[i]!);
        ctx.stroke();
      }
      // p50 centre line — brighter gold.
      ctx.strokeStyle = P50_LINE;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(xs[0]!, p50y[0]!);
      for (let i = 1; i < xs.length; i++) ctx.lineTo(xs[i]!, p50y[i]!);
      ctx.stroke();
      // A small gold dot at the projected close (p50 tip).
      ctx.fillStyle = CONE_GOLD;
      ctx.beginPath();
      ctx.arc(xs[xs.length - 1]!, p50y[p50y.length - 1]!, 3, 0, Math.PI * 2);
      ctx.fill();
    });
  }
}

class PinConePaneView implements IPrimitivePaneView {
  constructor(private readonly _source: PinConePrimitive) {}
  // Above the candles so the cone reads as an overlay projection (translucent fill keeps tape visible).
  zOrder(): PrimitivePaneViewZOrder {
    return "top";
  }
  renderer(): IPrimitivePaneRenderer | null {
    const projected = this._source.project();
    if (!projected || projected.xs.length < 2) return null;
    return new PinConeRenderer(projected);
  }
}

export class PinConePrimitive implements ISeriesPrimitive<Time> {
  private _chart: IChartApi | null = null;
  private _series: AttachedSeries | null = null;
  private _requestUpdate: (() => void) | null = null;
  private _cone: PinConeStep[] | null = null;
  private _lastBarTime: Time | null = null;
  private _visible = false;
  private readonly _paneViews: readonly IPrimitivePaneView[] = [new PinConePaneView(this)];

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

  setData(cone: PinConeStep[] | null, lastBarTime: Time | null, visible: boolean): void {
    this._cone = cone;
    this._lastBarTime = lastBarTime;
    this._visible = visible;
    this._requestUpdate?.();
  }

  /** Project the cone to media-space coords in the right margin. Returns null when there's nothing
   *  honest to draw (invisible, no cone, not attached, or no room to the right of the last candle). */
  project(): ConeProjected | null {
    if (!this._visible || !this._cone || this._cone.length < 2 || !this._chart || !this._series) return null;
    if (this._lastBarTime == null) return null;
    const timeScale = this._chart.timeScale();
    const series = this._series;
    const lastX = timeScale.timeToCoordinate(this._lastBarTime);
    if (lastX == null) return null;
    const width = this._chart.paneSize?.().width ?? null;
    // paneSize may be undefined on older builds — fall back to the time scale width.
    const rightX = (width ?? timeScale.width()) - BAND_RIGHT_PAD_PX;
    const band = rightX - lastX;
    if (!(band > 4)) return null;
    const tNow = this._cone[0]!.tMin;
    if (!(tNow > 0)) return null;
    const xs: number[] = [];
    const p10y: number[] = [];
    const p50y: number[] = [];
    const p90y: number[] = [];
    for (const s of this._cone) {
      const frac = Math.min(1, Math.max(0, 1 - s.tMin / tNow));
      const y10 = series.priceToCoordinate(s.p10);
      const y50 = series.priceToCoordinate(s.p50);
      const y90 = series.priceToCoordinate(s.p90);
      if (y10 == null || y50 == null || y90 == null) continue;
      xs.push(lastX + frac * band);
      p10y.push(y10);
      p50y.push(y50);
      p90y.push(y90);
    }
    if (xs.length < 2) return null;
    return { xs, p10y, p50y, p90y };
  }
}
