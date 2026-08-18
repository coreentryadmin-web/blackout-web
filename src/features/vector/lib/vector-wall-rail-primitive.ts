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
  withA,
  targetHalfPx,
  fillAlpha,
  beadKey,
  kingKey,
  kingStrikeByTime,
  maxPctByTime,
  trailingRefs,
  beadRenderTuning,
  clampTuningToSpacing,
  closestRowGapPx,
  type WallBeadRenderProfile,
  type BeadRenderTuning,
} from "./vector-wall-rail-core";
import {
  relStrengthT,
  beadModulation,
  ageTaperAlpha,
  magnitudeGlowBoost,
  // haloRingForTier stays (integrity halos are still drawn here); beadRadiusForNotional and
  // pctToNotionalProxy are gone — bead radius now comes from targetHalfPx() off recorded $|gamma|,
  // so the pct×$8B proxy has no caller left on this path.
  haloRingForTier,
} from "./vector-wall-visual";
import type { WallIntegrityTier } from "./vector-wall-integrity";
import type { StrikeTrail } from "./vector-wall-history";
import type { VectorWallEvent } from "./vector-wall-events";
import {
  composeWallEventGlyphs,
  drawWallEventGlyph,
  hitTestProjectedWallEventGlyph,
  type WallEventGlyph,
} from "./vector-wall-event-glyphs";

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
  /** Compare grid uses smaller, more translucent beads behind candles. */
  profile?: WallBeadRenderProfile;
  /** Per-strike integrity tier → outer confidence ring (GEX lens). */
  callTierByStrike?: ReadonlyMap<number, WallIntegrityTier>;
  putTierByStrike?: ReadonlyMap<number, WallIntegrityTier>;
  /** When false, integrity rings are not drawn (core + king only). */
  showIntegrityRings?: boolean;
  /** When true, bead size uses recorded $|gamma| notional; when false, frame-relative sizing. */
  /** Sparse punctuation glyphs (birth, handover, flip cross, …) — drawn above beads. */
  showEventGlyphs?: boolean;
  wallEvents?: readonly VectorWallEvent[];
  eventLens?: "gex" | "vex";
  eventCursorTime?: number;
};

type PaneRendererTarget = Parameters<IPrimitivePaneRenderer["draw"]>[0];
type AttachedSeries = ISeriesApi<SeriesType, Time>;

/** Bead half-height (radius) in px at zero vs full magnitude. A king wall → ~MAX px bead
 *  (unmistakably fat); a straggler → a ~MIN px hairline. MIN kept solid so even a weak wall is a
 *  readable dot, not a pinpoint. Shared by BOTH the absolute $-ladder and the relative fallback so
 *  the two sizing paths stay on one pixel scale. */
/** Fill opacity floor/ceiling. Raised HARD (0.26→0.6, 0.82→0.98) after a member report that the
 *  bands were "too light, barely visible" — especially over the bright GEX heatmap background. The
 *  rail must read as SOLID coloured beads, not a faint wash. */
/** Full opacity — candles must stay readable under beads; per-bead alpha carries translucency. */
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
type BandPt = { x: number; yTop: number; yBot: number; a: number; emph: number; tier?: WallIntegrityTier };
/** One run of adjacent buckets for a wall (no time gap). Rendered as a ROW OF BEADS — one round dot
 *  per bucket, each sized by its yTop/yBot half-height (magnitude) and brightened by its own alpha
 *  (growth/fade). A dead-stretch gap splits the run so beads don't bridge time the wall was absent.
 *  King emphasis lives on each POINT, not on the band: a strike is king only in the buckets where it
 *  actually held the highest share, so the crown appears and disappears at the moment it changed
 *  hands (see kingStrikeByTime). */
type Band = {
  pts: BandPt[];
  color: string;
  birth: { x: number; y: number; half: number } | null;
  death: { x: number; y: number; half: number } | null;
};

type ProjectedGlyph = WallEventGlyph & { x: number; y: number; color: string };

class WallRailRenderer implements IPrimitivePaneRenderer {
  constructor(
    private readonly _bands: Band[],
    private readonly _glyphs: ProjectedGlyph[],
    private readonly _tuning: BeadRenderTuning,
    private readonly _overlayDim: number,
    private readonly _showIntegrityRings: boolean,
    private readonly _showEventGlyphs: boolean
  ) {}

  draw(target: PaneRendererTarget): void {
    target.useMediaCoordinateSpace((scope) => {
      const ctx = scope.context;
      const kingBoost = this._tuning.kingBoost;
      const minR = this._tuning.minRadiusPx;
      const haloMul = this._tuning.kingHaloMul;
      ctx.save();
      ctx.globalAlpha = RAIL_TRANSLUCENCY * this._overlayDim;
      for (const b of this._bands) {
        const pts = b.pts;
        for (const p of pts) {
          const emph = p.emph;
          const rMul = 1 + emph * kingBoost;
          const cy = (p.yTop + p.yBot) / 2;
          const r = Math.max(minR, ((p.yBot - p.yTop) / 2) * rMul);
          if (this._showIntegrityRings && p.tier) {
            const ring = haloRingForTier(p.tier);
            const ringR = Math.max(minR + 1, r * (1.45 * ring.sizeMul));
            ctx.fillStyle = withA(b.color, Math.min(0.32, p.a * 0.22 * ring.alphaMul));
            ctx.beginPath();
            ctx.arc(p.x, cy, ringR, 0, Math.PI * 2);
            ctx.fill();
          }
          const fillA =
            emph > 0.05
              ? Math.min(this._tuning.kingAlphaCap ?? 0.72, p.a * (1 - emph * 0.12))
              : p.a;
          ctx.fillStyle = withA(b.color, fillA);
          ctx.beginPath();
          ctx.arc(p.x, cy, r, 0, Math.PI * 2);
          ctx.fill();
          if (emph > 0.05 && haloMul > 0) {
            ctx.fillStyle = withA(b.color, Math.min(0.22, p.a * 0.16) * emph * haloMul);
            ctx.beginPath();
            ctx.arc(p.x, cy, r + (2 + emph * 2) * haloMul, 0, Math.PI * 2);
            ctx.fill();
          }
          if (r >= 2.2) {
            ctx.lineWidth = emph > 0.5 ? 1.25 : 1;
            ctx.strokeStyle = withA(
              b.color,
              Math.min(1, fillA + 0.04 + emph * 0.3 + (this._tuning.strokeAlphaBoost ?? 0))
            );
            ctx.stroke();
          } else if ((this._tuning.strokeAlphaBoost ?? 0) > 0 && r >= minR) {
            // Compare panes: tiny weak beads still get a crisp outline on #040407.
            ctx.lineWidth = 1;
            ctx.strokeStyle = withA(b.color, Math.min(1, p.a + (this._tuning.strokeAlphaBoost ?? 0)));
            ctx.stroke();
          }
        }
        // Birth/death: drawn by the unified event-glyph layer when enabled.
        if (!this._showEventGlyphs && b.birth) {
          ctx.strokeStyle = withA(b.color, EDGE_ALPHA);
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(b.birth.x, b.birth.y - b.birth.half - 3);
          ctx.lineTo(b.birth.x, b.birth.y + b.birth.half + 3);
          ctx.stroke();
        }
        if (!this._showEventGlyphs && b.death) {
          ctx.fillStyle = withA(b.color, 0.5);
          ctx.beginPath();
          ctx.arc(b.death.x, b.death.y, Math.max(1.5, b.death.half), 0, Math.PI * 2);
          ctx.fill();
        }
      }
      if (this._showEventGlyphs) {
        for (const g of this._glyphs) {
          drawWallEventGlyph(ctx, g.shape, g.x, g.y, g.color, g.severity === "warn" ? 0.95 : 0.82, g.severity);
        }
      }
      ctx.restore();
    });
  }
}

class WallRailPaneView implements IPrimitivePaneView {
  constructor(private readonly _source: WallRailPrimitive) {}
  zOrder(): PrimitivePaneViewZOrder {
    return this._source.beadZOrder();
  }
  renderer(): IPrimitivePaneRenderer | null {
    const projected = this._source.project();
    if (!projected) return null;
    const { bands, glyphs, tuning } = projected;
    if (bands.length === 0) return null;
    return new WallRailRenderer(
      bands,
      glyphs,
      tuning,
      this._source.overlayDim(),
      this._source.showIntegrityRings(),
      this._source.showEventGlyphs()
    );
  }
}

export class WallRailPrimitive implements ISeriesPrimitive<Time> {
  private _chart: IChartApi | null = null;
  private _series: AttachedSeries | null = null;
  private _requestUpdate: (() => void) | null = null;
  private _data: WallRailData | null = null;
  private _visible = false;
  /** Background dim when member zooms out — candles stay dominant. */
  private _overlayDim = 1;
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
  /** Last media-space glyph positions — used for hover hit-testing from the crosshair handler. */
  private _lastGlyphs: ProjectedGlyph[] = [];

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
    this._requestUpdate?.();
    this._ensureAnimating();
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

  beadZOrder(): PrimitivePaneViewZOrder {
    return this._data?.profile === "compare" ? "bottom" : "top";
  }

  showIntegrityRings(): boolean {
    return Boolean(this._data?.showIntegrityRings);
  }

  showEventGlyphs(): boolean {
    return Boolean(this._data?.showEventGlyphs);
  }

  /** Nearest event glyph within hit radius (media/chart coordinates), or null. */
  hitTestEventGlyph(x: number, y: number, radiusPx = 16): ProjectedGlyph | null {
    if (!this._data?.showEventGlyphs || this._lastGlyphs.length === 0) return null;
    const idx = hitTestProjectedWallEventGlyph(this._lastGlyphs, x, y, radiusPx);
    return idx >= 0 ? (this._lastGlyphs[idx] ?? null) : null;
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
  project(): { bands: Band[]; glyphs: ProjectedGlyph[]; tuning: BeadRenderTuning } | null {
    if (!this._visible || !this._data || !this._chart || !this._series) {
      this._lastGlyphs = [];
      return null;
    }
    const {
      callTrails,
      putTrails,
      maxPct,
      callColor,
      putColor,
      profile,
      callTierByStrike,
      putTierByStrike,
      showIntegrityRings = false,
      showEventGlyphs = false,
      wallEvents = [],
      eventLens = "gex",
      eventCursorTime,
    } = this._data;
    if (!(maxPct > 0)) return null;
    const baseTuning = beadRenderTuning(profile ?? "default");
    const ts = this._chart.timeScale();
    const series = this._series;
    const bands: Band[] = [];

    // Bead size is budgeted against the room ACTUALLY on screen — see clampTuningToSpacing. A fixed
    // px ceiling turned the rail into painted slabs at ordinary zoom (a 15px bead against ~5.4px of
    // room per 3m bar), which buried the candles AND flattened the size channel into a constant
    // thickness. Both axes constrain: bar spacing stops beads smearing along a row, the closest row
    // gap keeps rows visibly separate.
    const barSpacingPx = (() => {
      try {
        const v = ts.options().barSpacing;
        return typeof v === "number" && Number.isFinite(v) ? v : NaN;
      } catch {
        return NaN;
      }
    })();
    const rowYs: number[] = [];
    for (const t of [...callTrails, ...putTrails]) {
      const y = series.priceToCoordinate(t.strike);
      if (y != null) rowYs.push(y);
    }
    const tuning = clampTuningToSpacing(baseTuning, {
      barSpacingPx,
      rowGapPx: closestRowGapPx(rowYs),
    });

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

    // Kingship PER BUCKET, not one scalar per strike — the crown belongs to whichever strike held
    // the highest share at that moment, so a handover is visible where it happened.
    // One reference per bucket across BOTH sides — a call and a put of equal share at the same
    // moment must read equally bright, exactly as maxPct did frame-wide.
    const maxPctAtTime = maxPctByTime([...callTrails, ...putTrails]);
    const callKingAt = kingStrikeByTime(callTrails);
    const putKingAt = kingStrikeByTime(putTrails);

    // The newest bucket on screen. Only THIS bucket's emphasis eases (a smooth crossfade as the
    // crown changes hands live); every earlier bucket renders its frozen truth. Easing history too
    // would re-animate the past on every pan — a different kind of lie about what happened when.
    let liveTime = -Infinity;
    for (const t of [...callTrails, ...putTrails]) {
      const last = t.points[t.points.length - 1];
      if (last && last.time > liveTime) liveTime = last.time;
    }

    const addTrail = (
      trail: StrikeTrail,
      color: string,
      side: "c" | "p",
      kingAt: Map<number, number>,
      tierByStrike?: ReadonlyMap<number, WallIntegrityTier>
    ) => {
      const y = series.priceToCoordinate(trail.strike);
      if (y == null) return;
      const pts = trail.points;
      if (pts.length === 0) return;
      // Live-bucket easing target for this strike (history is exact, so only the live edge eases).
      const kKey = kingKey(side, trail.strike);
      const isLiveKing = kingAt.get(liveTime) === trail.strike;
      this._kingTargetEmph.set(kKey, isLiveKing ? 1 : 0);
      const liveEmph = this._reduceMotion ? (isLiveKing ? 1 : 0) : this._kingEmph.get(kKey) ?? 0;

      // Median bucket step → gap threshold. A jump beyond GAP_SPLIT_FACTOR× the median means the wall
      // genuinely dropped out of the dominant set (a dead stretch), so we break the band there rather
      // than bridging a solid ribbon across time it wasn't a wall.
      // Trailing reference per bucket — drives the SLOW-decay channel (see decayModulation). Computed
      // ONCE per trail, not per bead: it is O(n) and this runs on every repaint.
      const refs = trailingRefs(pts);

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
        // BOTH channels: the fast per-bucket flare AND the sustained drift off this wall's own recent
        // baseline. The per-bucket channel alone never fires on gradual decay (a 20%->2% bleed over an
        // hour moves ~0.025% of king per 5s bucket, ~80x under its threshold), which is why a dying
        // wall used to render as a row of unchanged beads.
        const mod = beadModulation(p.pct, prev ? prev.pct : null, refs[i] ?? null, maxPct);
        const glow = magnitudeGlowBoost(p.pct); // absolute-magnitude brightness (frame-independent)
        // TARGET half = ABSOLUTE $-ladder magnitude (or relative fallback), then the growth/fade
        // velocity multiplier so a wall being STACKED this bucket still flares fatter.
        // Sizing is ALWAYS the $ ladder: the recorded notional when there is one, else the pct
        // proxy (see targetHalfPx). There is no longer a mode switch — the "$ Size" chip was
        // removed because with the proxy restored both settings render the same ladder.
        const target = targetHalfPx(p.pct, p.notional, maxPct, tuning) * mod.sizeMul;
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
        const modeledScale = p.modeled === true ? (tuning.modeledAlphaScale ?? 0.26) : 1;
        // Recency, measured against the newest bucket ON THIS RAIL rather than wall-clock now: an
        // off-hours or replayed rail has no "now" to be old relative to, and using Date.now() there
        // would fade an entire frozen session toward the floor for no reason a member could read.
        const ageScale = ageTaperAlpha(liveTime - p.time);
        const a = Math.min(
          1,
          // POINT-IN-TIME contrast: measured against the strongest wall in THAT bucket, not the
          // session-wide king — see maxPctByTime. Size stays absolute, so the two channels answer
          // different questions (how big was this wall ever / how much did it dominate right then).
          fillAlpha(p.pct, maxPctAtTime.get(p.time) ?? maxPct, tuning) *
            mod.alphaMul *
            (0.75 + 0.25 * Math.min(1.6, glow)) *
            tuning.drawAlphaMul *
            modeledScale *
            ageScale
        );
        // Frozen truth for history; eased value only on the live edge.
        const wasKing = kingAt.get(p.time) === trail.strike;
        const pEmph = p.time === liveTime ? liveEmph : wasKing ? 1 : 0;
        const tier =
          showIntegrityRings && tierByStrike ? tierByStrike.get(trail.strike) : undefined;
        run.push({ x, yTop: y - half, yBot: y + half, a, emph: pEmph, tier });
      }
      flush(pts.length - 1);
    };

    for (const t of callTrails) addTrail(t, callColor, "c", callKingAt, callTierByStrike);
    for (const t of putTrails) addTrail(t, putColor, "p", putKingAt, putTierByStrike);
    if (bands.length === 0) {
      this._lastGlyphs = [];
      return null;
    }

    const earliestBucket = Number.isFinite(earliest) ? earliest : 0;
    const rawGlyphs = showEventGlyphs
      ? composeWallEventGlyphs({
          events: wallEvents,
          callTrails,
          putTrails,
          lens: eventLens,
          earliestBucket,
          cursorTime: eventCursorTime,
        })
      : [];

    const glyphs: ProjectedGlyph[] = [];
    for (const g of rawGlyphs) {
      const x = ts.timeToCoordinate(g.time as Time);
      const y = series.priceToCoordinate(g.strike);
      if (x == null || y == null) continue;
      const color =
        g.side === "call" ? callColor : g.side === "put" ? putColor : g.side === "flip" ? "#22d3ee" : "#fbbf24";
      glyphs.push({ ...g, x, y, color });
    }

    this._lastGlyphs = showEventGlyphs ? glyphs : [];
    return { bands, glyphs, tuning };
  }
}
