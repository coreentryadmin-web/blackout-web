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
 * WALL RAIL as a lightweight-charts SERIES PRIMITIVE — the dealer-wall "beads" drawn as CANVAS BEADS
 * (one round dot per bucket) that carry the richer per-bead channels the old fixed-size marker API
 * could not. Members preferred the beaded rail to the solid ribbon this briefly became; this restores
 * beads WITHOUT losing the channels — every bead is sized + brightened by real strength/velocity.
 *
 * WHY canvas beads (not the built-in marker API): `series.setMarkers` circle markers expose only a
 * quantized `size` coefficient + alpha, both in one hue. That channel can't render the real per-strike
 * gamma spread (live SPX 0DTE runs a ~680× range — a 20%-of-gamma king next to a 0.03% straggler) nor
 * the bucket-to-bucket growth/fade fully present in the recorded trail (2800+ buckets/session). Every
 * prior "all our beads look the same" fix just widened a marker number; the channel itself was maxed
 * out. Drawing the beads ourselves on the canvas gives each bead the free channels the marker API lacks:
 *   • BEAD SIZE   = frame-relative strength (king wall = a fat bead, a straggler = a small dot) — the
 *                  "which wall is strong right now" cue the fixed-size marker API couldn't give.
 *   • BRIGHTNESS  = absolute magnitude + build/fade velocity (a genuinely massive wall glows; a wall
 *                  being STACKED this bucket flares, one bleeding out dims), per bead along the rail.
 *   • BIRTH FLASH = a bright vertical cap at the wall's first bucket — "this wall was born here".
 *   • DIM TAPER   = a departed (inactive) wall's tail fades out — "this wall is dying/gone".
 *
 * It consumes the SAME `StrikeTrail[]` the marker path builds (per-side, lifecycle-filtered), maps
 * each point's (time, strike) through the real time/price scales, and stamps a strength-sized,
 * velocity-brightened BEAD per bucket. Reuses the tuned math in vector-wall-visual (relStrengthT /
 * growthModulation / magnitudeGlowBoost) so the beads stay perceptually consistent. Empty / invisible
 * → renderer returns null → nothing drawn (honest absence).
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
 *  never had. MIN raised so even a weak wall is a solid readable band, not a hairline. */
const HALF_PX_MIN = 2.4;
const HALF_PX_MAX = 9;
/** Fill opacity floor/ceiling. Raised HARD (0.26→0.6, 0.82→0.98) after a member report that the
 *  bands were "too light, barely visible" — especially over the bright GEX heatmap background. The
 *  rail must read as SOLID coloured bands, not a faint wash. */
const FILL_ALPHA_MIN = 0.6;
const FILL_ALPHA_MAX = 0.98;
/** Full opacity — the per-vertex alpha above already governs translucency; no global dimming (was
 *  0.9, which compounded with the low fill alpha to wash the rail out over the heatmap). */
const RAIL_TRANSLUCENCY = 1;
/** Birth flash. */
const EDGE_ALPHA = 1;
/** A trail is split into separate bands when a time gap exceeds this × its median bucket step — a
 *  real dead stretch (wall left the dominant set) breaks the band honestly instead of bridging it. */
const GAP_SPLIT_FACTOR = 2.5;

type BandPt = { x: number; yTop: number; yBot: number; a: number };
/** One run of adjacent buckets for a wall (no time gap). Rendered as a ROW OF BEADS — one round dot
 *  per bucket, each sized by its yTop/yBot half-height (strength) and brightened by its own alpha
 *  (growth/fade). A dead-stretch gap splits the run so beads don't bridge time the wall was absent. */
type Band = {
  pts: BandPt[];
  color: string;
  birth: { x: number; y: number; half: number } | null;
  death: { x: number; y: number; half: number } | null;
};

class WallRailRenderer implements IPrimitivePaneRenderer {
  constructor(private readonly _bands: Band[]) {}

  draw(target: PaneRendererTarget): void {
    target.useMediaCoordinateSpace((scope) => {
      const ctx = scope.context;
      ctx.save();
      ctx.globalAlpha = RAIL_TRANSLUCENCY;
      for (const b of this._bands) {
        const pts = b.pts;
        // BEADS (member-preferred): one round bead per bucket rather than a single filled ribbon.
        // Each point still carries the full channel set the ribbon exposed — the beads just render it
        // as discrete dots (which read as a rail of "beads" the way members like) instead of a solid
        // band: BEAD RADIUS = frame-relative strength (king wall = a fat bead, a straggler = a small
        // one, from the same yTop/yBot half-height the band used), BEAD BRIGHTNESS = per-bucket alpha
        // (a growing wall brightens along its length, a fading one dims — the growth/fade channel), and
        // a thin crisp rim keeps every bead readable over the bright GEX heatmap. A dense run of
        // buckets reads as a near-continuous beaded rail; a sparse/fading run reads as scattered dots.
        for (const p of pts) {
          const cy = (p.yTop + p.yBot) / 2;
          const r = Math.max(1.6, (p.yBot - p.yTop) / 2); // half-height → bead radius (strength)
          ctx.fillStyle = withA(b.color, p.a);
          ctx.beginPath();
          ctx.arc(p.x, cy, r, 0, Math.PI * 2);
          ctx.fill();
          // Thin brighter rim so a bead reads as a defined dot over a busy background (the ribbon used
          // crisp top/bottom edges for the same reason).
          if (r >= 2.2) {
            ctx.lineWidth = 1;
            ctx.strokeStyle = withA(b.color, Math.min(1, p.a + 0.04));
            ctx.stroke();
          }
        }
        // Birth: a bright vertical flash at the wall's first in-window bucket ("formed here").
        if (b.birth) {
          ctx.strokeStyle = withA(b.color, EDGE_ALPHA);
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(b.birth.x, b.birth.y - b.birth.half - 3);
          ctx.lineTo(b.birth.x, b.birth.y + b.birth.half + 3);
          ctx.stroke();
        }
        // Death: a faint dot at a departed wall's grave ("dissolved here").
        if (b.death) {
          ctx.fillStyle = withA(b.color, 0.5);
          ctx.beginPath();
          ctx.arc(b.death.x, b.death.y, Math.max(1.5, b.death.half), 0, Math.PI * 2);
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
    const bands = this._source.project();
    if (!bands || bands.length === 0) return null;
    return new WallRailRenderer(bands);
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

  /** Project every trail into CONTINUOUS media-space bands (one filled polygon per gap-free run), so
   *  the rail reads as solid ribbons. Null when there's nothing honest to draw. */
  project(): Band[] | null {
    if (!this._visible || !this._data || !this._chart || !this._series) return null;
    const { callTrails, putTrails, maxPct, callColor, putColor } = this._data;
    if (!(maxPct > 0)) return null;
    const ts = this._chart.timeScale();
    const series = this._series;
    const bands: Band[] = [];

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
      // Median bucket step → gap threshold. A jump beyond GAP_SPLIT_FACTOR× the median means the wall
      // genuinely dropped out of the dominant set (a dead stretch), so we break the band there rather
      // than bridging a solid ribbon across time it wasn't a wall.
      const steps: number[] = [];
      for (let i = 1; i < pts.length; i++) steps.push(pts[i]!.time - pts[i - 1]!.time);
      steps.sort((a, b) => a - b);
      const medStep = steps.length ? steps[Math.floor(steps.length / 2)]! : 0;
      const gapLimit = medStep > 0 ? medStep * GAP_SPLIT_FACTOR : Infinity;

      let run: BandPt[] = [];
      let runStartIdx = 0;
      const flush = (endIdx: number) => {
        if (run.length === 0) return;
        const startsInWindow = pts[runStartIdx]!.time > earliest && runStartIdx === 0;
        const first = run[0]!;
        const last = run[run.length - 1]!;
        const isDeath = !trail.active && endIdx === pts.length - 1;
        bands.push({
          pts: run,
          color,
          birth: startsInWindow ? { x: first.x, y, half: (first.yBot - first.yTop) / 2 } : null,
          death: isDeath ? { x: last.x, y, half: (last.yBot - last.yTop) / 2 } : null,
        });
        run = [];
      };

      for (let i = 0; i < pts.length; i++) {
        const p = pts[i]!;
        const prev = i > 0 ? pts[i - 1]! : null;
        const x = ts.timeToCoordinate(p.time as Time);
        if (x == null) continue; // off-screen bucket — skip (its neighbours still draw)
        // New run when there's a real time gap since the previous bucket.
        if (prev && p.time - prev.time > gapLimit && run.length) {
          flush(i - 1);
          runStartIdx = i;
        } else if (run.length === 0) {
          runStartIdx = i;
        }
        const mod = growthModulation(p.pct, prev ? prev.pct : null, maxPct);
        const glow = magnitudeGlowBoost(p.pct); // absolute-magnitude brightness (frame-independent)
        const half = halfPx(p.pct, maxPct) * mod.sizeMul;
        const a = Math.min(1, fillAlpha(p.pct, maxPct) * mod.alphaMul * (0.75 + 0.25 * Math.min(1.6, glow)));
        run.push({ x, yTop: y - half, yBot: y + half, a });
      }
      flush(pts.length - 1);
    };

    for (const t of callTrails) addTrail(t, callColor);
    for (const t of putTrails) addTrail(t, putColor);
    if (bands.length === 0) return null;
    return bands;
  }
}
