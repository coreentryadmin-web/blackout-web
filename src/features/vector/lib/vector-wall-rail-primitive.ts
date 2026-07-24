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
  relStrengthT,
  growthModulation,
  magnitudeGlowBoost,
  beadRadiusForNotional,
  pctToNotionalProxy,
} from "./vector-wall-visual";
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
 *   • BEAD SIZE   = ABSOLUTE $ gamma magnitude (small/med/large/huge ≈ $200M/$600M/$1.2B/$2.5B) via the
 *                  perceptual $ ladder — a genuinely bigger wall reads bigger even as the frame's king
 *                  changes. Falls back to frame-relative half-height only when there's no magnitude.
 *   • BRIGHTNESS  = absolute magnitude + build/fade velocity (a genuinely massive wall glows; a wall
 *                  being STACKED this bucket flares, one bleeding out dims), per bead along the rail.
 *   • KING SHIFT  = the dominant strike per side gets a brighter rim / soft glow that EASES from the
 *                  old king row to the new one as the king migrates (see the animation layer below).
 *   • BIRTH FLASH = a bright vertical cap at the wall's first bucket — "this wall was born here".
 *   • DIM TAPER   = a departed (inactive) wall's tail fades out — "this wall is dying/gone".
 *
 * ANIMATION (grow / shrink / king-shift): live data lands discretely (each refresh replaces the
 * leading bucket's pct / appends a new one), which without easing makes the leading bead SNAP to its
 * new size and the king emphasis JUMP between rows. A lightweight rAF loop eases each bead's displayed
 * radius toward its live target and the king emphasis from the old dominant row toward the new, so the
 * rail visibly BREATHES — growing as gamma stacks, shrinking as it decays, the dominant node sliding
 * vertically as it migrates. The loop is target-driven and self-stopping (no idle spin), respects
 * `prefers-reduced-motion`, is SSR-safe, and is torn down in detached().
 *
 * It consumes the SAME `StrikeTrail[]` the marker path builds (per-side, lifecycle-filtered), maps
 * each point's (time, strike) through the real time/price scales, and stamps a magnitude-sized,
 * velocity-brightened BEAD per bucket. Empty / invisible → renderer returns null → nothing drawn.
 */

export type WallRailData = {
  callTrails: StrikeTrail[];
  putTrails: StrikeTrail[];
  /** Strongest pct across BOTH sides in view — the frame reference the RELATIVE fallback scales
   *  against (absolute $-ladder sizing does not use it). */
  maxPct: number;
  callColor: string;
  putColor: string;
};

type PaneRendererTarget = Parameters<IPrimitivePaneRenderer["draw"]>[0];
type AttachedSeries = ISeriesApi<SeriesType, Time>;

/** Bead half-height (radius) in px at zero vs full magnitude. A king wall → ~MAX px bead
 *  (unmistakably fat); a straggler → a ~MIN px hairline. MIN kept solid so even a weak wall is a
 *  readable dot, not a pinpoint. Shared by BOTH the absolute $-ladder and the relative fallback so
 *  the two sizing paths stay on one pixel scale. */
const HALF_PX_MIN = 2.4;
const HALF_PX_MAX = 9;
/** Fill opacity floor/ceiling. Raised HARD (0.26→0.6, 0.82→0.98) after a member report that the
 *  bands were "too light, barely visible" — especially over the bright GEX heatmap background. The
 *  rail must read as SOLID coloured beads, not a faint wash. */
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

// ── ANIMATION TUNING ─────────────────────────────────────────────────────────────────────────────
/** Per-frame lerp coefficient: cur += (target - cur) * EASE_K. ~0.22 settles a visible move in a few
 *  hundred ms at 60fps — fast enough to track live data, slow enough to READ as growth/shift. */
const EASE_K = 0.22;
/** Below this |Δpx| a bead is snapped to target (kills sub-pixel jitter that never visually settles). */
const HALF_EPS = 0.05;
/** Below this |Δ| a king-emphasis ease is snapped/dropped. */
const EMPH_EPS = 0.01;
/** When the largest remaining ease delta drops below this, the rAF loop stops (idle — no spin). */
const SETTLE_EPS = 0.02;
/** King emphasis → extra radius (×) and rim/glow lift, so the dominant node stands proud and its
 *  prominence slides vertically to a new strike as the king migrates. */
const KING_RADIUS_BOOST = 0.3;

type BandPt = { x: number; yTop: number; yBot: number; a: number };
/** One run of adjacent buckets for a wall (no time gap). Rendered as a ROW OF BEADS — one round dot
 *  per bucket, each sized by its yTop/yBot half-height (magnitude) and brightened by its own alpha
 *  (growth/fade). A dead-stretch gap splits the run so beads don't bridge time the wall was absent.
 *  `emph` is the eased king-emphasis [0,1] for this trail's strike (0 = not the dominant node). */
type Band = {
  pts: BandPt[];
  color: string;
  emph: number;
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
        // King emphasis (eased): the dominant node's row gets a slightly fatter bead + brighter rim
        // and a soft glow, and because `emph` EASES from the old king strike (→0) to the new one
        // (→1) the prominence visibly slides vertically as the king migrates rather than jumping.
        const emph = b.emph;
        const rMul = 1 + emph * KING_RADIUS_BOOST;
        // BEADS (member-preferred): one round bead per bucket rather than a single filled ribbon.
        // Each point still carries the full channel set the ribbon exposed — the beads just render it
        // as discrete dots (which read as a rail of "beads" the way members like) instead of a solid
        // band: BEAD RADIUS = absolute $-gamma magnitude (king wall = a fat bead, a straggler = a
        // small one, from the same yTop/yBot half-height), BEAD BRIGHTNESS = per-bucket alpha (a
        // growing wall brightens along its length, a fading one dims — the growth/fade channel), and
        // a thin crisp rim keeps every bead readable over the bright GEX heatmap. A dense run of
        // buckets reads as a near-continuous beaded rail; a sparse/fading run reads as scattered dots.
        for (const p of pts) {
          const cy = (p.yTop + p.yBot) / 2;
          const r = Math.max(1.6, ((p.yBot - p.yTop) / 2) * rMul); // half-height → bead radius
          ctx.fillStyle = withA(b.color, p.a);
          ctx.beginPath();
          ctx.arc(p.x, cy, r, 0, Math.PI * 2);
          ctx.fill();
          // King glow: a soft halo behind the dominant node's beads, fading in/out with the eased
          // emphasis so the "which wall dominates now" cue tracks the migration smoothly.
          if (emph > 0.05) {
            ctx.fillStyle = withA(b.color, Math.min(0.5, p.a * 0.4) * emph);
            ctx.beginPath();
            ctx.arc(p.x, cy, r + 2 + emph * 2, 0, Math.PI * 2);
            ctx.fill();
          }
          // Thin brighter rim so a bead reads as a defined dot over a busy background (the ribbon used
          // crisp top/bottom edges for the same reason). King beads get an extra-bright rim.
          if (r >= 2.2) {
            ctx.lineWidth = 1;
            ctx.strokeStyle = withA(b.color, Math.min(1, p.a + 0.04 + emph * 0.3));
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

/**
 * TARGET bead half-height (radius) in px for a point — ABSOLUTE-magnitude first, frame-relative
 * fallback. Scale-independent (pure function of the point's magnitude), so the rAF loop can ease it
 * without touching the chart's time/price scales.
 *
 * Absolute path: a resolvable $ notional — a REAL StrikeTrailPoint.notional if one is ever threaded,
 * else the documented proxy from pct (share × a nominal book) — sizes the bead on the perceptual $
 * ladder, so a genuinely bigger wall reads bigger regardless of what else is in frame. Fallback:
 * when there is no usable magnitude at all (pct ≤ 0 / non-finite), drop to the old frame-relative
 * half-height so off-hours / degraded data still renders a rail instead of collapsing to the floor.
 */
function targetHalfPx(pct: number, notional: number | undefined, maxPct: number): number {
  const usd = Number.isFinite(notional) && (notional as number) > 0 ? (notional as number) : pctToNotionalProxy(pct);
  if (usd > 0) return beadRadiusForNotional(usd, { floorPx: HALF_PX_MIN, ceilPx: HALF_PX_MAX });
  // No magnitude to read absolutely — keep the frame-relative behaviour rather than blanking.
  return HALF_PX_MIN + relStrengthT(pct, maxPct) * (HALF_PX_MAX - HALF_PX_MIN);
}

function fillAlpha(pct: number, maxPct: number): number {
  const t = relStrengthT(pct, maxPct);
  return FILL_ALPHA_MIN + t * (FILL_ALPHA_MAX - FILL_ALPHA_MIN);
}

/** Stable per-bead key for the easing maps: side + strike + bucket time. The leading bucket keeps a
 *  stable key across refreshes while its pct updates, so ITS bead eases (grows/shrinks) while settled
 *  historical beads (unchanged key + unchanged target) never move. */
function beadKey(side: "c" | "p", strike: number, time: number): string {
  return `${side}:${strike}:${time}`;
}
/** Per-strike king-emphasis key (side + strike). */
function kingKey(side: "c" | "p", strike: number): string {
  return `${side}:${strike}`;
}

export class WallRailPrimitive implements ISeriesPrimitive<Time> {
  private _chart: IChartApi | null = null;
  private _series: AttachedSeries | null = null;
  private _requestUpdate: (() => void) | null = null;
  private _data: WallRailData | null = null;
  private _visible = false;
  private readonly _paneViews: readonly IPrimitivePaneView[] = [new WallRailPaneView(this)];

  // ── Animation state ──
  /** Displayed (eased) bead half-heights, keyed by beadKey — lags target, lerped by the rAF loop. */
  private readonly _easedHalf = new Map<string, number>();
  /** Latest target half-heights (written by project on each repaint, read by the rAF loop). */
  private readonly _targetHalf = new Map<string, number>();
  /** Displayed (eased) king emphasis [0,1] per strike, keyed by kingKey. */
  private readonly _kingEmph = new Map<string, number>();
  /** Target king emphasis per rendered strike (1 = current king, 0 = everything else). */
  private readonly _kingTargetEmph = new Map<string, number>();
  private _rafId: number | null = null;
  private _reduceMotion = false;
  private _mql: MediaQueryList | null = null;
  private _mqlHandler: ((e: MediaQueryListEvent) => void) | null = null;

  attached(param: SeriesAttachedParameter<Time>): void {
    this._chart = param.chart;
    this._series = param.series;
    this._requestUpdate = param.requestUpdate;
    // SSR-safe: only wire motion preference in a browser. When reduce-motion is on we render final
    // values immediately and never start the rAF loop; toggling it off resumes easing live.
    if (typeof window !== "undefined" && typeof window.matchMedia === "function") {
      this._mql = window.matchMedia("(prefers-reduced-motion: reduce)");
      this._reduceMotion = this._mql.matches;
      this._mqlHandler = (e: MediaQueryListEvent) => {
        this._reduceMotion = e.matches;
        if (e.matches) {
          this._cancelRaf();
          this._requestUpdate?.(); // repaint at final (un-eased) values
        } else {
          this._ensureAnimating();
        }
      };
      this._mql.addEventListener?.("change", this._mqlHandler);
    }
  }

  detached(): void {
    // No leaks: cancel the loop, drop the matchMedia listener, null every handle, clear ease state.
    this._cancelRaf();
    if (this._mql && this._mqlHandler) this._mql.removeEventListener?.("change", this._mqlHandler);
    this._mql = null;
    this._mqlHandler = null;
    this._chart = null;
    this._series = null;
    this._requestUpdate = null;
    this._easedHalf.clear();
    this._targetHalf.clear();
    this._kingEmph.clear();
    this._kingTargetEmph.clear();
  }

  paneViews(): readonly IPrimitivePaneView[] {
    return this._paneViews;
  }

  setData(data: WallRailData | null, visible: boolean): void {
    this._data = data;
    this._visible = visible;
    // Repaint (project recomputes targets from the new data) and kick the ease loop so existing beads
    // glide from their current displayed size to the new target instead of snapping.
    this._requestUpdate?.();
    this._ensureAnimating();
  }

  private _cancelRaf(): void {
    if (this._rafId != null && typeof window !== "undefined") window.cancelAnimationFrame(this._rafId);
    this._rafId = null;
  }

  /** Start the rAF loop if motion is allowed and one isn't already scheduled. Reduce-motion / SSR
   *  paths just request a single repaint (final values, no easing). */
  private _ensureAnimating(): void {
    if (this._reduceMotion || typeof window === "undefined" || typeof window.requestAnimationFrame !== "function") {
      this._requestUpdate?.();
      return;
    }
    if (this._rafId == null) this._rafId = window.requestAnimationFrame(this._tick);
  }

  /** One ease step: lerp every displayed value toward the latest target, repaint, and reschedule only
   *  while something is still moving (self-stopping — never spins at idle). Arrow fn so `this` binds. */
  private _tick = (): void => {
    this._rafId = null;
    if (this._reduceMotion) {
      this._requestUpdate?.();
      return;
    }
    let maxDelta = 0;

    // Bead half-heights: ease displayed → target; snap tiny residuals.
    for (const [key, target] of this._targetHalf) {
      const cur = this._easedHalf.get(key) ?? target;
      const next = cur + (target - cur) * EASE_K;
      const d = Math.abs(target - next);
      this._easedHalf.set(key, d < HALF_EPS ? target : next);
      if (d > maxDelta) maxDelta = d;
    }
    // Prune eased beads whose strike/bucket left the frame so the maps can't grow unbounded.
    if (this._easedHalf.size > this._targetHalf.size) {
      for (const key of this._easedHalf.keys()) if (!this._targetHalf.has(key)) this._easedHalf.delete(key);
    }

    // King emphasis: the departing king's target is 0 (still a rendered trail) so it eases DOWN while
    // the new king eases UP — the emphasis slides between rows. Strikes that left the frame entirely
    // ease their emphasis to 0 and are dropped.
    for (const [key, target] of this._kingTargetEmph) {
      const cur = this._kingEmph.get(key) ?? 0;
      const next = cur + (target - cur) * EASE_K;
      const d = Math.abs(target - next);
      this._kingEmph.set(key, d < EMPH_EPS ? target : next);
      if (d > maxDelta) maxDelta = d;
    }
    for (const key of [...this._kingEmph.keys()]) {
      if (this._kingTargetEmph.has(key)) continue;
      const cur = this._kingEmph.get(key)!;
      const next = cur * (1 - EASE_K);
      if (next < EMPH_EPS) this._kingEmph.delete(key);
      else {
        this._kingEmph.set(key, next);
        if (cur > maxDelta) maxDelta = cur;
      }
    }

    this._requestUpdate?.();
    if (maxDelta > SETTLE_EPS && typeof window !== "undefined") {
      this._rafId = window.requestAnimationFrame(this._tick);
    }
  };

  /** Project every trail into media-space beaded bands. Also writes the per-bead TARGET half-heights
   *  and per-strike king-emphasis targets the rAF loop eases toward, and reads the eased values back
   *  so the drawn beads reflect the in-flight animation. Null when there's nothing honest to draw. */
  project(): Band[] | null {
    if (!this._visible || !this._data || !this._chart || !this._series) return null;
    const { callTrails, putTrails, maxPct, callColor, putColor } = this._data;
    if (!(maxPct > 0)) return null;
    const ts = this._chart.timeScale();
    const series = this._series;
    const bands: Band[] = [];

    // Rebuild target sets from scratch each project so departed beads/strikes drop out of the loop.
    this._targetHalf.clear();
    this._kingTargetEmph.clear();

    // Earliest bucket across every trail — a trail that STARTS here began before/at the drawn window
    // edge (session open / live-window trim), so its "birth" is unknowable and must NOT flash. Only a
    // first-bucket strictly after this boundary is a real formation. Mirrors buildWallBeadMarkers.
    let earliest = Infinity;
    for (const t of [...callTrails, ...putTrails]) {
      const t0 = t.points[0]?.time;
      if (t0 != null && t0 < earliest) earliest = t0;
    }

    // King strike per side = the strike whose LATEST bucket carries the highest share. This is the
    // dominant node whose emphasis eases toward it (and away from the previous king) as it migrates.
    const kingStrikeForSide = (trails: StrikeTrail[]): number | null => {
      let bestStrike: number | null = null;
      let best = -Infinity;
      for (const t of trails) {
        const last = t.points[t.points.length - 1];
        if (last && last.pct > best) {
          best = last.pct;
          bestStrike = t.strike;
        }
      }
      return bestStrike;
    };
    const callKing = kingStrikeForSide(callTrails);
    const putKing = kingStrikeForSide(putTrails);

    const addTrail = (trail: StrikeTrail, color: string, side: "c" | "p", kingStrike: number | null) => {
      const y = series.priceToCoordinate(trail.strike);
      if (y == null) return;
      const pts = trail.points;
      if (pts.length === 0) return;
      // King emphasis target for this strike: 1 if it's the current dominant node, else 0. The loop
      // eases the displayed value, so a king change slides emphasis from the old row to the new.
      const kKey = kingKey(side, trail.strike);
      this._kingTargetEmph.set(kKey, trail.strike === kingStrike ? 1 : 0);
      const emph = this._reduceMotion
        ? trail.strike === kingStrike
          ? 1
          : 0
        : this._kingEmph.get(kKey) ?? 0;

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
          emph,
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
        // TARGET half = ABSOLUTE $-ladder magnitude (or relative fallback), then the growth/fade
        // velocity multiplier so a wall being STACKED this bucket still flares fatter.
        const target = targetHalfPx(p.pct, p.notional, maxPct) * mod.sizeMul;
        const key = beadKey(side, trail.strike, p.time);
        this._targetHalf.set(key, target);
        // Displayed half lags the target (eased by the rAF loop). Reduce-motion / first sight → snap
        // to target so a bead never appears at the wrong size; only a CHANGING target then eases.
        let half: number;
        if (this._reduceMotion) {
          half = target;
        } else {
          const cur = this._easedHalf.get(key);
          if (cur == null) {
            this._easedHalf.set(key, target);
            half = target;
          } else {
            half = cur;
          }
        }
        const a = Math.min(1, fillAlpha(p.pct, maxPct) * mod.alphaMul * (0.75 + 0.25 * Math.min(1.6, glow)));
        run.push({ x, yTop: y - half, yBot: y + half, a });
      }
      flush(pts.length - 1);
    };

    for (const t of callTrails) addTrail(t, callColor, "c", callKing);
    for (const t of putTrails) addTrail(t, putColor, "p", putKing);
    if (bands.length === 0) return null;
    return bands;
  }
}
