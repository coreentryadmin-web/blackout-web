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
import {
  VECTOR_DRAW_COLORS,
  fibPrices,
  rayEndPoint,
  type VectorDrawing,
} from "./vector-drawings";

type PaneRendererTarget = Parameters<IPrimitivePaneRenderer["draw"]>[0];
type AttachedSeries = ISeriesApi<SeriesType, Time>;

type ProjectedLine = { x1: number; y1: number; x2: number; y2: number; color: string; width: number; dash?: number[] };
type ProjectedRect = { x1: number; y1: number; x2: number; y2: number; fill: string; stroke: string };
type ProjectedText = { x: number; y: number; text: string; color: string };
type ProjectedVLine = { x: number; color: string; label?: string };

type ProjectedFrame = {
  lines: ProjectedLine[];
  rects: ProjectedRect[];
  texts: ProjectedText[];
  vlines: ProjectedVLine[];
  selectedId: string | null;
  draft: { x1: number; y1: number; x2: number; y2: number; color: string } | null;
};

function withAlpha(hex: string, alpha: number): string {
  const h = hex.replace("#", "");
  if (h.length !== 6) return hex;
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

class DrawingsRenderer implements IPrimitivePaneRenderer {
  constructor(private readonly _f: ProjectedFrame) {}

  draw(target: PaneRendererTarget): void {
    target.useMediaCoordinateSpace((scope) => {
      const ctx = scope.context;
      const { lines, rects, texts, vlines, draft } = this._f;

      for (const r of rects) {
        const x = Math.min(r.x1, r.x2);
        const y = Math.min(r.y1, r.y2);
        const w = Math.abs(r.x2 - r.x1);
        const h = Math.abs(r.y2 - r.y1);
        ctx.fillStyle = r.fill;
        ctx.fillRect(x, y, w, h);
        ctx.strokeStyle = r.stroke;
        ctx.lineWidth = 1;
        ctx.strokeRect(x, y, w, h);
      }

      for (const vl of vlines) {
        ctx.strokeStyle = withAlpha(vl.color, 0.85);
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.moveTo(vl.x, 0);
        ctx.lineTo(vl.x, scope.mediaSize.height);
        ctx.stroke();
        ctx.setLineDash([]);
        if (vl.label) {
          ctx.fillStyle = vl.color;
          ctx.font = "10px ui-monospace, monospace";
          ctx.fillText(vl.label, vl.x + 4, 14);
        }
      }

      for (const ln of lines) {
        ctx.strokeStyle = ln.color;
        ctx.lineWidth = ln.width;
        ctx.setLineDash(ln.dash ?? []);
        ctx.beginPath();
        ctx.moveTo(ln.x1, ln.y1);
        ctx.lineTo(ln.x2, ln.y2);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      if (draft) {
        ctx.strokeStyle = withAlpha(draft.color, 0.7);
        ctx.lineWidth = 1.5;
        ctx.setLineDash([6, 4]);
        ctx.beginPath();
        ctx.moveTo(draft.x1, draft.y1);
        ctx.lineTo(draft.x2, draft.y2);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      for (const tx of texts) {
        ctx.fillStyle = tx.color;
        ctx.font = "11px ui-monospace, monospace";
        ctx.fillText(tx.text, tx.x + 4, tx.y - 4);
      }
    });
  }
}

class DrawingsPaneView implements IPrimitivePaneView {
  constructor(private readonly _source: UserDrawingsPrimitive) {}
  zOrder(): PrimitivePaneViewZOrder {
    return "top";
  }
  renderer(): IPrimitivePaneRenderer | null {
    const projected = this._source.project();
    if (
      projected.lines.length === 0 &&
      projected.rects.length === 0 &&
      projected.texts.length === 0 &&
      projected.vlines.length === 0 &&
      !projected.draft
    ) {
      return null;
    }
    return new DrawingsRenderer(projected);
  }
}

export type DraftAnchor = { t: number; p: number; color: string } | null;

export class UserDrawingsPrimitive implements ISeriesPrimitive<Time> {
  private _chart: IChartApi | null = null;
  private _series: AttachedSeries | null = null;
  private _requestUpdate: (() => void) | null = null;
  private _drawings: VectorDrawing[] = [];
  private _selectedId: string | null = null;
  private _draft: DraftAnchor = null;
  private _draftCursor: { t: number; p: number } | null = null;
  private readonly _paneViews: readonly IPrimitivePaneView[] = [new DrawingsPaneView(this)];

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

  setDrawings(drawings: readonly VectorDrawing[], selectedId: string | null): void {
    this._drawings = [...drawings];
    this._selectedId = selectedId;
    this._requestUpdate?.();
  }

  setDraft(anchor: DraftAnchor, cursor: { t: number; p: number } | null): void {
    this._draft = anchor;
    this._draftCursor = cursor;
    this._requestUpdate?.();
  }

  project(): ProjectedFrame {
    const chart = this._chart;
    const series = this._series;
    const frame: ProjectedFrame = {
      lines: [],
      rects: [],
      texts: [],
      vlines: [],
      selectedId: this._selectedId,
      draft: null,
    };
    if (!chart || !series) return frame;

    const ts = chart.timeScale();
    const rightTime =
      typeof ts.getVisibleRange()?.to === "number"
        ? (ts.getVisibleRange()!.to as number)
        : Math.floor(Date.now() / 1000);

    const toXY = (t: number, p: number): { x: number; y: number } | null => {
      const x = ts.timeToCoordinate(t as Time);
      const y = series.priceToCoordinate(p);
      if (x == null || y == null) return null;
      return { x, y };
    };

    for (const d of this._drawings) {
      const color = VECTOR_DRAW_COLORS[d.color];
      const selected = d.id === this._selectedId;
      const stroke = selected ? "#ffffff" : color;
      const width = selected ? 2 : 1.25;

      switch (d.kind) {
        case "trend": {
          const a = toXY(d.t1, d.p1);
          const b = toXY(d.t2, d.p2);
          if (a && b) frame.lines.push({ x1: a.x, y1: a.y, x2: b.x, y2: b.y, color: stroke, width });
          break;
        }
        case "ray": {
          const end = rayEndPoint({ t: d.t1, p: d.p1 }, { t: d.t2, p: d.p2 }, rightTime + 86400);
          const a = toXY(d.t1, d.p1);
          const b = toXY(end.t, end.p);
          if (a && b) frame.lines.push({ x1: a.x, y1: a.y, x2: b.x, y2: b.y, color: stroke, width });
          break;
        }
        case "rect": {
          const a = toXY(d.t1, d.p1);
          const b = toXY(d.t2, d.p2);
          if (a && b) {
            frame.rects.push({
              x1: a.x,
              y1: a.y,
              x2: b.x,
              y2: b.y,
              fill: withAlpha(color, 0.12),
              stroke: withAlpha(stroke, 0.9),
            });
          }
          break;
        }
        case "text": {
          const pt = toXY(d.t, d.price);
          if (pt) frame.texts.push({ x: pt.x, y: pt.y, text: d.text, color: stroke });
          break;
        }
        case "fib": {
          const tLo = Math.min(d.t1, d.t2);
          const tHi = Math.max(d.t1, d.t2);
          const x1 = ts.timeToCoordinate(tLo as Time);
          const x2 = ts.timeToCoordinate(tHi as Time);
          if (x1 == null || x2 == null) break;
          for (const { ratio, price } of fibPrices(d.p1, d.p2)) {
            const y = series.priceToCoordinate(price);
            if (y == null) continue;
            frame.lines.push({
              x1,
              y1: y,
              x2,
              y2: y,
              color: withAlpha(color, ratio === 0.5 ? 0.95 : 0.65),
              width: ratio === 0.5 ? 1.5 : 1,
              dash: ratio === 0 || ratio === 1 ? undefined : [5, 4],
            });
            frame.texts.push({
              x: x2 + 2,
              y,
              text: `${(ratio * 100).toFixed(1)}%`,
              color: withAlpha(color, 0.85),
            });
          }
          break;
        }
        case "vline": {
          const x = ts.timeToCoordinate(d.t as Time);
          if (x != null) frame.vlines.push({ x, color: stroke, label: d.label });
          break;
        }
        default:
          break;
      }
    }

    if (this._draft && this._draftCursor) {
      const a = toXY(this._draft.t, this._draft.p);
      const b = toXY(this._draftCursor.t, this._draftCursor.p);
      if (a && b) {
        frame.draft = { x1: a.x, y1: a.y, x2: b.x, y2: b.y, color: this._draft.color };
      }
    }

    return frame;
  }
}
