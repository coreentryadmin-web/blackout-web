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
 * Palette is deliberately OFF the bead/wall hues (no yellow/magenta/cyan beads): warm stone outside
 * the value area, violet inside it, amber POC — plus labeled POC / VAH / VAL guide lines.
 *
 * Data + visibility via `setData(profile, enabled)`; an empty profile or `enabled === false` makes
 * the renderer return null → nothing drawn (honest absence, never a fabricated profile).
 */

type PaneRendererTarget = Parameters<IPrimitivePaneRenderer["draw"]>[0];
type AttachedSeries = ISeriesApi<SeriesType, Time>;

/** Outside the ~70% value area — neutral warm gray, low alpha. */
export const VP_BAR_FILL = "rgba(161, 161, 170, 0.16)";
/** Value-area buckets — violet, distinct from put/call bead rails. */
export const VP_VALUE_AREA_FILL = "rgba(192, 132, 252, 0.32)";
/** POC bucket highlight. */
export const VP_POC_FILL = "rgba(251, 191, 36, 0.88)";
/** POC full-width guide. */
export const VP_POC_LINE = "rgba(251, 191, 36, 0.72)";
/** VAH / VAL boundary guides. */
export const VP_VA_LINE = "rgba(196, 181, 253, 0.62)";
export const VP_LABEL_COLOR = "rgba(250, 250, 250, 0.92)";

/** Widest a bucket bar can extend from the right edge, as a fraction of the pane width. */
const MAX_BAR_WIDTH_FRAC = 0.16;
const RIGHT_PAD_PX = 2;
const LABEL_FONT = "600 10px ui-monospace, SFMono-Regular, Menlo, monospace";

type ProjectedLevel = { y: number; label: string; color: string; dash: number[] };
type ProjectedBucket = { yTop: number; yBottom: number; xLeft: number; isPoc: boolean; inValueArea: boolean };
type Projected = {
  rightX: number;
  bars: ProjectedBucket[];
  levels: ProjectedLevel[];
};

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
      const { rightX, bars, levels } = this._p;
      const paneW = scope.mediaSize.width;

      for (const b of bars) {
        ctx.fillStyle = b.isPoc ? VP_POC_FILL : b.inValueArea ? VP_VALUE_AREA_FILL : VP_BAR_FILL;
        const top = Math.min(b.yTop, b.yBottom);
        const height = Math.max(1, Math.abs(b.yBottom - b.yTop));
        ctx.fillRect(b.xLeft, top, rightX - b.xLeft, height);
      }

      for (const lvl of levels) {
        ctx.strokeStyle = lvl.color;
        ctx.lineWidth = lvl.label === "POC" ? 1.5 : 1;
        ctx.setLineDash(lvl.dash);
        ctx.beginPath();
        ctx.moveTo(0, lvl.y);
        ctx.lineTo(paneW, lvl.y);
        ctx.stroke();
        ctx.setLineDash([]);

        ctx.font = LABEL_FONT;
        ctx.fillStyle = VP_LABEL_COLOR;
        ctx.textAlign = "right";
        ctx.textBaseline = "middle";
        ctx.fillText(lvl.label, rightX - 6, lvl.y);
      }

      ctx.restore();
    });
  }
}

class VolumeProfilePaneView implements IPrimitivePaneView {
  constructor(private readonly _source: VolumeProfilePrimitive) {}
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
    const pocPrice = profile.poc;

    const bars: ProjectedBucket[] = [];
    for (const b of profile.buckets) {
      const yTop = series.priceToCoordinate(b.price + half);
      const yBottom = series.priceToCoordinate(b.price - half);
      if (yTop == null || yBottom == null) continue;
      const isPoc = pocPrice != null && Math.abs(b.price - pocPrice) <= (half || 1e-9);
      const inValueArea =
        profile.valueAreaLow != null &&
        profile.valueAreaHigh != null &&
        b.price >= profile.valueAreaLow &&
        b.price <= profile.valueAreaHigh;
      const frac = b.volume / profile.maxVolume;
      const barWidth = Math.max(1, frac * maxBarWidth);
      bars.push({ yTop, yBottom, xLeft: rightX - barWidth, isPoc, inValueArea });
    }
    if (!bars.length) return null;

    const levels: ProjectedLevel[] = [];
    const addLevel = (price: number | null, label: string, color: string, dash: number[]) => {
      if (price == null || !Number.isFinite(price)) return;
      const y = series.priceToCoordinate(price);
      if (y == null) return;
      levels.push({ y, label, color, dash });
    };
    addLevel(profile.poc, "POC", VP_POC_LINE, [4, 3]);
    addLevel(profile.valueAreaHigh, "VAH", VP_VA_LINE, [6, 4]);
    addLevel(profile.valueAreaLow, "VAL", VP_VA_LINE, [6, 4]);

    return { rightX, bars, levels };
  }
}
