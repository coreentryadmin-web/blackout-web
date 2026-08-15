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
import type { VolumeProfile } from "./vector-volume-profile";

/**
 * SESSION VOLUME PROFILE as a lightweight-charts SERIES PRIMITIVE — horizontal bars anchored to the
 * RIGHT edge of the pane (the conventional side, nearest the price scale), one per price bucket,
 * length proportional to that bucket's share of the session's volume. Same right-margin anchoring
 * technique `PinConePrimitive` uses (pixel-space, not time-scale — a profile has no time axis), and
 * the same zOrder:"bottom" background-layer convention `GexHeatmapPrimitive`/`GammaRegimePrimitive`
 * use, so it reads as ambient reference under the candles/beads, not a foreground overlay.
 *
 * The value-area band (buckets covering ~70% of volume around the POC) draws at a brighter alpha
 * than buckets outside it; the POC bucket gets a full-width highlight line so it reads as a single
 * price level, the same visual treatment `applyKingAnchor`/`applyMaxPainLine` give other
 * single-price markers.
 *
 * Data + visibility via `setData(profile, enabled)`; an empty profile or `enabled === false` makes
 * the renderer return null → nothing drawn (honest absence, never a fabricated profile).
 */

type PaneRendererTarget = Parameters<IPrimitivePaneRenderer["draw"]>[0];
type AttachedSeries = ISeriesApi<SeriesType, Time>;

const BAR_FILL = "rgba(148, 163, 184, 0.18)";
const VALUE_AREA_FILL = "rgba(56, 189, 248, 0.28)";
const POC_FILL = "rgba(253, 224, 71, 0.9)";
const POC_LINE = "rgba(253, 224, 71, 0.55)";
/** Widest a bucket bar can extend from the right edge, as a fraction of the pane width. */
const MAX_BAR_WIDTH_FRAC = 0.16;
const RIGHT_PAD_PX = 2;

type ProjectedBucket = { yTop: number; yBottom: number; xLeft: number; isPoc: boolean; inValueArea: boolean };
type Projected = { rightX: number; pocY: number | null; bars: ProjectedBucket[] };

class VolumeProfileRenderer implements IPrimitivePaneRenderer {
  constructor(
    private readonly _p: Projected,
    private readonly _overlayDim: number
  ) {}

  draw(target: PaneRendererTarget): void {
    target.useMediaCoordinateSpace((scope) => {
      const ctx = scope.context;
      ctx.save();
      ctx.globalAlpha = this._overlayDim;
      const { rightX, pocY, bars } = this._p;
      for (const b of bars) {
        ctx.fillStyle = b.isPoc ? POC_FILL : b.inValueArea ? VALUE_AREA_FILL : BAR_FILL;
        const top = Math.min(b.yTop, b.yBottom);
        const height = Math.max(1, Math.abs(b.yBottom - b.yTop));
        ctx.fillRect(b.xLeft, top, rightX - b.xLeft, height);
      }
      if (pocY != null) {
        ctx.strokeStyle = POC_LINE;
        ctx.lineWidth = 1;
        ctx.setLineDash([2, 3]);
        ctx.beginPath();
        ctx.moveTo(0, pocY);
        ctx.lineTo(scope.mediaSize.width, pocY);
        ctx.stroke();
        ctx.setLineDash([]);
      }
      ctx.restore();
    });
  }
}

class VolumeProfilePaneView implements IPrimitivePaneView {
  constructor(private readonly _source: VolumeProfilePrimitive) {}
  // Background reference layer — under candles/beads, alongside the GEX heatmap/gamma-regime glow.
  zOrder(): PrimitivePaneViewZOrder {
    return "bottom";
  }
  renderer(): IPrimitivePaneRenderer | null {
    const projected = this._source.project();
    if (!projected || !projected.bars.length) return null;
    return new VolumeProfileRenderer(projected, this._source.overlayDim());
  }
}

export class VolumeProfilePrimitive implements ISeriesPrimitive<Time> {
  private _chart: IChartApi | null = null;
  private _series: AttachedSeries | null = null;
  private _requestUpdate: (() => void) | null = null;
  private _profile: VolumeProfile | null = null;
  private _enabled = false;
  private _overlayDim = 1;
  private readonly _paneViews: readonly IPrimitivePaneView[] = [new VolumeProfilePaneView(this)];

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

  setData(profile: VolumeProfile | null, enabled: boolean): void {
    this._profile = profile;
    this._enabled = enabled;
    this._requestUpdate?.();
  }

  overlayDim(): number {
    return this._overlayDim;
  }

  setOverlayDim(factor: number): void {
    const next = Math.max(0, Math.min(1, factor));
    if (Math.abs(next - this._overlayDim) < 0.02) return;
    this._overlayDim = next;
    this._requestUpdate?.();
  }

  /** Project buckets to media-space bars anchored to the right edge. Returns null when there's
   *  nothing honest to draw (disabled, empty profile, not attached, or no room in the pane). */
  project(): Projected | null {
    if (!this._enabled || !this._profile || !this._chart || !this._series) return null;
    const profile = this._profile;
    if (!profile.buckets.length || profile.maxVolume <= 0) return null;
    const width = this._chart.paneSize?.().width ?? this._chart.timeScale().width();
    if (!(width > 0)) return null;
    const rightX = width - RIGHT_PAD_PX;
    const maxBarWidth = width * MAX_BAR_WIDTH_FRAC;
    const series = this._series;
    const half = profile.bucketSize / 2;

    const bars: ProjectedBucket[] = [];
    let pocY: number | null = null;
    for (const b of profile.buckets) {
      const yTop = series.priceToCoordinate(b.price + half);
      const yBottom = series.priceToCoordinate(b.price - half);
      if (yTop == null || yBottom == null) continue;
      const isPoc = profile.poc != null && b.price === profile.poc;
      const inValueArea =
        profile.valueAreaLow != null &&
        profile.valueAreaHigh != null &&
        b.price >= profile.valueAreaLow &&
        b.price <= profile.valueAreaHigh;
      const frac = b.volume / profile.maxVolume;
      const barWidth = Math.max(1, frac * maxBarWidth);
      bars.push({ yTop, yBottom, xLeft: rightX - barWidth, isPoc, inValueArea });
      if (isPoc) pocY = series.priceToCoordinate(b.price) ?? null;
    }
    if (!bars.length) return null;
    return { rightX, pocY, bars };
  }
}
