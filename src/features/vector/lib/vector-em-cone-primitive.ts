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
import type { EmConeSample } from "./vector-em-cone";

/**
 * TIME-CONVERGING EXPECTED-MOVE CONE as a lightweight-charts SERIES PRIMITIVE (opt-in Vector layer).
 *
 * The flat ±1σ/2σ price-lines (`applyExpectedMoveBand`) show the whole-session range; this draws the
 * move STILL AHEAD from "now" to the close as a shaded cone that funnels to the spot at 16:00 — wide
 * now, narrow at the close, because the remaining-time move budget decays with √time (the geometry
 * lives in `vector-em-cone.ts`; this only paints it). Default OFF — a new visual members opt into,
 * additive to (never replacing) the flat band.
 *
 * Why a right-margin projection (same trick as `PinConePrimitive`): the cone lives in the FUTURE
 * (now → 16:00), which the chart's time axis doesn't cover, so `timeToCoordinate` can't map it.
 * Rather than inject future whitespace bars (which would compress the whole day's tape), each sample
 * is placed by its FRACTION of time-to-close into a fixed pixel band to the right of the last candle:
 * x = lastCandleX + frac·bandWidth. Price still maps through the real price scale
 * (`priceToCoordinate`), so the σ1/σ2 edges sit at the correct heights. The chart's `rightOffset`
 * already reserves the margin (shared with the pin cone).
 *
 * Colours match the "Expected move" cyan swatch (#22d3ee) at LOW alpha and it renders at zOrder
 * "bottom" so it coexists with the default-on GEX heatmap + gamma-regime glow without muddying them
 * or the candles. Data + visibility via `setData(samples, lastBarTime, visible)`; a null/short
 * samples array, an invisible toggle, or an unmappable coordinate → renderer returns null → nothing
 * drawn (honest absence — never a fabricated cone).
 */

type PaneRendererTarget = Parameters<IPrimitivePaneRenderer["draw"]>[0];
type AttachedSeries = ISeriesApi<SeriesType, Time>;

const EM_CYAN = "#34, 211, 238"; // rgb of #22d3ee — matches the flat-band + menu swatch
const SIGMA1_FILL = `rgba(${EM_CYAN}, 0.08)`; // faint filled σ=1 band
const SIGMA1_EDGE = `rgba(${EM_CYAN}, 0.30)`;
const SIGMA2_EDGE = `rgba(${EM_CYAN}, 0.16)`; // ±2σ drawn only as fainter edge lines
/** Pixels of breathing room between the cone tip and the right edge of the pane. */
const CONE_RIGHT_PAD_PX = 6;

type ConeProjected = {
  xs: number[];
  u1: number[];
  l1: number[];
  u2: number[];
  l2: number[];
};

class EmConeRenderer implements IPrimitivePaneRenderer {
  constructor(private readonly _p: ConeProjected) {}

  draw(target: PaneRendererTarget): void {
    target.useMediaCoordinateSpace((scope) => {
      const ctx = scope.context;
      const { xs, u1, l1, u2, l2 } = this._p;
      if (xs.length < 2) return;
      // Filled σ=1 band: upper edge left→right, then lower edge right→left.
      ctx.beginPath();
      ctx.moveTo(xs[0]!, u1[0]!);
      for (let i = 1; i < xs.length; i++) ctx.lineTo(xs[i]!, u1[i]!);
      for (let i = xs.length - 1; i >= 0; i--) ctx.lineTo(xs[i]!, l1[i]!);
      ctx.closePath();
      ctx.fillStyle = SIGMA1_FILL;
      ctx.fill();
      // ±2σ edge lines — fainter, no fill (keeps the low-alpha wash from stacking to opaque).
      ctx.strokeStyle = SIGMA2_EDGE;
      ctx.lineWidth = 1;
      for (const ys of [u2, l2]) {
        ctx.beginPath();
        ctx.moveTo(xs[0]!, ys[0]!);
        for (let i = 1; i < xs.length; i++) ctx.lineTo(xs[i]!, ys[i]!);
        ctx.stroke();
      }
      // ±1σ edge lines — slightly brighter than the fill so the band reads.
      ctx.strokeStyle = SIGMA1_EDGE;
      ctx.lineWidth = 1;
      for (const ys of [u1, l1]) {
        ctx.beginPath();
        ctx.moveTo(xs[0]!, ys[0]!);
        for (let i = 1; i < xs.length; i++) ctx.lineTo(xs[i]!, ys[i]!);
        ctx.stroke();
      }
    });
  }
}

class EmConePaneView implements IPrimitivePaneView {
  constructor(private readonly _source: EmConePrimitive) {}
  // Bottom of the stack → under candles, walls, beads and the flat EM lines. The cone is ambience;
  // nothing the member clicks should sit beneath it, and the low alpha keeps the heatmap readable.
  zOrder(): PrimitivePaneViewZOrder {
    return "bottom";
  }
  renderer(): IPrimitivePaneRenderer | null {
    const projected = this._source.project();
    if (!projected || projected.xs.length < 2) return null;
    return new EmConeRenderer(projected);
  }
}

export class EmConePrimitive implements ISeriesPrimitive<Time> {
  private _chart: IChartApi | null = null;
  private _series: AttachedSeries | null = null;
  private _requestUpdate: (() => void) | null = null;
  private _samples: EmConeSample[] | null = null;
  private _lastBarTime: Time | null = null;
  private _visible = false;
  private readonly _paneViews: readonly IPrimitivePaneView[] = [new EmConePaneView(this)];

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

  setData(samples: EmConeSample[] | null, lastBarTime: Time | null, visible: boolean): void {
    this._samples = samples;
    this._lastBarTime = lastBarTime;
    this._visible = visible;
    this._requestUpdate?.();
  }

  /** Project the cone samples to media-space coords in the right margin. Null when there's nothing
   *  honest to draw (invisible, no samples, not attached, no room, or unmappable coordinates). */
  project(): ConeProjected | null {
    if (!this._visible || !this._samples || this._samples.length < 2 || !this._chart || !this._series) {
      return null;
    }
    if (this._lastBarTime == null) return null;
    const timeScale = this._chart.timeScale();
    const series = this._series;
    const lastX = timeScale.timeToCoordinate(this._lastBarTime);
    if (lastX == null) return null;
    const width = this._chart.paneSize?.().width ?? null;
    // paneSize may be undefined on older builds — fall back to the time-scale width.
    const rightX = (width ?? timeScale.width()) - CONE_RIGHT_PAD_PX;
    const band = rightX - lastX;
    if (!(band > 4)) return null;
    const first = this._samples[0]!;
    const last = this._samples[this._samples.length - 1]!;
    const span = last.etMin - first.etMin;
    if (!(span > 0)) return null;
    const xs: number[] = [];
    const u1: number[] = [];
    const l1: number[] = [];
    const u2: number[] = [];
    const l2: number[] = [];
    for (const s of this._samples) {
      const frac = Math.min(1, Math.max(0, (s.etMin - first.etMin) / span));
      const yu1 = series.priceToCoordinate(s.upper1);
      const yl1 = series.priceToCoordinate(s.lower1);
      const yu2 = series.priceToCoordinate(s.upper2);
      const yl2 = series.priceToCoordinate(s.lower2);
      if (yu1 == null || yl1 == null || yu2 == null || yl2 == null) continue;
      xs.push(lastX + frac * band);
      u1.push(yu1);
      l1.push(yl1);
      u2.push(yu2);
      l2.push(yl2);
    }
    if (xs.length < 2) return null;
    return { xs, u1, l1, u2, l2 };
  }
}
