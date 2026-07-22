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
import { relStrengthT, growthModulation, magnitudeGlowBoost } from "./vector-wall-visual";
import type { StrikeTrail } from "./vector-wall-history";

/**
 * WALL RAIL as a lightweight-charts SERIES PRIMITIVE — the dealer-wall "beads" drawn as CONTINUOUS
 * RIBBONS instead of same-size circle markers.
 *
 * WHY this exists: circle markers expose only a quantized `size` coefficient + alpha, both in one
 * hue. That channel can't render the real per-strike gamma spread (live SPX 0DTE runs a ~680× range
 * — a 20%-of-gamma king next to a 0.03% straggler) nor the bucket-to-bucket growth/fade that's fully
 * present in the recorded trail (2800+ buckets/session). Every prior "all our beads look the same"
 * fix just widened a marker number; the channel itself was maxed out. A canvas ribbon has the free
 * channels the markers lack:
 *   • THICKNESS  = frame-relative strength (king wall is a fat band, a straggler a hairline) — the
 *                  "which wall is strong right now" cue markers couldn't give (circles aren't wide).
 *   • BRIGHTNESS = absolute magnitude + build/fade velocity (a genuinely massive wall glows; a wall
 *                  being STACKED this bucket flares, one bleeding out dims).
 *   • LEADING EDGE = a bright vertical cap where the wall is BUILDING (rising pct) — "forming now".
 *   • BIRTH FLASH  = a bright cap at the wall's first bucket — "this wall was born here".
 *   • DIM TAPER    = a departed (inactive) wall's tail fades out — "this wall is dying/gone".
 *
 * It consumes the SAME `StrikeTrail[]` the marker path builds (per-side, lifecycle-filtered), maps
 * each point's (time, strike) through the real time/price scales, and fills a band whose half-height
 * tracks strength. Reuses the tuned math in vector-wall-visual (relStrengthT / growthModulation /
 * magnitudeGlowBoost) so the ribbon and any residual markers stay perceptually consistent. Empty /
 * invisible → renderer returns null → nothing drawn (honest absence).
 */

export type WallRailData = {
  callTrails: StrikeTrail[];
  putTrails: StrikeTrail[];
  /** Strongest pct across BOTH sides in view — the frame reference every band scales against. */
  maxPct: number;
  callColor: string;
  putColor: string;
};

type PaneRendererTarget = Parameters<IPrimitivePaneRenderer["draw"]>[0];
type AttachedSeries = ISeriesApi<SeriesType, Time>;

/** Band half-height in px at zero vs full frame-relative strength. A king wall → ~2·MAX px tall
 *  band (unmistakably fat); a straggler → a ~MIN px hairline. This is the "width" channel markers
 *  never had. */
const HALF_PX_MIN = 1.4;
const HALF_PX_MAX = 8;
/** Floor so a weak-but-present wall reads as a THIN VISIBLE BAND (not an invisible hairline that
 *  leaves only stray dots) — the whole rail should be one family of bands, fat→thin by strength. */
const FILL_ALPHA_MIN = 0.26;
const FILL_ALPHA_MAX = 0.82;
/** The whole rail is translucent so overlapping bands + candles read through it. */
const RAIL_TRANSLUCENCY = 0.9;
/** A building wall's bright leading cap; a birth flash. */
const EDGE_ALPHA = 0.95;

type Seg = {
  x0: number;
  x1: number;
  y: number;
  h0: number;
  h1: number;
  a0: number;
  a1: number;
  building: boolean;
  birth: boolean;
  death: boolean;
  color: string;
};

class WallRailRenderer implements IPrimitivePaneRenderer {
  constructor(private readonly _segs: Seg[]) {}

  draw(target: PaneRendererTarget): void {
    target.useMediaCoordinateSpace((scope) => {
      const ctx = scope.context;
      ctx.save();
      ctx.globalAlpha = RAIL_TRANSLUCENCY;
      for (const s of this._segs) {
        // Filled trapezoid band: strength (half-height) tapers between the two buckets, so a wall
        // that grew reads as a widening band and one that bled out as a narrowing one.
        const grad = ctx.createLinearGradient(s.x0, 0, s.x1, 0);
        grad.addColorStop(0, withA(s.color, s.a0));
        grad.addColorStop(1, withA(s.color, s.a1));
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.moveTo(s.x0, s.y - s.h0);
        ctx.lineTo(s.x1, s.y - s.h1);
        ctx.lineTo(s.x1, s.y + s.h1);
        ctx.lineTo(s.x0, s.y + s.h0);
        ctx.closePath();
        ctx.fill();
        // Crisp top+bottom edge (brighter than the fill) so each band reads as a defined shape and
        // the fat-king / thin-straggler thickness contrast is unmistakable, not a soft smear.
        ctx.strokeStyle = withA(s.color, Math.min(1, s.a1 + 0.18));
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(s.x0, s.y - s.h0);
        ctx.lineTo(s.x1, s.y - s.h1);
        ctx.moveTo(s.x0, s.y + s.h0);
        ctx.lineTo(s.x1, s.y + s.h1);
        ctx.stroke();
        // Bright vertical flash ONLY at a wall's BIRTH (its first in-window bucket) — the "a new wall
        // formed here" cue. Building/fading is NOT capped per-bucket: it's already carried by the
        // band's brightness (a1) and thickness (h1), so a per-bucket cap just painted a picket-fence
        // of ticks over a steady wall. Birth is rare, so this stays a clean occasional marker.
        if (s.birth) {
          ctx.strokeStyle = withA(s.color, EDGE_ALPHA);
          ctx.lineWidth = 2;
          const cap = s.h1 + 3;
          ctx.beginPath();
          ctx.moveTo(s.x1, s.y - cap);
          ctx.lineTo(s.x1, s.y + cap);
          ctx.stroke();
        }
        // A departed wall's terminal segment fades to nothing with a faint dot at its grave.
        if (s.death) {
          ctx.fillStyle = withA(s.color, 0.28);
          ctx.beginPath();
          ctx.arc(s.x1, s.y, Math.max(1.2, s.h1), 0, Math.PI * 2);
          ctx.fill();
        }
      }
      ctx.restore();
    });
  }
}

class WallRailPaneView implements IPrimitivePaneView {
  constructor(private readonly _source: WallRailPrimitive) {}
  zOrder(): PrimitivePaneViewZOrder {
    return "top"; // over the candles, but translucent so the tape stays readable
  }
  renderer(): IPrimitivePaneRenderer | null {
    const segs = this._source.project();
    if (!segs || segs.length === 0) return null;
    return new WallRailRenderer(segs);
  }
}

/** Parse "#rrggbb" (or an already-rgba string) into an rgba() at alpha `a`. */
function withA(color: string, a: number): string {
  const alpha = Math.max(0, Math.min(1, a));
  if (color.startsWith("#") && (color.length === 7 || color.length === 4)) {
    let r: number, g: number, b: number;
    if (color.length === 7) {
      r = parseInt(color.slice(1, 3), 16);
      g = parseInt(color.slice(3, 5), 16);
      b = parseInt(color.slice(5, 7), 16);
    } else {
      r = parseInt(color[1]! + color[1]!, 16);
      g = parseInt(color[2]! + color[2]!, 16);
      b = parseInt(color[3]! + color[3]!, 16);
    }
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }
  // Fallback: assume a solid CSS color; wrap via a canvas-friendly rgba is not possible, so return
  // the color and let globalAlpha carry translucency.
  return color;
}

function halfPx(pct: number, maxPct: number): number {
  return HALF_PX_MIN + relStrengthT(pct, maxPct) * (HALF_PX_MAX - HALF_PX_MIN);
}
function fillAlpha(pct: number, maxPct: number): number {
  const t = relStrengthT(pct, maxPct);
  return FILL_ALPHA_MIN + t * (FILL_ALPHA_MAX - FILL_ALPHA_MIN);
}

export class WallRailPrimitive implements ISeriesPrimitive<Time> {
  private _chart: IChartApi | null = null;
  private _series: AttachedSeries | null = null;
  private _requestUpdate: (() => void) | null = null;
  private _data: WallRailData | null = null;
  private _visible = false;
  private readonly _paneViews: readonly IPrimitivePaneView[] = [new WallRailPaneView(this)];

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

  setData(data: WallRailData | null, visible: boolean): void {
    this._data = data;
    this._visible = visible;
    this._requestUpdate?.();
  }

  /** Project every trail's points into media-space ribbon segments. Null when nothing honest to draw. */
  project(): Seg[] | null {
    if (!this._visible || !this._data || !this._chart || !this._series) return null;
    const { callTrails, putTrails, maxPct, callColor, putColor } = this._data;
    if (!(maxPct > 0)) return null;
    const ts = this._chart.timeScale();
    const series = this._series;
    const segs: Seg[] = [];

    // Earliest bucket across every trail — a trail that STARTS here began before/at the drawn window
    // edge (session open / live-window trim), so its "birth" is unknowable and must NOT flash. Only a
    // first-bucket strictly after this boundary is a real formation. Mirrors buildWallBeadMarkers.
    let earliest = Infinity;
    for (const t of [...callTrails, ...putTrails]) {
      const t0 = t.points[0]?.time;
      if (t0 != null && t0 < earliest) earliest = t0;
    }

    const addTrail = (trail: StrikeTrail, color: string) => {
      const y = series.priceToCoordinate(trail.strike);
      if (y == null) return;
      const pts = trail.points;
      if (pts.length === 0) return;
      // A single-point trail (a wall seen exactly once) still deserves a mark: draw a tiny self-
      // segment so its birth is visible instead of silently dropped.
      const coordOf = (t: number): number | null => {
        const c = ts.timeToCoordinate(t as Time);
        return c == null ? null : c;
      };
      for (let i = 0; i < pts.length; i++) {
        const p = pts[i]!;
        const prev = i > 0 ? pts[i - 1]! : null;
        const x1 = coordOf(p.time);
        if (x1 == null) continue;
        // Left anchor: the previous bucket's x (a real ribbon) or a hair to the left for a lone/birth
        // point so it still paints a sliver.
        const x0raw = prev ? coordOf(prev.time) : null;
        const x0 = x0raw == null ? x1 - 3 : x0raw;
        const h1 = halfPx(p.pct, maxPct);
        const h0 = prev ? halfPx(prev.pct, maxPct) : Math.max(HALF_PX_MIN, h1 * 0.4);
        // Growth/decay velocity vs the previous bucket, reusing the tuned marker math so the ribbon
        // and any residual markers agree on what "building/fading" means.
        const mod = growthModulation(p.pct, prev ? prev.pct : null, maxPct);
        const glow = magnitudeGlowBoost(p.pct); // absolute-magnitude brightness (frame-independent)
        const baseA = fillAlpha(p.pct, maxPct);
        const a1 = Math.min(1, baseA * mod.alphaMul * (0.7 + 0.3 * Math.min(1.6, glow)));
        const a0 = prev
          ? Math.min(1, fillAlpha(prev.pct, maxPct) * (0.7 + 0.3 * Math.min(1.6, glow)))
          : a1 * 0.5;
        // Real birth only when the first bucket is strictly inside the drawn window (see `earliest`).
        const isBirth = i === 0 && p.time > earliest;
        const isDeath = !trail.active && i === pts.length - 1; // terminal bucket of a departed wall
        segs.push({
          x0,
          x1,
          y,
          h0,
          h1: h1 * mod.sizeMul,
          a0,
          a1,
          building: mod.building,
          birth: isBirth,
          death: isDeath,
          color,
        });
      }
    };

    for (const t of callTrails) addTrail(t, callColor);
    for (const t of putTrails) addTrail(t, putColor);
    if (segs.length === 0) return null;
    return segs;
  }
}
