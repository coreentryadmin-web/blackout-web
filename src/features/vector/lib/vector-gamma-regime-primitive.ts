import type {
  ISeriesApi,
  SeriesType,
  Time,
  ISeriesPrimitive,
  IPrimitivePaneView,
  IPrimitivePaneRenderer,
  PrimitivePaneViewZOrder,
  SeriesAttachedParameter,
} from "lightweight-charts";
import {
  gammaRegimeGeometry,
  zoneGradientStops,
  GAMMA_REGIME_EXTENT_PX,
  GAMMA_REGIME_PEAK_ALPHA,
  type GammaRegimeGeometry,
} from "./vector-gamma-regime-paint";

/**
 * Dealer-gamma REGIME boundary glow as a lightweight-charts SERIES PRIMITIVE.
 *
 * Today the long-γ (pinned) vs short-γ (unstable) regime only exists as a TEXT banner; this puts it
 * on the tape. The gamma FLIP is where net dealer gamma changes sign, so it is a regime BOUNDARY:
 * ABOVE the flip dealers are long gamma → they hedge against moves → calm/mean-reverting (cool teal);
 * BELOW the flip dealers are short gamma → they hedge with moves → unstable/trending (warm amber).
 *
 * Why a primitive: it must map onto the SAME axes as the candles (y = price via the candle series'
 * price scale) and re-project every frame through pan/zoom/tick. lightweight-charts' primitive
 * contract does exactly this — `paneViews()[0].renderer().draw()` fills the pane canvas, re-invoked
 * each frame, so mapping flip→y INSIDE the renderer keeps the glow pinned to the flip price.
 *
 * Why a localized boundary glow (not a full-pane wash): the pane already carries the default-on GEX
 * heatmap surface (also zOrder "bottom"). A second wash would muddy it, so this fades to zero alpha
 * within ~52px each side of the flip and peaks at a LOW alpha (≈0.12) — an ambience cue that leaves
 * the heatmap, candles and beads dominant. Attached AFTER the heatmap so, within the shared "bottom"
 * layer, the glow sits just over the heatmap yet still under the candles.
 *
 * Data + visibility are pushed via `setData({ flip, spot, enabled })`; a null/non-finite flip, an
 * unavailable coordinate, or `enabled === false` makes the renderer return null → nothing is drawn
 * (honest absence — the regime is never fabricated). Default OFF: members opt into this new visual.
 */

type PaneRendererTarget = Parameters<IPrimitivePaneRenderer["draw"]>[0];
type AttachedSeries = ISeriesApi<SeriesType, Time>;

/** Label typography — subtle, matched to the glow so it reads as annotation, not chrome. */
const LABEL_FONT = "600 10px ui-sans-serif, system-ui, -apple-system, sans-serif";
const LABEL_ALPHA = 0.72;
const LABEL_X = 8;
const LABEL_GAP = 5;

class GammaRegimeRenderer implements IPrimitivePaneRenderer {
  constructor(
    private readonly _geo: GammaRegimeGeometry,
    private readonly _overlayDim: number
  ) {}

  draw(target: PaneRendererTarget): void {
    target.useMediaCoordinateSpace((scope) => {
      const ctx = scope.context;
      ctx.save();
      ctx.globalAlpha = this._overlayDim;
      const width = scope.mediaSize.width;
      const geo = this._geo;

      // Calm / long-gamma zone above the flip: teal fading up from the flip (peak) to the top edge (0).
      const aboveGrad = ctx.createLinearGradient(0, geo.topY, 0, geo.flipY);
      for (const s of zoneGradientStops(geo.above, "above")) aboveGrad.addColorStop(s.offset, s.color);
      ctx.fillStyle = aboveGrad;
      ctx.fillRect(0, geo.topY, width, geo.flipY - geo.topY);

      // Unstable / short-gamma zone below the flip: amber fading down from the flip (peak) to the edge.
      const belowGrad = ctx.createLinearGradient(0, geo.flipY, 0, geo.bottomY);
      for (const s of zoneGradientStops(geo.below, "below")) belowGrad.addColorStop(s.offset, s.color);
      ctx.fillStyle = belowGrad;
      ctx.fillRect(0, geo.flipY, width, geo.bottomY - geo.flipY);

      // Tiny posture labels hugging the flip on the left margin (away from the right price axis, so
      // they don't fight its ticks). Low alpha keeps them ambient.
      ctx.save();
      ctx.font = LABEL_FONT;
      ctx.fillStyle = `rgba(${geo.above.rgb}, ${LABEL_ALPHA})`;
      ctx.textBaseline = "bottom";
      ctx.fillText(geo.above.label, LABEL_X, geo.flipY - LABEL_GAP);
      ctx.fillStyle = `rgba(${geo.below.rgb}, ${LABEL_ALPHA})`;
      ctx.textBaseline = "top";
      ctx.fillText(geo.below.label, LABEL_X, geo.flipY + LABEL_GAP);
      ctx.restore();
      ctx.restore();
    });
  }
}

class GammaRegimePaneView implements IPrimitivePaneView {
  constructor(private readonly _source: GammaRegimePrimitive) {}

  // Bottom of the visual stack → under candles, walls, beads and overlays (over the heatmap by
  // attach order). The glow is ambience; nothing the member reads should sit beneath it.
  zOrder(): PrimitivePaneViewZOrder {
    return "bottom";
  }

  renderer(): IPrimitivePaneRenderer | null {
    const geo = this._source.geometry();
    if (!geo) return null;
    return new GammaRegimeRenderer(geo, this._source.overlayDim());
  }
}

export type GammaRegimeInput = { flip: number | null; spot: number | null; enabled: boolean };

export class GammaRegimePrimitive implements ISeriesPrimitive<Time> {
  // The regime glow is priced entirely off the SERIES price scale (priceToCoordinate); unlike the
  // GEX heatmap it needs no time-scale mapping, so we deliberately don't retain the chart handle.
  private _series: AttachedSeries | null = null;
  private _requestUpdate: (() => void) | null = null;
  private _flip: number | null = null;
  private _spot: number | null = null;
  private _enabled = false;
  private _overlayDim = 1;
  // Stable single-view array — the library caches on the array reference, so it must not churn.
  private readonly _paneViews: readonly IPrimitivePaneView[] = [new GammaRegimePaneView(this)];

  attached(param: SeriesAttachedParameter<Time>): void {
    this._series = param.series;
    this._requestUpdate = param.requestUpdate;
  }

  detached(): void {
    this._series = null;
    this._requestUpdate = null;
  }

  paneViews(): readonly IPrimitivePaneView[] {
    return this._paneViews;
  }

  /**
   * Push the current flip + live spot + toggle state. Requests a redraw so the glow appears/moves/
   * clears the instant the flip shifts, the spot ticks, or the member flips the toggle.
   */
  setData({ flip, spot, enabled }: GammaRegimeInput): void {
    this._flip = flip;
    this._spot = spot;
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

  /**
   * Project the flip to a media-space y-coordinate and resolve the zone geometry. Returns null
   * whenever there's nothing honest to draw — disabled, no flip, or not attached — which the pane
   * view turns into a null renderer (no draw).
   */
  geometry(): GammaRegimeGeometry | null {
    if (!this._enabled || !this._series || this._flip == null) return null;
    const flipY = this._series.priceToCoordinate(this._flip);
    return gammaRegimeGeometry({
      flip: this._flip,
      spot: this._spot,
      flipY: flipY ?? null,
      extentPx: GAMMA_REGIME_EXTENT_PX,
      peakAlpha: GAMMA_REGIME_PEAK_ALPHA,
    });
  }
}
