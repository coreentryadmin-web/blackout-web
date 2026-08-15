import type {
  IChartApi,
  Time,
  ISeriesPrimitive,
  IPrimitivePaneView,
  IPrimitivePaneRenderer,
  PrimitivePaneViewZOrder,
  SeriesAttachedParameter,
} from "lightweight-charts";
import type { ExtendedHoursShadeBand } from "@/features/vector/lib/vector-session-hours";

type PaneRendererTarget = Parameters<IPrimitivePaneRenderer["draw"]>[0];

/** TradingView-style muted vertical wash behind extended-hours candles. */
export const VECTOR_EXTENDED_HOURS_SHADE_RGBA = "rgba(148, 163, 184, 0.08)";
export const VECTOR_PREMARKET_SHADE_RGBA = "rgba(148, 163, 184, 0.1)";

class ExtendedHoursShadeRenderer implements IPrimitivePaneRenderer {
  constructor(
    private readonly _rects: readonly { x1: number; x2: number; color: string }[],
    private readonly _overlayDim: number
  ) {}

  draw(target: PaneRendererTarget): void {
    if (!this._rects.length) return;
    target.useMediaCoordinateSpace((scope) => {
      const ctx = scope.context;
      const height = scope.mediaSize.height;
      ctx.save();
      ctx.globalAlpha = this._overlayDim;
      for (const r of this._rects) {
        const w = r.x2 - r.x1;
        if (!(w > 0.5)) continue;
        ctx.fillStyle = r.color;
        ctx.fillRect(r.x1, 0, w, height);
      }
      ctx.restore();
    });
  }
}

class ExtendedHoursShadePaneView implements IPrimitivePaneView {
  constructor(private readonly _source: ExtendedHoursShadePrimitive) {}

  zOrder(): PrimitivePaneViewZOrder {
    return "bottom";
  }

  renderer(): IPrimitivePaneRenderer | null {
    const rects = this._source.computeRects();
    if (!rects.length) return null;
    return new ExtendedHoursShadeRenderer(rects, this._source.overlayDim());
  }
}

export class ExtendedHoursShadePrimitive implements ISeriesPrimitive<Time> {
  private _chart: IChartApi | null = null;
  private _requestUpdate: (() => void) | null = null;
  private _bands: ExtendedHoursShadeBand[] = [];
  private _overlayDim = 1;
  private readonly _paneViews: readonly IPrimitivePaneView[] = [new ExtendedHoursShadePaneView(this)];

  attached(param: SeriesAttachedParameter<Time>): void {
    this._chart = param.chart;
    this._requestUpdate = param.requestUpdate;
  }

  detached(): void {
    this._chart = null;
    this._requestUpdate = null;
  }

  paneViews(): readonly IPrimitivePaneView[] {
    return this._paneViews;
  }

  setBands(bands: ExtendedHoursShadeBand[]): void {
    this._bands = bands;
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

  computeRects(): { x1: number; x2: number; color: string }[] {
    if (!this._chart || !this._bands.length) return [];
    const timeScale = this._chart.timeScale();
    const out: { x1: number; x2: number; color: string }[] = [];
    for (const band of this._bands) {
      const x1 = timeScale.timeToCoordinate(band.fromSec as Time);
      const x2 = timeScale.timeToCoordinate(band.toSec as Time);
      if (x1 == null || x2 == null) continue;
      out.push({
        x1: Math.min(x1, x2),
        x2: Math.max(x1, x2),
        color: band.kind === "premarket" ? VECTOR_PREMARKET_SHADE_RGBA : VECTOR_EXTENDED_HOURS_SHADE_RGBA,
      });
    }
    return out;
  }
}
