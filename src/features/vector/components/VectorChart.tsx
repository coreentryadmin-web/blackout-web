"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { clsx } from "clsx";
import { useIosChartDoubleTapFullscreen } from "@/hooks/useIosChartDoubleTapFullscreen";
import {
  createChart,
  createSeriesMarkers,
  CandlestickSeries,
  HistogramSeries,
  LineSeries,
  ColorType,
  LineStyle,
  type AutoscaleInfo,
  type HistogramData,
  type IChartApi,
  type IPriceLine,
  type ISeriesApi,
  type ISeriesMarkersPluginApi,
  type SeriesMarker,
  type Time,
  type UTCTimestamp,
} from "lightweight-charts";
import {
  playLevelLines,
  type PlayLevelsInput,
  type PlayLineKind,
} from "@/features/vector/lib/vector-play-levels";
import { VectorCrosshairLegend, type VectorCrosshairState } from "@/features/vector/components/VectorCrosshairLegend";
import { VectorToolbar } from "@/features/vector/components/VectorToolbar";
import {
  createVectorEventSource,
  type VectorDarkPoolLevel,
  type VectorWallLevel,
  type VectorWalls,
} from "@/lib/api";
import {
  appendVectorWallEvents,
  detectSpotStructureEvents,
  diffVectorWallSample,
  eventsFromWallHistory,
  type VectorWallEvent,
} from "@/features/vector/lib/vector-wall-events";
import { VECTOR_CHART_LOCALE } from "@/features/vector/lib/vector-chart-config";
import { reassertPriceAutoScale } from "@/features/vector/lib/vector-price-autoscale";
import {
  normalizeDteHorizon,
  pickHorizonScopedValue,
  VECTOR_DEFAULT_DTE_HORIZON,
  type VectorDteHorizon,
} from "@/features/vector/lib/vector-dte-horizon";
import { deriveVectorRegime, type VectorRegime } from "@/features/vector/lib/vector-regime";
import { deriveWallProximity, type WallProximity } from "@/features/vector/lib/vector-wall-proximity";
import { deriveGammaMagnet, type GammaMagnet } from "@/features/vector/lib/vector-gamma-magnet";
import {
  extendRangeForWalls,
  DEFAULT_WALL_VIEW_MAX_PCT,
  BEAD_VIEW_MAX_PCT,
  COMPARE_BEAD_VIEW_MAX_PCT,
} from "@/features/vector/lib/vector-price-range";
import {
  scoreTopWalls,
  integrityByStrike,
  type WallIntegrity,
} from "@/features/vector/lib/vector-wall-integrity";
import {
  alphaForPct,
  alphaForPctRel,
  glowAlphaForPctRel,
  growthModulation,
  haloRingForTier,
  magnitudeGlowBoost,
  markerSizeForPctRel,
  widthForPct,
  MODELED_ALPHA_SCALE,
} from "@/features/vector/lib/vector-wall-visual";
import {
  bucketWallHistoryForInterval,
  composeHorizonTrail,
  hasVexInHistory,
  liveTrailAnchorSec,
  mergeWallHistory,
  narrowedHorizonTrail,
  pickActiveStrikes,
  pickReplayTrailSource,
  recordWallSample,
  strikeTrailLifecycle,
  trimHistoryForLiveTrails,
  type StrikeTrail,
  type VectorWallLens,
  type WallHistorySample,
} from "@/features/vector/lib/vector-wall-history";
import { bucketWallSampleTime, buildWallHistorySample } from "@/features/vector/lib/vector-wall-sample";
import { pickKingStrikes, kingAnchorTitle } from "@/features/vector/lib/vector-king-anchor";
import { smaSeries, emaSeries, vwapSeries, rsiSeries, macdSeries } from "@/features/vector/lib/vector-indicators";
import {
  VECTOR_OVERLAYS,
  VECTOR_LEVELS,
  defaultVectorIndicators,
  DEFAULT_OPENING_RANGE_MINUTES,
  type VectorOverlayId,
  type VectorIndicatorId,
  type VectorOpeningRangeMinutes,
} from "@/features/vector/lib/vector-indicators-config";
import { GexHeatmapPrimitive } from "@/features/vector/lib/vector-gex-heatmap-primitive";
import { PinConePrimitive, type PinConeStep } from "@/features/vector/lib/vector-pin-cone-primitive";
import { EmConePrimitive } from "@/features/vector/lib/vector-em-cone-primitive";
import { emConeFromExpectedMove } from "@/features/vector/lib/vector-em-cone";
import { etMinutesOfDay } from "@/lib/swing/scan-cadence";
import { GammaRegimePrimitive } from "@/features/vector/lib/vector-gamma-regime-primitive";
import { computeVolumeProfile } from "@/features/vector/lib/vector-volume-profile";
import { VolumeProfilePrimitive } from "@/features/vector/lib/vector-volume-profile-primitive";
import type { WallBeadRenderProfile } from "@/features/vector/lib/vector-wall-rail-core";
import { WallRailPrimitive } from "@/features/vector/lib/vector-wall-rail-primitive";
import { gexCellAtGridPoint, heatmapBucketSecForChartTimeframe } from "@/features/vector/lib/vector-gex-heatmap-paint";
import type { GexHeatmapGrid } from "@/features/vector/lib/vector-gex-reconstruct";
import { levelLinesFor, type LevelLine, type PriorDayOhlc } from "@/features/vector/lib/vector-key-levels";
import { buildStructureMarkers } from "@/features/vector/lib/vector-structure-markers";
import { buildFlowMarkers, DEFAULT_FLOW_MAX_MARKERS, type FlowPrint } from "@/features/vector/lib/vector-flow-markers";
import { confluenceZones, confluenceCallouts, topConfluenceBand, type ConfluenceLevel } from "@/features/vector/lib/vector-confluence";
import { summarizeTechnicals, technicalsCalloutLines, type TechnicalsLine } from "@/features/vector/lib/vector-technicals";
import { playTechnicalsFromSummary } from "@/features/vector/lib/vector-server-technicals-core";
import { buildVectorPlay, type VectorPlay, type PlayTechnicals } from "@/features/vector/lib/vector-play-engine";
import { expectedMoveCallouts, type ExpectedMove } from "@/features/vector/lib/vector-expected-move";
import { evaluateAlerts, type AlertRule, type AlertState, type FiredAlert } from "@/features/vector/lib/vector-alerts";
import { sessionHodLod } from "@/features/vector/lib/vector-key-levels";
import { dominantSwing, goldenPocket } from "@/features/vector/lib/vector-fib-swing";
import {
  buildReplayTimeline,
  clampTimelineIndex,
  flipAtCrosshairTime,
  flipAtReplayTime,
  flipForActiveLens,
  formatReplayClock,
  sliceBarsToTime,
  sliceHistoryToTime,
  timelineIndexAtOrAfterEtClock,
  timelineIndexAtOrBeforeEtClock,
  wallsAtCrosshairTime,
  wallsAtReplayTime,
  wallsForActiveLens,
} from "@/features/vector/lib/vector-replay";
import type { VectorCompareChartSyncBind } from "@/features/vector/lib/vector-compare-sync";
import { barCloseAtOrBeforeTime, visibleRangeToEpochSec } from "@/features/vector/lib/vector-compare-sync";
import {
  aggregateVectorBars,
  mergeBarsByTime,
  wallCountForTimeframe,
  wallCountForHorizon,
  anchorBandPctForTimeframe,
  VECTOR_DEFAULT_TIMEFRAME,
  VECTOR_WALL_NODES_PER_SIDE,
  type VectorTimeframeMinutes,
} from "@/features/vector/lib/vector-bar-timeframes";
import { mergeSpyVolumeRows } from "@/features/vector/lib/vector-spy-volume-merge";
import {
  createRenderThrottle,
  priceScaleMapChanged,
  type PriceScaleSnapshot,
  type VectorPriceScaleMap,
} from "@/features/vector/lib/vector-price-scale-map";
import {
  VECTOR_GEX_HEATMAP_FAST_MOVE_PCT,
  VECTOR_GEX_HEATMAP_POLL_MS,
  VECTOR_WALL_TRAIL_SEC,
} from "@/features/vector/lib/vector-cadence";
import { vectorWallTrailSecClient } from "@/features/vector/lib/vector-wall-sample";
import { vectorHeatmapScopeLabel } from "@/lib/gex-scope-labels";
import {
  applySessionOverviewViewport,
  wantsSessionOverviewViewport,
} from "@/features/vector/lib/vector-chart-viewport";

export type VectorBar = {
  time: UTCTimestamp;
  open: number;
  high: number;
  low: number;
  close: number;
  /** SPY 1m share volume proxy aligned to this SPX bar. */
  volume?: number;
};

// Put beads are brightened from #b26bff so purple reads as strongly as the gold call beads at the
// SAME opacity. Yellow (#ffd60a, ~0.72 rel-luminance) punches through a dark chart at low alpha;
// the old purple (~0.30) washed out — so at the dimmed modeled-underlay alpha (0.15) members saw
// "only yellow beads." #d97bff (~0.52) closes that perceptual gap so both colors ghost/solidify
// together at every alpha, off-hours and in live RTH alike.
const PUT_WALL_COLOR = "#d97bff";
const CALL_WALL_COLOR = "#ffd60a";
const VEX_POS_COLOR = "#7dd3fc";
const VEX_NEG_COLOR = "#fb7185";
const GAMMA_FLIP_COLOR = "#22d3ee";
const VANNA_FLIP_COLOR = "#38bdf8";
const DARK_POOL_COLOR = "#ff8a3d"; // orange, not cyan — dark-pool cyan #00d4ff failed CVD separation vs gamma-flip cyan #22d3ee (worst-pair ΔE 6.9); orange lifts it to 36.7 (validated via dataviz palette checker)
const REPLAY_STEP_MS = 350;
/** Live RTH refresh for reconstructed GEX heatmap — aligned with server cache TTL. */
const GEX_HEATMAP_REFRESH_MS = VECTOR_GEX_HEATMAP_POLL_MS;
/** Widen the price axis to reveal walls within this % of spot (env-tunable). Without
 *  this the axis fits candles only and support walls a few % below spot render off-screen. */
const WALL_VIEW_MAX_PCT = (() => {
  const raw = Number(process.env.NEXT_PUBLIC_VECTOR_WALL_VIEW_MAX_PCT);
  return Number.isFinite(raw) && raw > 0 && raw <= 0.2 ? raw : DEFAULT_WALL_VIEW_MAX_PCT;
})();
const MAX_DP_GUIDES = 6;
/** Empty walls used to CLEAR the wall guide price-lines each refresh — walls now render only as
 *  strength-scaled beads (Skylit-clean axis), so the full-width "Call/Put wall — %" guide lines
 *  are gone; the axis carries just the current price + the gamma-flip line. */
const EMPTY_WALLS: VectorWalls = { callWalls: [], putWalls: [] };
/** Trailing whitespace (in bars) between the last candle and the price axis — so the bead bands
 *  stop short of the axis with breathing room instead of running flush into it (Skylit-style). */
const VECTOR_RIGHT_OFFSET_BARS = 6;
/** Re-poll cadence for the SPY volume backfill — Polygon only publishes one new closed
 *  minute bar per minute, so anything faster than that would just refetch the same data. */
const SPY_VOLUME_BACKFILL_MS = 60_000;
/** If the viewport is within this many bars of the live edge, new bars may follow (TradingView-style). */
const LIVE_FOLLOW_THRESHOLD_BARS = 2;
/** Opacity multiplier for a strike row that has LEFT the current wall set (its last bead predates
 *  this side's latest bucket). A closed/faded wall dims to this fraction so a member reads it as
 *  receding history, not a live rail — the birth→fade lifecycle Skylit shows (BUG 3). */
// Inactive walls dim to this opacity. At 0.4 (40%), they're still faintly visible; consider 0.15 for
// more aggressive fade (similar to modeled beads) if member feedback suggests stale walls read as "live".
const STALE_TRAIL_FADE = 0.15;
/** Extra opacity added to a wall's BIRTH bead (its first observed candle) so the moment/price a
 *  new wall forms visibly pops out of its trail rather than looking identical to every other bead. */
const BIRTH_BEAD_ALPHA_BOOST = 0.35;
/** Opacity factor for a dead wall's DISSIPATION halo — a wide, dim ring on the last bucket a
 *  departed wall was seen, so it reads as "dissolved here" rather than simply stopping. Kept low
 *  (a faint wash) because the whole dead trail is already dimmed by STALE_TRAIL_FADE. */
const DEATH_BEAD_ALPHA = 0.5;

function chartIsFollowingLive(chart: IChartApi): boolean {
  const pos = chart.timeScale().scrollPosition();
  return Number.isFinite(pos) && pos <= LIVE_FOLLOW_THRESHOLD_BARS;
}

/** Avoid yanking pan/zoom when the member scrolled back to study structure. */
function maybeScrollToLive(chart: IChartApi | null, liveFollowEnabled: boolean): void {
  if (!chart || !liveFollowEnabled) return;
  if (!chartIsFollowingLive(chart)) return;
  chart.timeScale().scrollToRealTime();
}


/** True once the member pans/drags or scroll-zooms — blocks programmatic refits until live-follow. */
function memberViewportLocked(chartUserPanned: boolean, wheelZoomAtMs: number): boolean {
  return chartUserPanned || Date.now() - wheelZoomAtMs < 8_000;
}

type Props = {
  ticker: string;
  initialBars: VectorBar[];
  initialWalls: VectorWalls | null;
  initialVexWalls: VectorWalls | null;
  initialWallHistory: WallHistorySample[];
  /** SSR preloaded per-horizon rail (see loadVectorSeedProps seedDteHorizon). */
  initialHorizonWallHistory?: WallHistorySample[];
  initialGammaFlip: number | null;
  initialVexFlip: number | null;
  initialDarkPoolLevels: VectorDarkPoolLevel[];
  sessionYmd: string;
  liveSession: boolean;
  /** Server-resolved bead bucket size (5s shared universe, 15s on-demand). */
  initialWallTrailSec?: number;
  onFreshness?: (updatedAt: number) => void;
  /** Live spot price from each candle tick — fed to GEX ladder for real-time updates. */
  onSpotChange?: (spot: number) => void;
  onWallEventsChange?: (events: VectorWallEvent[]) => void;
  onLensChange?: (lens: VectorWallLens) => void;
  onRegimeChange?: (regime: VectorRegime) => void;
  onProximityChange?: (proximity: WallProximity | null) => void;
  onMagnetChange?: (magnet: GammaMagnet | null) => void;
  /** Ranked confluence callouts (pre-formatted strings) for the desk terminal; null = no zones. */
  onConfluenceChange?: (callouts: string[] | null) => void;
  onWallIntegrityChange?: (integrity: { call: WallIntegrity | null; put: WallIntegrity | null }) => void;
  /** Emits the current DTE horizon whenever the member toggles it, so sibling panels (the GEX
   *  ladder) can re-scope to the SAME expiries the chart's walls use. */
  onDteHorizonChange?: (horizon: VectorDteHorizon) => void;
  /** Pre-formatted always-on technicals lines (VWAP/EMA/RSI/MACD/pocket/structure) for the desk
   *  terminal — computed from the shown bars REGARDLESS of which overlays are toggled. Empty = warming
   *  up. Each line carries its own bull/bear/warn/muted `tone` (derived from the same typed
   *  TechnicalsSummary fields, not re-parsed from the text) so callers can color-code the card. */
  onTechnicalsChange?: (lines: TechnicalsLine[]) => void;
  /** Options-implied EXPECTED MOVE callout lines (±1σ/2σ range), horizon-scoped. Empty when the
   *  chain has no real ATM IV to price it. Narrated by the terminal (#15 cone, slice 3a). */
  onExpectedMoveChange?: (lines: string[]) => void;
  /** The fused, single concrete trade idea (`buildVectorPlay`) — assembled from the SAME signals
   *  already emitted above (regime/magnet/proximity/confluence/wall-integrity/technicals/expected
   *  move/max-pain), re-derived on every selection change and live tick. Null when there isn't
   *  enough structure yet (no spot) — never fabricated. */
  onPlayChange?: (play: VectorPlay | null) => void;
  /** Member-defined alert rules for THIS ticker (wall-touch / flip-cross). Evaluated on each live tick. */
  alertRules?: AlertRule[];
  /** Fired alerts from the latest tick (already deduped/cooled-down by the engine) — for toast + terminal. */
  onAlertsFired?: (fired: FiredAlert[]) => void;
  /** Compact page title + ticker cluster, rendered at the far left of the chart toolbar row. */
  leadSlot?: React.ReactNode;
  /** Rendered in the toolbar right cluster immediately before the Replay controls (host desks). */
  replayLeadSlot?: React.ReactNode;
  /** Freshness/status chip, rendered at the far right of the toolbar row. */
  trailSlot?: React.ReactNode;
  /** Regime banner (or similar), rendered as a thin strip between the toolbar and the canvas so it
   *  still leads the chart without a tall separate header block above the whole page. */
  regimeSlot?: React.ReactNode;
  /** Initial DTE horizon override (host-desk seam, 2026-07-13): the SPX Slayer dashboard embed
   *  opens on 0DTE (SPX day-trading desk) while the standalone /vector page keeps WEEKLY. Initial
   *  state only — the member's toggle still rules after mount. */
  defaultDteHorizon?: VectorDteHorizon;
  /** Initial candle interval override (same seam): host desks may pass 3m explicitly;
   *  standalone /vector uses `VECTOR_DEFAULT_TIMEFRAME` (3-minute). Initial state only. */
  defaultTimeframe?: VectorTimeframeMinutes;
  /** Opening time viewport: "session" fits the full RTH tape on load (SPX desk 0DTE beads);
   *  "live" follows the right edge once the member pans there. */
  defaultChartViewport?: "session" | "live";
  /**
   * SHARED PRICE AXIS seam (SPX desk, 2026-07-13): reports the price pane's live y-mapping
   * (series.priceToCoordinate + visible price range + pane height + viewport top) so a host
   * desk can render sibling panels — the SPX strike ladder — on the SAME y-scale as the
   * candles. Emitted only when the scale actually changes, throttled to ~250ms (a 250ms poll
   * + change-compare, because lightweight-charts has no public "autoscale changed" event;
   * pan/zoom additionally triggers via subscribeVisibleLogicalRangeChange for responsiveness).
   * Strictly optional: when undefined (the standalone /vector page) no poller is created and
   * behavior is byte-identical.
   */
  onPriceScaleRender?: (map: VectorPriceScaleMap) => void;
  /**
   * PULSE → CHART ANCHOR seam (2026-07-26): a transient focus request from a host desk's Pulse rail
   * (SPX Slayer). When present with a finite `price`, the chart flashes a bright labeled price-line
   * at that level for ~3s then fades it — a "here's the event on the chart" cue, NOT a persistent
   * overlay. `seq` is a monotonic counter bumped on every click so re-clicking the SAME level still
   * re-triggers the flash (the effect keys on seq, not on the price value). `tone` colors the line.
   * Strictly optional: when undefined (the standalone /vector page) no effect runs and behavior is
   * byte-identical.
   */
  focusLevel?: { price: number; label: string; tone: string; seq: number } | null;
  /**
   * PLAYS ON THE CHART seam (2026-07-26): the member's ACTIVE SPX play mapped to entry/stop/target/
   * invalidation price-lines. When present, the chart reconciles a DEDICATED set of labeled price-
   * lines against `playLevelLines(playLevels)` — an OPEN position draws bold solid lines (live risk
   * being managed), a pending IDEA draws faint dotted lines (where it WOULD trigger). Strictly
   * optional: when undefined or `state:"none"` (the standalone /vector page, or no active play) no
   * line is drawn and behavior is byte-identical.
   */
  playLevels?: PlayLevelsInput;
  /** Host-desk embed (SPX Slayer): fill flex column — no standalone-page viewport height. */
  fillHost?: boolean;
  /** Opening wall lens (GEX/VEX) — compare mode syncs this across panes via remount. */
  defaultLens?: VectorWallLens;
  /** Compare grid: TF/DTE/lens live in the command bar instead of each toolbar. */
  toolbarHideLinkedControls?: boolean;
  /** Compare grid: drop the volume sub-pane so price + beads get full height. */
  hideVolumePane?: boolean;
  /** Compare grid: smaller translucent beads behind candles (4-up readability). */
  compareCompactBeads?: boolean;
  /** Compare linked time sync — crosshair + optional zoom from the desk bus. */
  compareSync?: VectorCompareChartSyncBind | null;
  onCompareCrosshair?: (paneId: string, timeSec: number | null) => void;
  onCompareVisibleRange?: (paneId: string, fromSec: number, toSec: number) => void;
};

function lensVisuals(lens: VectorWallLens) {
  return lens === "vex"
    ? {
        callColor: VEX_POS_COLOR,
        putColor: VEX_NEG_COLOR,
        flipColor: VANNA_FLIP_COLOR,
        callLabel: "Vanna +",
        putLabel: "Vanna −",
        flipLabel: "Vanna flip",
      }
    : {
        callColor: CALL_WALL_COLOR,
        putColor: PUT_WALL_COLOR,
        flipColor: GAMMA_FLIP_COLOR,
        callLabel: "Call wall",
        putLabel: "Put wall",
        flipLabel: "Gamma flip",
      };
}

function withAlpha(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function pinCandlesOnTop(candleSeries: ISeriesApi<"Candlestick">): void {
  const count = candleSeries.getPane().getSeries().length;
  if (count > 0) candleSeries.setSeriesOrder(count - 1);
}


const VOLUME_UP = "rgba(0, 230, 118, 0.72)";
const VOLUME_DOWN = "rgba(255, 45, 85, 0.72)";

function volumeHistogramData(bars: VectorBar[]): HistogramData<Time>[] {
  const out: HistogramData<Time>[] = [];
  for (const bar of bars) {
    const value = bar.volume;
    if (value == null || value <= 0) continue;
    out.push({
      time: bar.time as Time,
      value,
      color: bar.close >= bar.open ? VOLUME_UP : VOLUME_DOWN,
    });
  }
  return out;
}

function applyDisplayBars(
  candleSeries: ISeriesApi<"Candlestick">,
  volumeSeries: ISeriesApi<"Histogram"> | null,
  bars: VectorBar[]
): void {
  candleSeries.setData(bars);
  volumeSeries?.setData(volumeHistogramData(bars));
}

/**
 * Re-seed the candle+volume data for a BACKGROUND refresh (the 60s SPY-volume backfill, any
 * non-user-initiated re-seed) WITHOUT disturbing the member's zoom/pan. Members reported the
 * zoom "flashes and resets to the default/loading view" — that happens when a background path
 * refits the whole range (fitContent) or lets setData nudge the visible logical range.
 *
 * We snapshot the exact visible logical range before swapping the data and restore it after —
 * UNLESS the chart is currently following the live edge, in which case we defer to the same
 * maybeScrollToLive() follow behavior the live-tick path uses (pinning a stale range there
 * would fight the live follow). First load and explicit timeframe switches deliberately keep
 * their fitContent() refit and must NOT route through here.
 */
function applyDisplayBarsPreservingView(
  chart: IChartApi | null,
  candleSeries: ISeriesApi<"Candlestick">,
  volumeSeries: ISeriesApi<"Histogram"> | null,
  bars: VectorBar[],
  liveFollowEnabled: boolean
): void {
  const timeScale = chart?.timeScale() ?? null;
  const following = chart ? chartIsFollowingLive(chart) : false;
  const prevRange =
    timeScale && !(following && liveFollowEnabled) ? timeScale.getVisibleLogicalRange() : null;
  applyDisplayBars(candleSeries, volumeSeries, bars);
  if (following && liveFollowEnabled) {
    maybeScrollToLive(chart, true);
  } else if (prevRange && timeScale) {
    timeScale.setVisibleLogicalRange(prevRange);
  }
}

function applyPriceGuides(
  series: ISeriesApi<"Candlestick">,
  guideRefs: React.MutableRefObject<(IPriceLine | null)[]>,
  levels: Array<{ strike: number; pct: number; label: string }>,
  baseColor: string,
  maxGuides: number,
  axisOnly = false
): void {
  for (let i = 0; i < maxGuides; i++) {
    const level = levels[i];
    const lineRef = guideRefs.current[i];
    if (!level) {
      if (lineRef) {
        series.removePriceLine(lineRef);
        guideRefs.current[i] = null;
      }
      continue;
    }
    const title = `${level.label} ${Math.round(level.strike)} — ${level.pct.toFixed(0)}%`;
    const color = withAlpha(baseColor, axisOnly ? 0.9 : alphaForPct(level.pct) * 0.35);
    const lineWidth = axisOnly ? 1 : widthForPct(level.pct);
    if (guideRefs.current[i]) {
      guideRefs.current[i]!.applyOptions({
        price: level.strike,
        title,
        color,
        lineWidth,
        lineStyle: LineStyle.Dashed,
        lineVisible: !axisOnly,
        axisLabelVisible: true,
      });
    } else {
      guideRefs.current[i] = series.createPriceLine({
        price: level.strike,
        color,
        lineWidth,
        lineStyle: LineStyle.Dashed,
        lineVisible: !axisOnly,
        axisLabelVisible: true,
        title,
      });
    }
  }
}

function applyWallGuides(
  series: ISeriesApi<"Candlestick">,
  guideRefs: React.MutableRefObject<(IPriceLine | null)[]>,
  levels: VectorWallLevel[],
  baseColor: string,
  label: string,
  maxGuides: number
): void {
  // Grow the guide-ref array to the server cap so a higher timeframe has slots to draw into —
  // same grow-then-fill pattern as applyDarkPoolGuides (the wall count is now variable per
  // timeframe, not a fixed 6). We size to VECTOR_WALL_NODES_PER_SIDE (the max any timeframe can
  // ask for) rather than maxGuides so the array never has to shrink.
  if (guideRefs.current.length < VECTOR_WALL_NODES_PER_SIDE) {
    guideRefs.current = [
      ...guideRefs.current,
      ...Array.from({ length: VECTOR_WALL_NODES_PER_SIDE - guideRefs.current.length }, () => null),
    ];
  }
  // Walk the FULL ref array (guideRefs.current.length), not just maxGuides: on a DOWNSHIFT
  // (e.g. 15m→1m) maxGuides drops from 12 to 6, so slots 6..11 hold price lines that must be
  // removed. levels is sliced to maxGuides, so applyPriceGuides sees `undefined` for every
  // slot past the new count and clears it (removePriceLine + null) — no stale guides linger.
  applyPriceGuides(
    series,
    guideRefs,
    levels.slice(0, maxGuides).map((l) => ({ ...l, label })),
    baseColor,
    guideRefs.current.length,
    true
  );
}

function applyDarkPoolGuides(
  series: ISeriesApi<"Candlestick">,
  guideRefs: React.MutableRefObject<(IPriceLine | null)[]>,
  levels: VectorDarkPoolLevel[]
): void {
  if (guideRefs.current.length < MAX_DP_GUIDES) {
    guideRefs.current = [
      ...guideRefs.current,
      ...Array.from({ length: MAX_DP_GUIDES - guideRefs.current.length }, () => null),
    ];
  }
  applyPriceGuides(
    series,
    guideRefs,
    levels.slice(0, MAX_DP_GUIDES).map((l) => ({ strike: l.strike, pct: l.pct, label: "DP" })),
    DARK_POOL_COLOR,
    MAX_DP_GUIDES,
    true
  );
}

function applyFlipGuide(
  series: ISeriesApi<"Candlestick">,
  lineRef: React.MutableRefObject<IPriceLine | null>,
  flip: number | null | undefined,
  label: string,
  color: string
): void {
  if (flip == null || !Number.isFinite(flip) || flip <= 0) {
    if (lineRef.current) {
      series.removePriceLine(lineRef.current);
      lineRef.current = null;
    }
    return;
  }
  const title = `${label} ${Math.round(flip)}`;
  const lineColor = withAlpha(color, 0.9);
  // The gamma flip is now the ONE analytical line on the chart (walls became beads, dark-pool
  // lines removed), so draw it as a real dashed line — not just an axis label — the single
  // regime-boundary reference the member kept.
  if (lineRef.current) {
    lineRef.current.applyOptions({
      price: flip,
      title,
      color: lineColor,
      lineWidth: 1,
      lineStyle: LineStyle.Dashed,
      lineVisible: true,
      axisLabelVisible: true,
    });
  } else {
    lineRef.current = series.createPriceLine({
      price: flip,
      color: lineColor,
      lineWidth: 1,
      lineStyle: LineStyle.Dashed,
      lineVisible: true,
      axisLabelVisible: true,
      title,
    });
  }
}

/**
 * King anchor — a persistent SOLID line at the single dominant call/put wall (member ask: "mark
 * the King node / anchor on the chart"). Distinct from the walls-as-beads treatment (#173) and the
 * dashed flip line: only the two strongest strikes get a line, styled as an anchor (solid, brighter,
 * ⚓ title), so a member always has the key level to trade against. The strike is chosen by
 * pickKingStrikes from the HORIZON-SCOPED walls, so the anchor re-scopes with the DTE toggle and is
 * redrawn every refreshOverlays (live + replay). Null strike → the line is removed.
 */
function applyKingAnchor(
  series: ISeriesApi<"Candlestick">,
  lineRef: React.MutableRefObject<IPriceLine | null>,
  strike: number | null,
  color: string
): void {
  if (strike == null || !Number.isFinite(strike) || strike <= 0) {
    if (lineRef.current) {
      series.removePriceLine(lineRef.current);
      lineRef.current = null;
    }
    return;
  }
  const title = kingAnchorTitle(strike);
  const lineColor = withAlpha(color, 0.85);
  if (lineRef.current) {
    lineRef.current.applyOptions({
      price: strike,
      title,
      color: lineColor,
      lineWidth: 2,
      lineStyle: LineStyle.Solid,
      lineVisible: true,
      axisLabelVisible: true,
    });
  } else {
    lineRef.current = series.createPriceLine({
      price: strike,
      color: lineColor,
      lineWidth: 2,
      lineStyle: LineStyle.Solid,
      lineVisible: true,
      axisLabelVisible: true,
      title,
    });
  }
}

/**
 * Max-pain line — a single DOTTED amber level at the strike of minimum aggregate option intrinsic
 * (where net-short writers pay out least and price tends to pin into expiry). DTE-dynamic: it reads
 * the horizon-scoped `/api/market/vector/max-pain` value, so it re-scopes with the toggle exactly
 * like the king anchor. Styled distinct from every other line (dotted amber vs the solid king, the
 * dashed cyan flip, and the gold/purple bead colours) so it reads as its own concept. Null → the
 * line is removed (no honest max-pain level to draw).
 */
function applyMaxPainLine(
  series: ISeriesApi<"Candlestick">,
  lineRef: React.MutableRefObject<IPriceLine | null>,
  strike: number | null
): void {
  if (strike == null || !Number.isFinite(strike) || strike <= 0) {
    if (lineRef.current) {
      series.removePriceLine(lineRef.current);
      lineRef.current = null;
    }
    return;
  }
  const opts = {
    price: strike,
    color: withAlpha("#f59e0b", 0.9), // amber — distinct from king/flip/bead colours
    lineWidth: 1 as const,
    lineStyle: LineStyle.Dotted,
    lineVisible: true,
    axisLabelVisible: true,
    title: `⊗ Max Pain ${strike}`,
  };
  if (lineRef.current) lineRef.current.applyOptions(opts);
  else lineRef.current = series.createPriceLine(opts);
}

const LEVEL_LINE_STYLE = {
  solid: LineStyle.Solid,
  dashed: LineStyle.Dashed,
  dotted: LineStyle.Dotted,
} as const;

/**
 * Draw the options-implied EXPECTED MOVE band (#15 cone, slice 3b) — dashed cyan price-lines at each
 * band's low+high (1σ solid-ish, 2σ fainter), labelled "1σ 7,424". Idempotent via a signature ref so
 * the frequent live-tick repaints are no-ops; only a changed horizon/band or a toggle flip rebuilds.
 * Cleared (all lines removed) when the toggle is off or there's no real band (`em == null`).
 */
function applyExpectedMoveBand(
  series: ISeriesApi<"Candlestick">,
  linesRef: React.MutableRefObject<IPriceLine[]>,
  sigRef: React.MutableRefObject<string>,
  em: ExpectedMove | null,
  enabled: boolean
): void {
  const sig = enabled && em ? em.bands.map((b) => `${b.sigma}:${b.low}:${b.high}`).join("|") : "off";
  if (sig === sigRef.current) return; // no change → don't churn the price lines on every tick
  sigRef.current = sig;
  for (const l of linesRef.current) series.removePriceLine(l);
  linesRef.current = [];
  if (!enabled || !em) return;
  for (const b of em.bands) {
    const alpha = b.sigma === 1 ? 0.8 : 0.45; // 1σ brighter than the wider 2σ
    for (const edge of [b.low, b.high]) {
      if (!(edge > 0) || !Number.isFinite(edge)) continue;
      linesRef.current.push(
        series.createPriceLine({
          price: edge,
          color: withAlpha("#22d3ee", alpha), // cyan — matches the "Expected move" menu swatch
          lineWidth: 1 as const,
          lineStyle: LineStyle.Dashed,
          lineVisible: true,
          axisLabelVisible: true,
          title: `${b.sigma}σ ${Math.round(edge).toLocaleString("en-US")}`,
        })
      );
    }
  }
}

/**
 * EOD PIN projection on the price chart (SPX desk): a solid gold price-line at the projected 0DTE
 * close + two dashed, fainter lines at the pin BAND edges — the 0DTE trader's close-target read in
 * price space, next to the candles (user-directed: move the pin onto the chart). Mirrors
 * applyExpectedMoveBand exactly: idempotent via a signature ref so live-tick repaints are no-ops;
 * cleared when disabled or there's no real projection. The shaded time→close CONE is a follow-up
 * (needs a canvas primitive); this draws the actionable levels with the proven price-line infra.
 */
function applyPinProjection(
  series: ISeriesApi<"Candlestick">,
  linesRef: React.MutableRefObject<IPriceLine[]>,
  sigRef: React.MutableRefObject<string>,
  proj: { close: number; band: [number, number] | null } | null,
  enabled: boolean
): void {
  const ok = enabled && proj && Number.isFinite(proj.close) && proj.close > 0;
  const sig = ok ? `${proj!.close}:${proj!.band?.[0] ?? ""}:${proj!.band?.[1] ?? ""}` : "off";
  if (sig === sigRef.current) return; // no change → don't churn the price lines on every tick
  sigRef.current = sig;
  for (const l of linesRef.current) series.removePriceLine(l);
  linesRef.current = [];
  if (!ok) return;
  const PIN_GOLD = "#ffd23f"; // --sig-king gold, matching the pin panel + max-pain
  // The full-width horizontal pin line is GONE — the Monte-Carlo cone (PinConePrimitive) now draws
  // the p50 pin as a converging curve + tip dot in the right margin, so a flat line across the whole
  // tape was redundant and visually fought the cone (member call, 2026-07-22). We keep ONLY the
  // price-axis label (lineVisible:false, axisLabelVisible:true): a clean gold tag at the pin price on
  // the right axis, aligned to where the cone tip lands, so the exact pin value stays legible without
  // any line clutter. The p10/p90 band likewise lives entirely in the cone now.
  linesRef.current.push(
    series.createPriceLine({
      price: proj!.close,
      color: PIN_GOLD,
      lineWidth: 1 as const,
      lineStyle: LineStyle.Solid,
      lineVisible: false,
      axisLabelVisible: true,
      title: `Pin ${Math.round(proj!.close).toLocaleString("en-US")}`,
    })
  );
}

/**
 * Pane layout: 0 = price/candles, 1 = volume (always present, its own sub-pane like RSI/MACD — NOT
 * an overlay on the candles), 2..N = enabled oscillators. `applyPaneStretch` reasserts the relative
 * pane heights so the price pane stays dominant and volume is a thin strip; it must run after the
 * oscillator panes are (re)built, since a freshly-created pane starts at the default stretch of 1.
 */
const VOLUME_PANE_INDEX = 1;
const PRICE_PANE_STRETCH = 8;
const VOLUME_PANE_STRETCH = 1.4;
const OSCILLATOR_PANE_STRETCH = 2.6;

function applyPaneStretch(chart: IChartApi, hideVolumePane = false): void {
  const panes = chart.panes();
  panes.forEach((pane, i) => {
    const stretch =
      i === 0
        ? PRICE_PANE_STRETCH
        : !hideVolumePane && i === VOLUME_PANE_INDEX
          ? VOLUME_PANE_STRETCH
          : OSCILLATOR_PANE_STRETCH;
    pane.setStretchFactor(stretch);
  });
}

/**
 * Draw/diff the enabled "Key levels" price lines (HOD/LOD, opening range, fib) on the candle series.
 * Each enabled level id expands to one or more {@link LevelLine}s via `levelLinesFor(bars)`; the map
 * (keyed `levelId:lineKey`) is reconciled against the desired set so lines are added/updated/removed
 * without churn. Computed from the CURRENTLY-shown bars, so levels track the timeframe and, in
 * replay, reflect the bars up to the cursor (HOD/LOD-so-far). Nothing drawn when the set is empty.
 */
function applyLevelLines(
  series: ISeriesApi<"Candlestick">,
  map: Map<string, IPriceLine>,
  enabled: Set<VectorIndicatorId>,
  bars: VectorBar[],
  priorDay: PriorDayOhlc | null,
  // Member-configurable opening-range window (2026-08-05 audit finding #7); defaults to the
  // registry default so any caller that omits it keeps the prior 15m behavior.
  openingRangeMinutes: VectorOpeningRangeMinutes = DEFAULT_OPENING_RANGE_MINUTES
): void {
  const desired = new Map<string, LevelLine>();
  for (const def of VECTOR_LEVELS) {
    if (!enabled.has(def.id)) continue;
    for (const line of levelLinesFor(def.id, bars, priorDay, openingRangeMinutes))
      desired.set(`${def.id}:${line.key}`, line);
  }
  // Remove lines no longer wanted (toggled off, or a level that now yields fewer lines).
  for (const [k, pl] of map) {
    if (!desired.has(k)) {
      series.removePriceLine(pl);
      map.delete(k);
    }
  }
  for (const [k, line] of desired) {
    const opts = {
      price: line.price,
      color: withAlpha(line.color, 0.9),
      lineWidth: 1 as const,
      lineStyle: LEVEL_LINE_STYLE[line.style],
      lineVisible: true,
      axisLabelVisible: true,
      title: line.label,
    };
    const existing = map.get(k);
    if (existing) existing.applyOptions(opts);
    else map.set(k, series.createPriceLine(opts));
  }
}

/**
 * Draw/diff the strongest CONFLUENCE ZONE as a faint band on the candle series. Reconciles up to
 * three price lines — the zone's weighted center plus its high/low edges — against the map (keyed
 * `mid`/`hi`/`lo`), so toggling off or a zone shift adds/updates/removes without churn. The zone is
 * the top-ranked cluster from the pure `confluenceZones` engine over whatever levels the caller
 * gathered (walls/flip/max-pain/golden-pocket/session/prior-day). When the band collapses to a
 * single price (edges within a hair of the center — a point-cluster) only the labeled center line is
 * drawn, so it doesn't render as three stacked identical lines. Nothing is drawn when the toggle is
 * off or no ≥2-kind zone exists — honest about "there is no confluence right now".
 */
function applyConfluenceBand(
  series: ISeriesApi<"Candlestick">,
  map: Map<string, IPriceLine>,
  enabled: Set<VectorIndicatorId>,
  spot: number,
  levels: readonly ConfluenceLevel[]
): void {
  const CONF_COLOR = "#f59e0b";
  const desired = new Map<string, { price: number; style: LineStyle; label: string; alpha: number }>();
  if (enabled.has("confluence-band") && spot > 0) {
    const band = topConfluenceBand(levels, spot);
    if (band) {
      const title = `◇ Confluence ×${band.kinds} · score ${Math.round(band.score * 10) / 10}`;
      desired.set("mid", { price: band.center, style: LineStyle.Dashed, label: title, alpha: 0.85 });
      // Edge lines only for a genuinely wide zone; a point-cluster draws the center alone.
      if (band.wide) {
        desired.set("hi", { price: band.high, style: LineStyle.Dotted, label: "", alpha: 0.45 });
        desired.set("lo", { price: band.low, style: LineStyle.Dotted, label: "", alpha: 0.45 });
      }
    }
  }
  for (const [k, pl] of map) {
    if (!desired.has(k)) {
      series.removePriceLine(pl);
      map.delete(k);
    }
  }
  for (const [k, d] of desired) {
    const opts = {
      price: d.price,
      color: withAlpha(CONF_COLOR, d.alpha),
      lineWidth: 1 as const,
      lineStyle: d.style,
      lineVisible: true,
      // Only the center carries an axis label; unlabeled edges keep the price scale uncluttered.
      axisLabelVisible: d.label !== "",
      title: d.label,
    };
    const existing = map.get(k);
    if (existing) existing.applyOptions(opts);
    else map.set(k, series.createPriceLine(opts));
  }
}

function applyWallsToSeries(
  series: ISeriesApi<"Candlestick">,
  callGuideRefs: React.MutableRefObject<(IPriceLine | null)[]>,
  putGuideRefs: React.MutableRefObject<(IPriceLine | null)[]>,
  walls: VectorWalls | null | undefined,
  lens: VectorWallLens,
  maxGuides: number
): void {
  // Must still call through (with empty levels) rather than early-return on null —
  // applyWallGuides/applyPriceGuides clear stale price lines when passed [], but an
  // early return here skips that entirely, leaving whatever was drawn on the PREVIOUS
  // frame's walls stuck on the chart. That silently masked the replay pre-first-sample
  // fix below: nulling out gexAt/vexAt during early-timeline scrubbing did nothing
  // visually because the old wall lines never got cleared.
  const v = lensVisuals(lens);
  applyWallGuides(series, callGuideRefs, walls?.callWalls ?? [], v.callColor, v.callLabel, maxGuides);
  applyWallGuides(series, putGuideRefs, walls?.putWalls ?? [], v.putColor, v.putLabel, maxGuides);
}

function buildWallBeadMarkers(
  trails: StrikeTrail[],
  baseColor: string,
  intervalSec: number = 60,
  /** Per-strike integrity (firm/moderate/thin) → the halo becomes a confidence RING. Omitted (VEX
   *  lens / unscored rails) leaves every halo at neutral weight, i.e. byte-identical to pre-ring. */
  tierByStrike?: Map<number, WallIntegrity>,
  /** Ribbon mode: the WallRailPrimitive canvas now carries strength (band thickness), magnitude
   *  (brightness), build/fade, birth, and death — the channels circle markers can't express. So in
   *  this mode the marker layer drops the fat glow halo + birth/death markers (which were the "blob"
   *  that flattened every bead to the same size) and keeps only a small, dim CORE dot per bucket as a
   *  crisp punctuation over the ribbon (and a safety net if the primitive ever fails to draw). */
  ribbonMode = false
): SeriesMarker<Time>[] {
  const markers: SeriesMarker<Time>[] = [];
  // Ribbon mode: the WallRailPrimitive owns the entire per-bucket rail (strength/growth/fade bands),
  // so this function emits NO per-point markers — the caller still appends the faint zoom-anchor
  // beads to this array. Short-circuit here so the per-point loop's work is skipped entirely.
  if (ribbonMode) return markers;
  // Earliest bucket across every rendered trail — the boundary where a trail's start is ambiguous
  // (window trim edge / session open) rather than a genuine formation. See trueBirth below.
  let earliestBucket: number | null = null;
  for (const trail of trails) {
    const t0 = trail.points[0]?.time;
    if (t0 != null && (earliestBucket == null || t0 < earliestBucket)) earliestBucket = t0;
  }
  // Frame-relative strength: find the STRONGEST wall currently in view, and scale every bead's
  // thickness/opacity against it (markerSizeForPctRel), NOT against a fixed 7% saturation. Per-
  // strike gamma share is ~6-8% on the UW oracle ladder but 20-40% on the per-expiry chain path,
  // so the old absolute cap clipped every stock wall to max → all beads looked identically fat
  // ("all our beads feel the same"). Normalizing to the in-frame king restores the Skylit fat-
  // king / thin-straggler contrast at any concentration, and — because a strike's pct varies
  // over the session — also makes a wall's band bulge thicker in the stretch where it built up.
  let maxPct = 0;
  for (const trail of trails) {
    for (const p of trail.points) if (p.pct > maxPct) maxPct = p.pct;
  }
  for (const trail of trails) {
    // BUG 3 birth→fade lifecycle: a strike that has LEFT the current wall set (active:false)
    // dims to STALE_TRAIL_FADE so it reads as receding/closed rather than a live rail. Its beads
    // already stop at its last-seen bucket (trailsByStrike never back-fills or extends), so a
    // departed wall neither runs to "now" nor to session open — it occupies exactly its lifespan.
    const staleFade = trail.active ? 1 : STALE_TRAIL_FADE;
    // Integrity ring: the wall's firm/moderate/thin confidence scales the HALO (its ring), never the
    // core dot. Same tier for every bead in this strike's trail — integrity is a property of the wall,
    // not of a single candle. Unknown strike → neutral {1,1}, so the halo is unchanged (see haloRingForTier).
    const ring = haloRingForTier(tierByStrike?.get(trail.strike)?.tier);
    const points = trail.points;
    for (let i = 0; i < points.length; i++) {
      const p = points[i]!;
      const time = p.time as Time;
      // Modeled (reconstructed) beads read as a FAINT, smaller GHOST of an observed bead: same
      // color/shape, alpha scaled to MODELED_ALPHA_SCALE (0.15) and size to 0.6×, so a real recorded
      // sample (solid, full size) is unmistakably "more real" wherever it overwrites the modeled one
      // — and a full-width reconstruction reads as a quiet underlay, not axis-to-axis walls.
      // Observed beads (modeled falsy) are unchanged.
      const modeled = p.modeled === true;
      const alphaScale = (modeled ? MODELED_ALPHA_SCALE : 1) * staleFade;
      // Growth/decay velocity: compare this bucket's share to the previous one so a wall being
      // STACKED right now flares brighter+fatter and one bleeding out dims+narrows — the rail
      // breathes instead of just painting. Neutral for the first bead and for modeled ghosts
      // (their reconstructed prefix has no honest bucket-to-bucket velocity).
      const prevPct = i > 0 ? points[i - 1]!.pct : null;
      const mod = modeled
        ? { alphaMul: 1, sizeMul: 1, building: false, fading: false }
        : growthModulation(p.pct, prevPct, maxPct);
      const size = markerSizeForPctRel(p.pct, maxPct) * (modeled ? 0.6 : 1) * mod.sizeMul;
      const coreAlpha = Math.min(1, alphaForPctRel(p.pct, maxPct) * alphaScale * mod.alphaMul);
      // Glow carries TWO independent channels the core can't: absolute magnitude (a genuinely
      // massive wall halos wider/brighter regardless of its frame rank) and the same build/fade
      // velocity. Multiplier reduced from 2.2 → 1.6 so the halo doesn't mask the core's size.
      const glowAlpha =
        glowAlphaForPctRel(p.pct, maxPct) * alphaScale * mod.alphaMul * (modeled ? 1 : magnitudeGlowBoost(p.pct));
      markers.push({
        time,
        position: "atPriceMiddle",
        price: trail.strike,
        shape: "circle",
        color: withAlpha(baseColor, Math.min(1, glowAlpha * ring.alphaMul)),
        size: size * 1.6 * ring.sizeMul,
      });
      markers.push({
        time,
        position: "atPriceMiddle",
        price: trail.strike,
        shape: "circle",
        color: withAlpha(baseColor, coreAlpha),
        size,
      });
      // BIRTH bead: the candle where this wall first appeared. A new wall naturally starts at the
      // current candle (birth-anchored), and we brighten that origin bead so a member can SEE when
      // and at what price the wall formed — the "where did this new wall come from" cue. Skip for
      // modeled ghosts (they fill the whole session and have no meaningful single birth).
      // REBIRTH: a wall that dropped out of the dominant set and re-formed later resumes after a
      // GAP in its bead row (trailsByStrike only emits buckets where the strike was dominant, so a
      // dead stretch is simply missing points). Boost the resume bead exactly like a birth — the
      // member sees the candle where the wall came BACK, not a silent continuation. Gap threshold
      // is 2 candle intervals so honest single-bucket jitter doesn't spray fake rebirth cues.
      const reborn = i > 0 && p.time - points[i - 1]!.time > intervalSec * 2;
      // Suppress the birth boost when the trail starts at the EARLIEST drawn bucket — that "birth"
      // is unknowable (live-window trim edge or session open): the wall may have existed before the
      // window we're drawing. Only a birth strictly INSIDE the drawn window is a real formation cue.
      const trueBirth = i === 0 && earliestBucket != null && p.time > earliestBucket;
      if ((trueBirth || reborn) && !modeled) {
        markers.push({
          time,
          position: "atPriceMiddle",
          price: trail.strike,
          shape: "circle",
          color: withAlpha(baseColor, Math.min(1, coreAlpha + BIRTH_BEAD_ALPHA_BOOST)),
          size: size + 1.5,
        });
      }
      // DEATH bead: the LAST bucket of a wall that has left the dominant set (trail.active === false)
      // is where it died. Mark it with a wide, very-faint "dissipation" halo — larger than the core
      // but dim — so the member sees the wall didn't just stop, it dissolved here. Skip modeled
      // ghosts (no real death) and skip when the terminal bead already got a birth/rebirth boost
      // (a one-bucket blip is a blip, not a death worth haloing).
      const isDeath = !trail.active && i === points.length - 1 && !modeled && !(trueBirth || reborn);
      if (isDeath) {
        markers.push({
          time,
          position: "atPriceMiddle",
          price: trail.strike,
          shape: "circle",
          color: withAlpha(baseColor, Math.min(1, glowAlpha * DEATH_BEAD_ALPHA)),
          size: size * 2.1,
        });
      }
    }
  }
  return markers;
}

function applyWallBeadMarkers(
  beadsPlugin: ISeriesMarkersPluginApi<Time> | null,
  history: WallHistorySample[],
  side: "callWalls" | "putWalls",
  baseColor: string,
  lens: VectorWallLens,
  intervalMinutes: VectorTimeframeMinutes,
  lastBarTime: number = 0,
  liveBeads = false,
  maxStrikes = wallCountForTimeframe(intervalMinutes),
  /** Pin a ghost bead at the latest bar for live-edge zoom — off during session overview so the
   *  full recorded trail stretches across RTH without a fake right-edge column. */
  pinLiveAnchorBeads = true,
  trailBucketSec = VECTOR_WALL_TRAIL_SEC,
  /** Live spot, used to prefer near-spot bead rows over far-OTM ones (see pickActiveStrikes).
   *  null is a supported state — the row ordering then falls back to pure strength. */
  spot: number | null = null,
  /** Compare panes: dimmer, smaller zoom-anchor ghosts. */
  compactBeads = false
): { strikes: number[]; rendered: StrikeTrail[] } {
  if (!beadsPlugin) return { strikes: [], rendered: [] };
  const bucketed = bucketWallHistoryForInterval(history, intervalMinutes, {
    minBucketSec: trailBucketSec,
    liveBeads,
  });
  // Lifecycle carries each strike's birth/last-seen/active flags so the marker layer can anchor
  // beads to the birth candle and fade departed walls (BUG 3). It wraps trailsByStrike, so the
  // point lists are identical to before — only the per-strike metadata is added.
  const lifecycle = strikeTrailLifecycle(bucketed, side, lens);
  const trailMap = new Map(lifecycle.map((t) => [t.strike, t.points]));
  // Bead strike-rows scale with the timeframe the same way the wall guides do — few near-spot
  // rows on 1m, more (further-out) rows on higher timeframes.
  const active = pickActiveStrikes(trailMap, maxStrikes, { spot });
  const activeSet = new Set(active);
  const rendered = lifecycle.filter((t) => activeSet.has(t.strike));
  // Per-wall integrity → bead rings. Scored only on the GEX lens: persistence is measured against
  // sample.walls (GEX), so scoring VEX beads off GEX history would ring the wrong strikes. On the
  // VEX lens tierByStrike stays undefined → neutral halos (unchanged). Computed from the LATEST rail
  // sample's walls so the ring matches the live desk-terminal firm/moderate/thin verdict exactly.
  const latestWalls = history[history.length - 1]?.walls;
  const tierByStrike =
    lens === "gex" && latestWalls
      ? integrityByStrike(latestWalls, history)[side === "callWalls" ? "call" : "put"]
      : undefined;
  const markers = buildWallBeadMarkers(rendered, baseColor, intervalMinutes * 60, tierByStrike, true);
  // ZOOM ANCHOR: lightweight-charts only renders markers at timestamps within the visible time
  // range. If a wall's beads are concentrated in the earlier part of the session (e.g. a wall
  // formed at 17:30 and faded by 18:30), zooming in on recent candles clips ALL its beads and
  // the entire row vanishes — even though the price level is still visible. Fix: pin an anchor
  // bead at the latest bar time for every rendered trail so at least one marker is always near
  // the chart's right edge. Active walls get a normal-strength anchor; inactive (faded) walls
  // get a faint ghost so the user can still see where the wall was.
  if (lastBarTime > 0 && pinLiveAnchorBeads) {
    const anchorTime = lastBarTime as Time;
    let maxPct = 0;
    for (const trail of rendered) {
      for (const p of trail.points) if (p.pct > maxPct) maxPct = p.pct;
    }
    for (const trail of rendered) {
      const lastPoint = trail.points[trail.points.length - 1];
      if (!lastPoint) continue;
      // Skip if the trail already has a point at or very near the latest bar (within one candle)
      if (lastPoint.time >= lastBarTime - intervalMinutes * 60) continue;
      const anchorAlpha = (trail.active ? 0.5 : 0.15) * (compactBeads ? 0.35 : 1);
      const anchorSize =
        markerSizeForPctRel(lastPoint.pct, maxPct) * (trail.active ? 0.8 : 0.5) * (compactBeads ? 0.5 : 1);
      markers.push({
        time: anchorTime,
        position: "atPriceMiddle",
        price: trail.strike,
        shape: "circle",
        color: withAlpha(baseColor, anchorAlpha),
        size: anchorSize,
      });
    }
  }
  beadsPlugin.setMarkers(markers);
  // Return the strikes actually drawn so the caller can widen the price axis to cover them —
  // otherwise a drawn bead outside the current-ladder range clips out on zoom (see beadStrikesRef) —
  // plus the lifecycle-filtered trails so the caller can feed the WallRailPrimitive (ribbon rail),
  // which draws the SAME strikes as continuous strength/growth/fade bands.
  return { strikes: active, rendered };
}

/** Feed the WallRailPrimitive the composed call+put trails. maxPct is taken across BOTH sides so the
 *  king wall (whichever side) is the single frame reference every band scales against — a call and a
 *  put of equal share render equally fat. A null primitive or empty trails draws nothing. */
function feedWallRail(
  rail: WallRailPrimitive | null,
  callRendered: StrikeTrail[],
  putRendered: StrikeTrail[],
  callColor: string,
  putColor: string,
  visible: boolean,
  profile: WallBeadRenderProfile = "default"
): void {
  if (!rail) return;
  let maxPct = 0;
  for (const t of callRendered) for (const p of t.points) if (p.pct > maxPct) maxPct = p.pct;
  for (const t of putRendered) for (const p of t.points) if (p.pct > maxPct) maxPct = p.pct;
  rail.setData(
    { callTrails: callRendered, putTrails: putRendered, maxPct, callColor, putColor, profile },
    visible && maxPct > 0
  );
}

function upsertBar(bars: VectorBar[], candle: VectorBar): VectorBar[] {
  const last = bars[bars.length - 1];
  if (last && last.time === candle.time) {
    return [...bars.slice(0, -1), candle];
  }
  if (!last || candle.time > last.time) {
    return [...bars, candle];
  }
  return bars;
}

function emptyGuideRefs(): (IPriceLine | null)[] {
  // Sized to the server cap (max any timeframe can draw); applyWallGuides only fills up to the
  // timeframe's scaled count and clears the rest.
  return Array.from({ length: VECTOR_WALL_NODES_PER_SIDE }, () => null);
}

function displayBarsFromMinute(
  minuteBars: VectorBar[],
  intervalMinutes: VectorTimeframeMinutes,
  cursorTime?: number
): VectorBar[] {
  const base =
    cursorTime != null ? (sliceBarsToTime(minuteBars, cursorTime) as VectorBar[]) : minuteBars;
  return aggregateVectorBars(base, intervalMinutes) as VectorBar[];
}

export function VectorChart({
  ticker,
  initialBars,
  initialWalls,
  initialVexWalls,
  initialWallHistory,
  initialHorizonWallHistory = [],
  initialGammaFlip,
  initialVexFlip,
  initialDarkPoolLevels,
  sessionYmd,
  liveSession,
  initialWallTrailSec,
  onFreshness,
  onSpotChange,
  onWallEventsChange,
  onRegimeChange,
  onProximityChange,
  onMagnetChange,
  onConfluenceChange,
  onWallIntegrityChange,
  onLensChange,
  onDteHorizonChange,
  onTechnicalsChange,
  onExpectedMoveChange,
  onPlayChange,
  alertRules,
  onAlertsFired,
  leadSlot,
  replayLeadSlot,
  trailSlot,
  regimeSlot,
  defaultDteHorizon,
  defaultTimeframe,
  defaultChartViewport = "live",
  onPriceScaleRender,
  focusLevel,
  playLevels,
  fillHost = false,
  defaultLens,
  toolbarHideLinkedControls = false,
  hideVolumePane = false,
  compareCompactBeads = false,
  compareSync = null,
  onCompareCrosshair,
  onCompareVisibleRange,
}: Props) {
  const initialTimeframe = defaultTimeframe ?? VECTOR_DEFAULT_TIMEFRAME;
  const openingDteHorizon: VectorDteHorizon = defaultDteHorizon ?? VECTOR_DEFAULT_DTE_HORIZON;
  const initialIndicators = defaultVectorIndicators();
  const containerRef = useRef<HTMLDivElement>(null);
  const { fullscreen: chartFullscreen, exitFullscreen, chartStageRef } = useIosChartDoubleTapFullscreen(true);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  // Shared-price-axis seam: latest callback in a ref (the mount effect is []-dep), plus the
  // last emitted snapshot so the 250ms poll only calls back when the scale actually moved.
  const onPriceScaleRenderRef = useRef(onPriceScaleRender);
  const lastPriceScaleSnapRef = useRef<PriceScaleSnapshot | null>(null);
  useEffect(() => {
    onPriceScaleRenderRef.current = onPriceScaleRender;
  });
  const volumeSeriesRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  // Always-on technicals narration (VWAP/EMA/RSI/MACD/pocket/structure) → terminal, computed on
  // every paint from the shown bars regardless of which overlays are toggled. `onTechnicalsChangeRef`
  // keeps the latest callback for the []-dep paintOverlays; `lastTechnicalsRef` dedupes emits.
  const onTechnicalsChangeRef = useRef(onTechnicalsChange);
  const lastTechnicalsRef = useRef<string>("");
  useEffect(() => {
    onTechnicalsChangeRef.current = onTechnicalsChange;
  });
  // Expected-move narration → terminal (#15 cone, slice 3a). Ref keeps the latest callback for the
  // horizon-scoped fetch; lastExpectedMoveRef dedupes emits so an unchanged horizon doesn't re-push.
  const onExpectedMoveChangeRef = useRef(onExpectedMoveChange);
  const lastExpectedMoveRef = useRef<string>("");
  useEffect(() => {
    onExpectedMoveChangeRef.current = onExpectedMoveChange;
  });
  // The fused play (buildVectorPlay) — technicalsForPlayRef caches the raw TechnicalsSummary the
  // always-on terminal narration already computes (see paintOverlays), mapped once via
  // playTechnicalsFromSummary so emitPlay never re-summarizes bars itself. onPlayChangeRef/
  // lastPlayKeyRef follow the same latest-callback / dedupe pattern as every other emit* above.
  const onPlayChangeRef = useRef(onPlayChange);
  const technicalsForPlayRef = useRef<PlayTechnicals | null>(null);
  const lastPlayKeyRef = useRef<string>("");
  useEffect(() => {
    onPlayChangeRef.current = onPlayChange;
  });
  // Alerts: the member's rules + the engine's per-rule state + the prior spot (for flip-cross), all
  // in refs so the []-dep tick handler reads the latest without re-subscribing the SSE stream.
  const alertRulesRef = useRef<AlertRule[]>(alertRules ?? []);
  const alertStateRef = useRef<AlertState>({});
  const priorSpotRef = useRef<number | null>(null);
  const onAlertsFiredRef = useRef(onAlertsFired);
  useEffect(() => {
    alertRulesRef.current = alertRules ?? [];
    onAlertsFiredRef.current = onAlertsFired;
  });
  const callGuideRefs = useRef<(IPriceLine | null)[]>(emptyGuideRefs());
  const putGuideRefs = useRef<(IPriceLine | null)[]>(emptyGuideRefs());
  // Strikes currently drawn on the chart — read by the candle series'
  // autoscaleInfoProvider to widen the price axis so support/resistance walls
  // (esp. put walls a few % below spot) aren't clipped off-screen. Seeded from the
  // SSR walls so the FIRST autoscale on mount already includes them.
  // Sliced to the mount default timeframe so the first autoscale matches what's actually drawn;
  // refreshOverlays re-slices to the active timeframe on every repaint.
  const rangeWallsRef = useRef<{ call: number[]; put: number[] }>({
    call: (initialWalls?.callWalls ?? []).slice(0, wallCountForTimeframe(initialTimeframe)).map((w) => w.strike),
    put: (initialWalls?.putWalls ?? []).slice(0, wallCountForTimeframe(initialTimeframe)).map((w) => w.strike),
  });
  // The strikes ACTUALLY drawn as beads (from the session-trail rail, per side). The autoscale
  // provider widens for these too — not just the live ladder in rangeWallsRef — so a bead never
  // clips out when zoom re-runs autoscale off fewer visible candles. Populated by refreshTrails.
  const beadStrikesRef = useRef<{ call: number[]; put: number[] }>({ call: [], put: [] });
  const dpGuideRefs = useRef<(IPriceLine | null)[]>([]);
  const flipGuideRef = useRef<IPriceLine | null>(null);
  // King anchors — solid lines at the single dominant call/put wall (member ask). Re-scope with the
  // DTE horizon (they read the same horizon-scoped walls refreshOverlays draws) and are cleared on
  // ticker switch / unmount alongside the flip line.
  const kingCallLineRef = useRef<IPriceLine | null>(null);
  const kingPutLineRef = useRef<IPriceLine | null>(null);
  // Max-pain level — a single dotted amber line at the horizon-scoped max-pain strike, fetched from
  // /api/market/vector/max-pain and redrawn on ticker/DTE change (like the king anchor). Cleared on
  // ticker switch / unmount alongside the other price lines. The VALUE is kept too — the confluence
  // emit stacks it against the other levels.
  const maxPainLineRef = useRef<IPriceLine | null>(null);
  const maxPainValueRef = useRef<number | null>(null);
  // PULSE → CHART ANCHOR (2026-07-26): the transient highlight line drawn for a Pulse "→ chart"
  // click, and the timer that fades it. Kept in refs so the flash effect can remove a PRIOR line
  // (and cancel its pending fade) before drawing the next one, and clean both up on unmount.
  const focusLineRef = useRef<IPriceLine | null>(null);
  const focusTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // PLAYS ON THE CHART (2026-07-26): the member's ACTIVE SPX play drawn as entry/stop/target/
  // invalidation price-lines, kept in a DEDICATED map keyed by line kind so it reconciles
  // independently and never clobbers the flip / max-pain / EM / pin / confluence / focus lines.
  const playLineRef = useRef<Map<PlayLineKind, IPriceLine>>(new Map());
  // Expected-move band (#15 cone, slice 3b): the last-fetched band, its drawn price-lines, and a
  // signature so paintOverlays only rebuilds the lines when the band or the toggle actually changes.
  const expectedMoveBandsRef = useRef<ExpectedMove | null>(null);
  const emBandLinesRef = useRef<IPriceLine[]>([]);
  const emBandSigRef = useRef<string>("");
  // EOD pin projection (SPX desk only): the last-fetched projected close + band, its drawn
  // price-lines, and a signature so paintOverlays only rebuilds the lines when the value changes.
  const pinProjRef = useRef<{ close: number; band: [number, number] | null } | null>(null);
  const pinLinesRef = useRef<IPriceLine[]>([]);
  const pinSigRef = useRef<string>("");
  // EOD pin CONE (SPX desk only): the Monte-Carlo p10/p50/p90 close distribution, drawn as a
  // converging shaded curve in the chart's RIGHT MARGIN (now → 16:00) by PinConePrimitive. The
  // cone data is the last-fetched MC `cone` array; the primitive projects it by time-fraction so it
  // reads as a funnel narrowing onto the pin. Cleared on ticker switch / unmount with the series.
  const pinConePrimitiveRef = useRef<PinConePrimitive | null>(null);
  const pinConeRef = useRef<PinConeStep[] | null>(null);
  // TIME-CONVERGING EXPECTED-MOVE CONE (default OFF, "expected-move-cone" toggle): the "remaining
  // intraday move" funnel — the last-fetched expected-move band (expectedMoveBandsRef, shared with
  // the flat ±1σ/2σ lines) rebuilt via emConeFromExpectedMove into a cone that narrows from "now"
  // (the latest bar's ET minute) to the 16:00 close, since move ∝ √time. Drawn in the right margin
  // by EmConePrimitive at zOrder "bottom"; a null band/spot or off-hours clock draws nothing. Cleared
  // on ticker switch / unmount with the series (chart.remove disposes attached primitives).
  const emConePrimitiveRef = useRef<EmConePrimitive | null>(null);
  // GEX positioning heatmap (#14): the strike×time surface primitive attached BEHIND the candles
  // (zOrder "bottom"), plus the last horizon-scoped grid it draws. The grid is fetched in the
  // DTE-scoped effect (like max-pain/expected-move) and visibility is gated on the "gex-heatmap"
  // toggle; a null grid or the toggle off makes the primitive draw nothing. Cleared on ticker
  // switch / unmount — chart.remove() disposes the series (and its primitives), so we just drop refs.
  const gexHeatmapPrimitiveRef = useRef<GexHeatmapPrimitive | null>(null);
  const gexHeatmapGridRef = useRef<GexHeatmapGrid | null>(null);
  const gexHeatmapSpotAtFetchRef = useRef<number | null>(null);
  // Dealer-gamma REGIME boundary glow (default OFF, "gamma-regime" toggle): a low-alpha teal/amber
  // gradient hugging the gamma-flip line — calm/long-γ above, unstable/short-γ below. The primitive
  // draws nothing until the toggle is on AND a finite flip is pushed. `regimeFlipRef` caches the
  // last active-lens flip so a toggle repaint (paintOverlays) can re-push it without waiting for the
  // next live tick (mirrors how gexHeatmapGridRef feeds the heatmap on toggle).
  const gammaRegimePrimitiveRef = useRef<GammaRegimePrimitive | null>(null);
  const regimeFlipRef = useRef<number | null>(null);
  // SESSION VOLUME PROFILE (default OFF, "volume-profile" toggle): computed from the raw 1m session
  // bars (minuteBarsRef), not the display-timeframe-aggregated bars — a coarser candle timeframe
  // (e.g. 60m) should not thin out the profile's price resolution. Recomputed in paintOverlays
  // whenever bars/toggle change; draws nothing until enabled AND real volume exists this session.
  const volumeProfilePrimitiveRef = useRef<VolumeProfilePrimitive | null>(null);
  const lastConfluenceRef = useRef<string>("");
  // Opt-in technical overlays (VWAP/EMA/SMA) — one lightweight-charts line series per enabled
  // indicator, created on demand and removed when toggled off. Default: none. `indicatorsRef`
  // mirrors the state for the imperative paint path; `lastDisplayBarsRef` lets a toggle repaint
  // against the currently-shown bars without waiting for the next tick/timeframe change.
  const overlaySeriesRef = useRef<Map<VectorOverlayId, ISeriesApi<"Line">>>(new Map());
  // Oscillator sub-pane series (RSI / MACD) — keyed by series role. Rebuilt only when the enabled
  // OSCILLATOR set changes (pane layout shifts); their data is refreshed every paint. `lastOscKey`
  // is that enabled-set signature so we don't tear down/recreate panes on every tick.
  const oscillatorSeriesRef = useRef<Map<string, ISeriesApi<"Line"> | ISeriesApi<"Histogram">>>(new Map());
  const lastOscKeyRef = useRef<string>("");
  // Horizontal price-line overlays for the "Key levels" group (HOD/LOD, opening range, fib), keyed
  // by `${levelId}:${lineKey}` so each line is diffed/kept/removed independently across repaints.
  const levelLinesRef = useRef<Map<string, IPriceLine>>(new Map());
  // The strongest-confluence-zone band lines (center + edges), keyed mid/hi/lo, reconciled the same
  // way as the level lines. Separate map because the zone is derived from live walls/flip/max-pain,
  // not from `levelLinesFor(bars)`, so it repaints on wall/flip updates too — not just bar changes.
  const confluenceBandRef = useRef<Map<string, IPriceLine>>(new Map());
  // WALL RIBBON RAIL (the dealer-wall beads drawn as continuous strength/growth/fade bands, replacing
  // the same-size circle markers as the primary rail visual — see WallRailPrimitive). One canvas
  // primitive draws BOTH sides; it's fed the lifecycle-filtered call+put trails from
  // applyWallBeadMarkers each repaint. Cleared on ticker switch / unmount with the series.
  const wallRailPrimitiveRef = useRef<WallRailPrimitive | null>(null);
  // Prior-session OHLC for the PDH/PDL/PDC + floor-pivot levels — fetched once per ticker (only when
  // such a level is enabled). `priorDayTickerRef` guards a fetch from a previous ticker landing late.
  const priorDayRef = useRef<PriorDayOhlc | null>(null);
  const priorDayTickerRef = useRef<string | null>(null);
  const indicatorsRef = useRef<Set<VectorIndicatorId>>(initialIndicators);
  // Opening-range window (2026-08-05 audit finding #7) — mirrors the indicators/indicatorsRef
  // pattern above: `openingRangeMinutes` is the React state the toolbar's preset control drives,
  // `openingRangeMinutesRef` is what the imperative paint path (applyLevelLines) reads.
  const openingRangeMinutesRef = useRef<VectorOpeningRangeMinutes>(DEFAULT_OPENING_RANGE_MINUTES);
  const lastDisplayBarsRef = useRef<VectorBar[]>(initialBars);
  const callBeadsRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null);
  const putBeadsRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null);
  // Market-structure markers (pivot labels + BOS/CHOCH) — own instance, cleared with the beads.
  const structureMarkersRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null);
  // Options-flow markers (large trades at strike/time) — its OWN createSeriesMarkers instance so it
  // never clobbers the two bead instances or the structure instance. `flowPrintsRef` holds the last
  // horizon-scoped fetch; paintOverlays draws it when the toggle is on and clears it when off.
  const flowMarkersRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null);
  const flowPrintsRef = useRef<FlowPrint[]>([]);
  const flowMinPremiumRef = useRef<number>(0);
  // Dedupe the truncation console note so a steady poll doesn't spam it — only log when the dropped
  // count changes. (No SILENT truncation: the cap is always announced when prints are dropped.)
  const lastFlowTruncatedRef = useRef<number>(-1);
  const wallHistoryRef = useRef<WallHistorySample[]>(initialWallHistory);
  const [wallTrailSec, setWallTrailSec] = useState(
    initialWallTrailSec ?? vectorWallTrailSecClient(ticker)
  );
  const wallTrailSecRef = useRef(wallTrailSec);
  useEffect(() => {
    wallTrailSecRef.current = wallTrailSec;
  }, [wallTrailSec]);
  useEffect(() => {
    setWallTrailSec(initialWallTrailSec ?? vectorWallTrailSecClient(ticker));
  }, [ticker, initialWallTrailSec]);
  /** Canonical 1m session bars — SSE live ticks and Polygon seed write here only. */
  const minuteBarsRef = useRef<VectorBar[]>(initialBars);
  const displayBarTimeRef = useRef<number>(0);
  const timeframeRef = useRef<VectorTimeframeMinutes>(initialTimeframe);
  // Tracks the timeframe the time scale was last fitContent()'d to, so the timeframe effect can
  // tell a GENUINE timeframe switch (refit expected) from a re-run triggered by a dependency's
  // identity change or a liveSession flip (must preserve the member's zoom/pan). See BUG 2.
  const lastFittedTimeframeRef = useRef<VectorTimeframeMinutes>(initialTimeframe);
  const gammaFlipRef = useRef<number | null>(initialGammaFlip);
  const vexFlipRef = useRef<number | null>(initialVexFlip);
  const darkPoolRef = useRef<VectorDarkPoolLevel[]>(initialDarkPoolLevels);
  const gexWallsRef = useRef<VectorWalls | null>(initialWalls);
  const vexWallsRef = useRef<VectorWalls | null>(initialVexWalls);
  // DTE-horizon override: when the member picks a horizon other than "all", the
  // displayed GEX walls come from an on-demand fetch of /api/market/vector/walls
  // (the per-second SSE stream keeps carrying the full near-term walls into
  // gexWallsRef untouched). null = follow the live stream. See liveGexWalls().
  const horizonWallsRef = useRef<VectorWalls | null>(null);
  // Horizon-scoped gamma flip, paired with horizonWallsRef: when a narrower DTE is
  // active the flip line re-scopes to the same per-expiry ladder the walls came from
  // (server returns it on /api/market/vector/walls). null = follow the live stream flip.
  const horizonFlipRef = useRef<number | null>(null);
  // Recorded per-horizon bead trail (the FROZEN point-in-time clusters for the active narrowed
  // horizon), fetched from /api/market/vector/wall-history on each DTE toggle. Empty for "all"
  // (that rail is SSR-seeded into wallHistoryRef) or when nothing was recorded for the horizon.
  // refreshTrails prefers this over the single-column narrowedHorizonTrail so weekly/monthly show
  // the accumulated clusters after close — the after-hours analogue of the live "All" rail.
  const horizonHistoryRef = useRef<WallHistorySample[]>(
    initialHorizonWallHistory.length && openingDteHorizon !== "all"
      ? initialHorizonWallHistory
      : []
  );
  /**
   * True when this mount got NO server-rendered blended rail, so the "all" horizon has to fetch its
   * own. `/vector` always seeds it; the SPX Slayer embed deliberately passes `initialWallHistory={[]}`
   * because a cold Polygon reconstruct can block the HTML for 30-90s. Every layer below used to
   * assume the seed existed, so on the dashboard the blended rail was structurally always empty.
   * FINDINGS 2026-08-07.
   */
  const seedRailEmpty = initialWallHistory.length === 0;
  const seedRailEmptyRef = useRef(seedRailEmpty);
  seedRailEmptyRef.current = seedRailEmpty;
  const dteHorizonRef = useRef<VectorDteHorizon>(openingDteHorizon);
  /** Session overview on load (full RTH + bead trail) until the member pans to the live edge. */
  const liveFollowEnabledRef = useRef(defaultChartViewport === "live");
  const defaultChartViewportRef = useRef(defaultChartViewport);
  useEffect(() => {
    defaultChartViewportRef.current = defaultChartViewport;
  }, [defaultChartViewport]);
  const chartUserPannedRef = useRef(false);
  // Dedupe regime emissions — the read only changes when posture/flip/levels
  // shift, not every tick, so we skip identical reads to avoid re-rendering the
  // banner on every SSE frame.
  const lastRegimeReadRef = useRef<string>("");
  const lastProximityRef = useRef<string>("");
  const lastMagnetRef = useRef<string>("");
  const lastWallIntegrityRef = useRef<string>("");
  const lensRef = useRef<VectorWallLens>("gex");
  // Timestamp of the last wheel event on the chart — during the cooldown window the
  // autoscaleInfoProvider skips wall/bead extension and reassertPriceAutoScale is
  // suppressed, so the member's zoom holds stable instead of snapping back to the
  // wide wall-inclusive range on the next SSE tick (~1/sec).
  const wheelZoomCooldownRef = useRef(0);
  const spotRef = useRef<number | null>(
    initialBars.length ? initialBars[initialBars.length - 1]!.close : null
  );
  const timelineRef = useRef<number[]>([]);
  const connRef = useRef<ReturnType<typeof createVectorEventSource> | null>(null);
  const replayTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const applyingExternalCrosshairRef = useRef(false);
  const applyingExternalRangeRef = useRef(false);
  const compareSyncRef = useRef(compareSync);
  const onCompareCrosshairRef = useRef(onCompareCrosshair);
  const onCompareVisibleRangeRef = useRef(onCompareVisibleRange);
  const hideVolumePaneRef = useRef(hideVolumePane);
  const compareCompactBeadsRef = useRef(compareCompactBeads);
  const replayModeRef = useRef(false);
  const liveSessionRef = useRef(liveSession);
  /**
   * Mirrors cursorIndex for reads outside React's render cycle (replay timer, lens
   * repaint, stepReplay). Keeping paints OUT of setCursorIndex updater callbacks matters:
   * updaters must be pure (StrictMode double-invokes them), so applyFrame calls live next
   * to the state set instead of inside it.
   */
  const cursorIndexRef = useRef(0);

  const [sessionHistory, setSessionHistory] = useState(initialWallHistory);
  const [sessionBars, setSessionBars] = useState(initialBars);
  const [replayMode, setReplayMode] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [cursorIndex, setCursorIndex] = useState(0);
  const [replaySpeed, setReplaySpeed] = useState(1);
  const [replayLoop, setReplayLoop] = useState(false);
  useEffect(() => {
    compareSyncRef.current = compareSync;
    onCompareCrosshairRef.current = onCompareCrosshair;
    onCompareVisibleRangeRef.current = onCompareVisibleRange;
    hideVolumePaneRef.current = hideVolumePane;
    compareCompactBeadsRef.current = compareCompactBeads;
  }, [compareSync, onCompareCrosshair, onCompareVisibleRange, hideVolumePane, compareCompactBeads]);

  const [crosshair, setCrosshair] = useState<VectorCrosshairState | null>(null);
  const [lens, setLens] = useState<VectorWallLens>(defaultLens ?? "gex");
  // Default WEEKLY: "All" is no longer a member-facing option (2026-07-13), and 0DTE is empty
  // mid-week for most single names (only SPX/SPY/QQQ have daily expiries) — weekly always has a
  // real chain to scope to. SPX day-traders tap 0DTE once; the choice persists per session.
  // Host desks may override the OPENING horizon (defaultDteHorizon — the SPX Slayer embed opens
  // on 0DTE); after mount the member's toggle rules either way.
  const [dteHorizon, setDteHorizon] = useState<VectorDteHorizon>(
    defaultDteHorizon ?? VECTOR_DEFAULT_DTE_HORIZON
  );
  // Per-expiry walls are now computed from the Polygon options chain for EVERY ticker
  // (per-contract expiry + OI + IV → BSM GEX ladder at spot), not just the 3 UW-oracle
  // names, so the horizon toggle is real everywhere. Vector only ever loads optionable
  // tickers, and getVectorGexWallsForHorizon's honest fallback guarantees walls never
  // blank, so the toggle is always available.
  const dteAvailable = true;
  // appendVectorWallEvents enforces the display cap — a bare concat of both
  // lenses' seeds could hold up to 2× the cap.
  const [wallEvents, setWallEvents] = useState<VectorWallEvent[]>(() =>
    appendVectorWallEvents(eventsFromWallHistory(initialWallHistory, "gex"), [
      ...eventsFromWallHistory(initialWallHistory, "vex"),
    ])
  );
  const [vexAvailable, setVexAvailable] = useState(
    () =>
      Boolean(initialVexWalls?.callWalls?.length || initialVexWalls?.putWalls?.length) ||
      hasVexInHistory(initialWallHistory)
  );
  const [gexAsOf, setGexAsOf] = useState<number | null>(null);
  const [vexAsOf, setVexAsOf] = useState<number | null>(null);
  // 1m is the seed resolution; host desks may open on a coarser preset (defaultTimeframe — 3m default).
  // Aggregation is client-side from the same 1m bars.
  const [timeframe, setTimeframe] = useState<VectorTimeframeMinutes>(initialTimeframe);
  const [chartReady, setChartReady] = useState(false);

  useEffect(() => {
    if (!chartReady || !compareSync?.linkCrosshair) return;
    const payload = compareSync.crosshair;
    if (!payload || payload.sourceId === compareSync.paneId) return;

    const chart = chartRef.current;
    const series = seriesRef.current;
    if (!chart || !series) return;

    applyingExternalCrosshairRef.current = true;
    try {
      if (payload.timeSec == null) {
        chart.clearCrosshairPosition();
        setCrosshair(null);
        return;
      }
      const price = barCloseAtOrBeforeTime(minuteBarsRef.current, payload.timeSec);
      if (price != null && Number.isFinite(price)) {
        chart.setCrosshairPosition(price, payload.timeSec as UTCTimestamp, series);
      }
    } finally {
      applyingExternalCrosshairRef.current = false;
    }
  }, [
    chartReady,
    compareSync?.linkCrosshair,
    compareSync?.paneId,
    compareSync?.crosshair?.tick,
    compareSync?.crosshair?.timeSec,
    compareSync?.crosshair?.sourceId,
  ]);

  useEffect(() => {
    if (!chartReady || !compareSync?.linkZoom) return;
    const payload = compareSync.visibleRange;
    if (!payload || payload.sourceId === compareSync.paneId) return;

    const chart = chartRef.current;
    if (!chart) return;

    applyingExternalRangeRef.current = true;
    try {
      chart.timeScale().setVisibleRange({ from: payload.fromSec as UTCTimestamp, to: payload.toSec as UTCTimestamp });
    } finally {
      applyingExternalRangeRef.current = false;
    }
  }, [
    chartReady,
    compareSync?.linkZoom,
    compareSync?.paneId,
    compareSync?.visibleRange?.tick,
    compareSync?.visibleRange?.fromSec,
    compareSync?.visibleRange?.toSec,
    compareSync?.visibleRange?.sourceId,
  ]);
  // Enabled indicators — dealer gamma positioning (`gex-heatmap`) defaults on.
  const [indicators, setIndicators] = useState<Set<VectorIndicatorId>>(() => new Set(initialIndicators));
  // Opening-range window preset (5m/15m/30m/60m), default 15m — unchanged behavior for anyone who
  // hasn't touched the new control (2026-08-05 audit finding #7).
  const [openingRangeMinutes, setOpeningRangeMinutes] = useState<VectorOpeningRangeMinutes>(
    DEFAULT_OPENING_RANGE_MINUTES
  );
  // Count of bars currently shown (at the active timeframe). Drives the indicator menu's
  // "not enough bars" annotation so an MA family that can't compute at this timeframe is explained
  // rather than looking broken. Updated imperatively from paintOverlays; setState bails out when
  // the count is unchanged, so this re-renders at most once per new bar / timeframe switch.
  const [displayBarCount, setDisplayBarCount] = useState<number>(initialBars.length);

  useEffect(() => {
    // Replay honesty for the structure feed: while scrubbed to 9:35 the ticker
    // must not display events that happened at 11:00 — filter to the cursor.
    // Events keep accumulating in state (the SSE stays open in replay); only
    // what consumers SEE is cursor-gated. cursorIndex is a dep so the feed
    // advances as the member scrubs/plays.
    if (replayMode) {
      const cursor = timelineRef.current[cursorIndex] ?? 0;
      onWallEventsChange?.(wallEvents.filter((e) => e.time <= cursor));
      return;
    }
    onWallEventsChange?.(wallEvents);
  }, [wallEvents, onWallEventsChange, replayMode, cursorIndex]);

  useEffect(() => {
    onLensChange?.(lens);
  }, [lens, onLensChange]);

  useEffect(() => {
    setWallEvents(
      appendVectorWallEvents(eventsFromWallHistory(initialWallHistory, "gex"), [
        ...eventsFromWallHistory(initialWallHistory, "vex"),
      ])
    );
  }, [ticker, initialWallHistory]);

  useEffect(() => {
    timeframeRef.current = timeframe;
  }, [timeframe]);

  useEffect(() => {
    lensRef.current = lens;
  }, [lens]);

  useEffect(() => {
    liveSessionRef.current = liveSession;
  }, [liveSession]);

  useEffect(() => {
    replayModeRef.current = replayMode;
  }, [replayMode]);

  useEffect(() => {
    cursorIndexRef.current = cursorIndex;
  }, [cursorIndex]);

  // PULSE → CHART ANCHOR (2026-07-26): flash a transient labeled price-line when a host desk's Pulse
  // rail asks to anchor an event level. Keyed on `focusLevel?.seq` so re-clicking the SAME level
  // re-fires (the {price,label,tone} object is otherwise referentially stable-ish and wouldn't).
  // Deliberately does NOT scroll/zoom or touch autoscale — event levels on a 0DTE SPX chart sit near
  // spot and the axis already spans the walls, so a brief highlight is the whole deliverable; a jump
  // would fight the member's pan. The line removes itself after ~3s so it reads as a cue, not clutter.
  useEffect(() => {
    const series = seriesRef.current;
    if (!series || !focusLevel || !Number.isFinite(focusLevel.price)) return;
    // Clear any still-showing prior focus line + its pending fade before drawing the new one, so a
    // rapid second click doesn't leak a line or let an old timer wipe the fresh one early.
    if (focusTimeoutRef.current) {
      clearTimeout(focusTimeoutRef.current);
      focusTimeoutRef.current = null;
    }
    if (focusLineRef.current) {
      series.removePriceLine(focusLineRef.current);
      focusLineRef.current = null;
    }
    const color =
      focusLevel.tone === "bull"
        ? "#a3e635"
        : focusLevel.tone === "bear"
          ? "#ff2d55"
          : focusLevel.tone === "warn"
            ? "#ff8a3d"
            : "#38bdf8"; // info / anything else
    focusLineRef.current = series.createPriceLine({
      price: focusLevel.price,
      color,
      lineWidth: 2 as const,
      lineStyle: LineStyle.Solid,
      axisLabelVisible: true,
      title: `⚡ ${focusLevel.label}`,
    });
    focusTimeoutRef.current = setTimeout(() => {
      if (focusLineRef.current) {
        series.removePriceLine(focusLineRef.current);
        focusLineRef.current = null;
      }
      focusTimeoutRef.current = null;
    }, 3000);
    return () => {
      // Cleanup on unmount / next fire: drop the timer and the line so nothing lingers on a dead series.
      if (focusTimeoutRef.current) {
        clearTimeout(focusTimeoutRef.current);
        focusTimeoutRef.current = null;
      }
      if (focusLineRef.current) {
        series.removePriceLine(focusLineRef.current);
        focusLineRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusLevel?.seq]);

  // PLAYS ON THE CHART (2026-07-26): reconcile the member's ACTIVE SPX play into a dedicated set of
  // labeled price-lines. Mirrors the applyLevelLines / applyConfluenceBand reconcile idiom — add or
  // update one line per kind, remove kinds no longer present — but against its OWN map so it never
  // touches any other overlay. Keyed on the resolved lines' JSON signature so it repaints only when
  // a level actually changes (not on every unrelated render). `state:"none"` / undefined → empty
  // desired set → all lines removed, so /vector (which never passes the prop) is byte-identical.
  const playLinesSig = JSON.stringify(
    playLevelLines(playLevels ?? { state: "none", direction: null, entry: null, stop: null, target: null, invalidation: null })
  );
  useEffect(() => {
    const series = seriesRef.current;
    if (!series) return;
    const map = playLineRef.current;
    const desired = playLevelLines(
      playLevels ?? { state: "none", direction: null, entry: null, stop: null, target: null, invalidation: null }
    );
    const desiredByKind = new Map(desired.map((l) => [l.kind, l]));
    // Remove lines whose kind is no longer wanted (play closed, level dropped, or state → none).
    for (const [kind, pl] of map) {
      if (!desiredByKind.has(kind)) {
        series.removePriceLine(pl);
        map.delete(kind);
      }
    }
    // Add / update one line per desired kind.
    for (const [kind, line] of desiredByKind) {
      const opts = {
        price: line.price,
        color: line.color,
        lineWidth: line.width,
        lineStyle:
          line.style === "solid"
            ? LineStyle.Solid
            : line.style === "dashed"
              ? LineStyle.Dashed
              : LineStyle.Dotted,
        lineVisible: true,
        axisLabelVisible: true,
        title: line.label,
      };
      const existing = map.get(kind);
      if (existing) existing.applyOptions(opts);
      else map.set(kind, series.createPriceLine(opts));
    }
    // chartReady is REQUIRED here: this effect is declared before the chart-creation effect that
    // assigns seriesRef.current, so at first commit it runs before the series exists and bails on
    // `!series`. Without chartReady in the deps it would never re-run once the series is built —
    // and on a mid-session refresh the play is seeded synchronously from sessionStorage, so
    // playLinesSig is already its final (constant) value and never changes → the entry/stop/target
    // lines would silently never draw. Matches the other series-touching effects in this file.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playLinesSig, chartReady]);

  // Clear ALL play-lines on unmount so nothing lingers on a disposed series (the series itself is
  // removed by the chart teardown, but drop our refs too and stay symmetric with the other overlays).
  // `map` is captured here (the ref's Map identity is stable for the component's life) so the cleanup
  // reads a local, not `playLineRef.current` — avoids the stale-ref-in-cleanup lint.
  useEffect(() => {
    const map = playLineRef.current;
    return () => {
      const series = seriesRef.current;
      for (const pl of map.values()) series?.removePriceLine(pl);
      map.clear();
    };
  }, []);

  const refreshTrails = useCallback((activeLens: VectorWallLens) => {
    const series = seriesRef.current;
    if (!series) return;
    const v = lensVisuals(activeLens);
    // NARROWED DTE HORIZON (0DTE/weekly/monthly) — two sources, in precedence order:
    //   1. horizonHistoryRef: the RECORDED per-horizon trail (composite-keyed rail, PR #186),
    //      fetched by the DTE effect. This is the full point-in-time cluster history for the
    //      horizon — the after-close analogue of the blended "All" rail — so weekly/monthly show
    //      accumulated frozen clusters, not a single column (member ask). Merged with (2) so the
    //      newest live structure paints even before the 5-min recorder writes the current bucket.
    //   2. narrowedHorizonTrail: the CURRENT horizon-scoped walls (fetched into horizonWallsRef by
    //      the DTE effect, refreshed each 15s in RTH) as ONE column at the latest bar — the honest
    //      "current 0DTE/weekly/monthly structure", used alone before any history is recorded.
    // Both are null/empty for All / VEX / empty-scope, in which case we draw the blended rail as
    // before (member finding "select 0DTE, still shows All's walls" is still fixed either way).
    const lastBarTime = minuteBarsRef.current[minuteBarsRef.current.length - 1]?.time ?? 0;
    const horizon = dteHorizonRef.current;
    const beadRowCap = wallCountForHorizon(timeframeRef.current, horizon);
    const currentColumn = narrowedHorizonTrail(
      horizon,
      activeLens,
      horizonWallsRef.current,
      lastBarTime,
      horizonFlipRef.current
    );
    // Gate the recorded trail on horizon+lens here; composeHorizonTrail owns the merge precedence.
    const recordedTrail =
      (horizon !== "all" || seedRailEmptyRef.current) && activeLens === "gex"
        ? horizonHistoryRef.current
        : null;
    const sessionOverview = wantsSessionOverviewViewport(
      defaultChartViewportRef.current,
      liveFollowEnabledRef.current
    );
    const history: WallHistorySample[] =
      composeHorizonTrail(recordedTrail, currentColumn) ??
      (liveSessionRef.current && !replayModeRef.current && !sessionOverview
        ? trimHistoryForLiveTrails(
            wallHistoryRef.current,
            undefined,
            liveTrailAnchorSec(wallHistoryRef.current, minuteBarsRef.current.map((b) => b.time))
          )
        : wallHistoryRef.current);
    const liveBeads = liveSessionRef.current && !replayModeRef.current;
    const pinLiveAnchorBeads = liveFollowEnabledRef.current;
    const trailBucketSec = wallTrailSecRef.current;
    const beadProfile: WallBeadRenderProfile = compareCompactBeadsRef.current ? "compare" : "default";
    const call = applyWallBeadMarkers(
      callBeadsRef.current,
      history,
      "callWalls",
      v.callColor,
      activeLens,
      timeframeRef.current,
      lastBarTime,
      liveBeads,
      beadRowCap,
      pinLiveAnchorBeads,
      trailBucketSec,
      spotRef.current,
      compareCompactBeadsRef.current
    );
    const put = applyWallBeadMarkers(
      putBeadsRef.current,
      history,
      "putWalls",
      v.putColor,
      activeLens,
      timeframeRef.current,
      lastBarTime,
      liveBeads,
      beadRowCap,
      pinLiveAnchorBeads,
      trailBucketSec,
      spotRef.current,
      compareCompactBeadsRef.current
    );
    // Feed the ribbon rail the SAME composed call+put trails (both sides share one frame reference).
    feedWallRail(
      wallRailPrimitiveRef.current,
      call.rendered,
      put.rendered,
      v.callColor,
      v.putColor,
      true,
      beadProfile
    );
    // Record what was actually drawn so the autoscale provider widens to reveal these exact beads
    // at every zoom level, then nudge a rescale (off-hours there is no tick to trigger it).
    beadStrikesRef.current = { call: call.strikes, put: put.strikes };
    // Respect a manual vertical zoom — only nudge autoscale when the member hasn't taken the
    // price axis over AND hasn't scrolled within the cooldown window.
    if (
      !memberViewportLocked(chartUserPannedRef.current, wheelZoomCooldownRef.current)
    ) {
      reassertPriceAutoScale(series.priceScale());
    }
    pinCandlesOnTop(series);
  }, [ticker]);

  const refreshOverlays = useCallback(
    (
      activeLens: VectorWallLens,
      gexWalls: VectorWalls | null,
      vexWalls: VectorWalls | null,
      gammaFlip: number | null,
      vexFlip: number | null,
      dp: VectorDarkPoolLevel[]
    ) => {
      const series = seriesRef.current;
      if (!series) return;
      const walls = wallsForActiveLens(activeLens, gexWalls, vexWalls);
      const flip = flipForActiveLens(activeLens, gammaFlip, vexFlip);
      const v = lensVisuals(activeLens);
      // How many wall guides/beads THIS timeframe shows (1m→6 … 15m→12). Higher timeframe →
      // more, further-out walls drawn → wider axis (extendRangeForWalls keys off these SHOWN
      // strikes below, so 1m stays tight while 15m widens).
      const maxGuides = wallCountForHorizon(timeframeRef.current, dteHorizonRef.current);
      // Walls are shown ONLY as strength-scaled beads now (the Skylit-clean look) — clear any
      // wall guide price-lines rather than drawing them, so the price axis is not stacked with
      // "Call/Put wall — %" labels. The gamma-flip line stays (member kept it); dark-pool level
      // lines are removed from the axis too. rangeWallsRef below still keys off the walls, so the
      // axis keeps auto-widening to reveal the bead rows.
      applyWallsToSeries(series, callGuideRefs, putGuideRefs, EMPTY_WALLS, activeLens, 0);
      applyFlipGuide(series, flipGuideRef, flip, v.flipLabel, v.flipColor);
      // Dealer-gamma REGIME boundary glow — spatialize the long-γ (calm, above the flip) vs short-γ
      // (unstable, below the flip) regime on the price pane. Fed the ACTIVE-lens flip (same one the
      // flip guide draws) + live spot; the primitive brightens whichever side spot sits in. Cached
      // to regimeFlipRef so a bare toggle-on (paintOverlays) can re-push without a live tick. Gated
      // on the toggle → a no-op (draws nothing) until the member opts in; null flip draws nothing.
      regimeFlipRef.current = flip;
      gammaRegimePrimitiveRef.current?.setData({
        flip,
        spot: spotRef.current,
        enabled: indicatorsRef.current.has("gamma-regime"),
      });
      // King anchors: solid lines at the dominant call/put wall of the ACTIVE (horizon-scoped) walls,
      // so the anchor re-scopes with the DTE toggle. Timeframe-aware too: the band widens with the
      // candle interval (anchorBandPctForTimeframe), so a tight 1m view anchors to the nearest strong
      // wall and a wide 4h view lets a bigger further-out wall become the anchor. Redraws in replay.
      // King anchor price-lines REMOVED (user-directed, 2026-07-13): the solid full-width
      // yellow/purple horizontal lines at the dominant call/put strikes cluttered the chart —
      // the bead rail already shows exactly where the king walls sit (fattest beads), so the
      // anchors were redundant ink. applyKingAnchor with null clears any line a live chart
      // still holds from before this deploy.
      applyKingAnchor(series, kingCallLineRef, null, v.callColor);
      applyKingAnchor(series, kingPutLineRef, null, v.putColor);
      applyDarkPoolGuides(series, dpGuideRefs, []);
      void dp; // dark-pool level lines intentionally not drawn (clean axis); kept in the signature
      //         so callers/consumers of dp elsewhere are unaffected.
      // Feed the just-drawn strikes to the autoscale provider and nudge a rescale, so
      // the axis widens to reveal support/resistance walls the moment the lens/horizon
      // changes (off-hours there's no tick to trigger the recompute otherwise). Sliced to the
      // SHOWN count so the axis only widens for walls actually on screen — a 1m chart drawing 6
      // walls must not be stretched by the 7th–12th walls that only a higher timeframe reveals.
      rangeWallsRef.current = {
        call: (walls?.callWalls ?? []).slice(0, maxGuides).map((w) => w.strike),
        put: (walls?.putWalls ?? []).slice(0, maxGuides).map((w) => w.strike),
      };
      // Same guard as refreshTrails: a live tick re-running this must not override the member's
      // manual price-axis zoom or a recent scroll zoom (the split-second "zooms out" bug).
      if (Date.now() - wheelZoomCooldownRef.current >= 8_000) {
        reassertPriceAutoScale(series.priceScale());
      }
    },
    []
  );

  /**
   * Draw/refresh the enabled technical overlays against the CURRENTLY-shown bars. Called after every
   * applyDisplayBars (tick, timeframe, replay, seed) so the lines track the same aggregated bars the
   * candles use, and by the indicator-toggle effect so enabling/disabling repaints immediately.
   * One line series per enabled indicator, created lazily and removed the moment it's toggled off —
   * nothing is drawn while the (default-empty) enabled set is empty. Values are computed 1:1 with
   * the bars and the null warm-up region is dropped so lines simply start once defined.
   */
  const paintOverlays = useCallback((bars: VectorBar[]) => {
    const chart = chartRef.current;
    if (!chart || !seriesRef.current) return;
    lastDisplayBarsRef.current = bars;
    setDisplayBarCount(bars.length); // menu availability follows the shown-bar count (no-op if unchanged)
    const enabled = indicatorsRef.current;
    const map = overlaySeriesRef.current;
    const closes = bars.map((b) => b.close);

    for (const def of VECTOR_OVERLAYS) {
      const existing = map.get(def.id) ?? null;
      // Gated by the family toggle, not the individual line: enabling "EMA" draws every EMA line.
      if (!enabled.has(def.family)) {
        if (existing) {
          chart.removeSeries(existing);
          map.delete(def.id);
        }
        continue;
      }
      const values =
        def.kind === "vwap"
          ? vwapSeries(bars)
          : def.kind === "ema"
            ? emaSeries(closes, def.period ?? 0)
            : smaSeries(closes, def.period ?? 0);
      const data: { time: Time; value: number }[] = [];
      for (let i = 0; i < bars.length; i++) {
        const v = values[i];
        if (v != null) data.push({ time: bars[i]!.time, value: v });
      }
      let line = existing;
      if (!line) {
        line = chart.addSeries(LineSeries, {
          color: def.color,
          lineWidth: 2,
          priceLineVisible: false,
          // Labeled + a live value on the axis (2026-08-05 audit finding): with up to 6 MA lines
          // potentially on screen at once, the toggle menu's color dot was the ONLY way to tell
          // which line was which — no on-chart identification at all. `title` puts the indicator's
          // own name (e.g. "EMA 21") next to its live value tag, matching how every other charting
          // platform labels overlapping moving averages.
          lastValueVisible: true,
          crosshairMarkerVisible: true,
          title: def.label,
        });
        map.set(def.id, line);
      }
      line.setData(data);
    }

    // Draw the enabled "Key levels" horizontal lines from the SAME bars, on the candle series.
    if (seriesRef.current) {
      applyLevelLines(
        seriesRef.current,
        levelLinesRef.current,
        enabled,
        bars,
        priorDayRef.current,
        openingRangeMinutesRef.current
      );
      // Market-structure markers (HH/HL labels + BOS/CHOCH flags) on their own markers instance —
      // separate from the two bead instances, so beads and structure never clobber each other.
      // Recomputed from the SAME displayed bars, so the structure re-detects per timeframe and, in
      // replay, reflects only the bars up to the cursor (no future pivots leak into a scrub).
      if (structureMarkersRef.current) {
        structureMarkersRef.current.setMarkers(
          enabled.has("market-structure")
            ? buildStructureMarkers(bars, 3).map((m) => ({
                time: m.time as Time,
                position: m.position,
                color: m.color,
                shape: m.shape,
                text: m.text,
                size: m.size,
              }))
            : []
        );
      }
      // Options-flow markers — one arrow per notable LARGE print at its strike (price axis) + trade
      // time (time axis): calls green ↑, puts red ↓, size scaled by premium. Drawn from the last
      // horizon-scoped fetch (flowPrintsRef, populated by the flow effect) so they track the SAME
      // bars/timeframe as everything else and clear the instant the toggle goes off. The markers sit
      // at exact trade times (atPriceMiddle + price), so they don't need to align to a bar boundary —
      // lightweight-charts snaps them onto the axis, matching how the wall beads use sample times.
      if (flowMarkersRef.current) {
        flowMarkersRef.current.setMarkers(
          enabled.has("flow-markers")
            ? buildFlowMarkers(flowPrintsRef.current, flowMinPremiumRef.current).map((m) => ({
                time: m.time as Time,
                position: m.position,
                price: m.price,
                color: m.color,
                shape: m.shape,
                text: m.text,
                size: m.size,
              }))
            : []
        );
      }
      // Expected-move band (#15 cone, slice 3b) — dashed ±1σ/2σ price-lines from the last horizon
      // fetch (expectedMoveBandsRef), gated on the "expected-move" toggle. Idempotent (sig ref) so the
      // frequent tick-repaints don't churn the lines; cleared when the toggle is off / no real band.
      if (seriesRef.current) {
        applyExpectedMoveBand(
          seriesRef.current,
          emBandLinesRef,
          emBandSigRef,
          expectedMoveBandsRef.current,
          enabled.has("expected-move")
        );
        // EOD pin projection (SPX desk only) — always on for SPX (no toggle); the fetch effect
        // only populates pinProjRef when ticker === "SPX", so it's inert elsewhere.
        applyPinProjection(seriesRef.current, pinLinesRef, pinSigRef, pinProjRef.current, ticker === "SPX");
        // EOD pin CONE — the MC p10/p50/p90 close distribution as a converging curve in the right
        // margin (now → 16:00). Projected off the LAST shown bar's time, so the funnel starts at
        // "now" and narrows onto the pin. SPX-only; a null cone or non-SPX draws nothing.
        pinConePrimitiveRef.current?.setData(
          pinConeRef.current,
          bars.length ? (bars[bars.length - 1]!.time as Time) : null,
          ticker === "SPX"
        );
        // TIME-CONVERGING EXPECTED-MOVE CONE (default OFF) — the honest "remaining move" companion to
        // the flat band above. Built from the SAME expected-move band + the live spot, funnelling
        // from "now" to the 16:00 close. "Now" is the latest bar's ET minute-of-day (the same anchor
        // the pin cone projects off, so both funnels start at the same x). Additive: the flat-band
        // path above is untouched, so a member can run either or both.
        //
        // Gated on THREE conditions (compute skipped entirely when off — no 32-sample build):
        //  1. the opt-in toggle;
        //  2. 0DTE horizon ONLY — "converge to spot at 16:00 today" is only correct when the front
        //     expiry IS today; on a later horizon the chain's move isn't a today-close budget;
        //  3. a live RTH session — off-hours the last bar's ET minute is a stale pre-close sliver
        //     (belt-and-suspenders with the geometry's own `nowEtMin >= 960 → null`).
        const coneEnabled =
          enabled.has("expected-move-cone") &&
          dteHorizonRef.current === "0dte" &&
          liveSessionRef.current;
        const lastBar = bars.length ? bars[bars.length - 1]! : null;
        const nowEtMin =
          coneEnabled && lastBar && Number.isFinite(lastBar.time as number)
            ? etMinutesOfDay((lastBar.time as number) * 1000)
            : null;
        const emCone =
          nowEtMin != null
            ? emConeFromExpectedMove(expectedMoveBandsRef.current, spotRef.current, nowEtMin)
            : null;
        emConePrimitiveRef.current?.setData(
          emCone,
          lastBar ? (lastBar.time as Time) : null,
          coneEnabled
        );
      }
      // GEX positioning heatmap (#14) — push the last horizon-scoped grid + toggle state to the
      // background primitive (attached at zOrder "bottom", so candles/walls stay readable on top).
      // Cheap: the primitive just stores refs and requests a redraw; a null grid or the toggle off
      // draws nothing. This lives in paintOverlays so a toggle flip (which repaints here via the
      // indicators effect) shows/hides the surface instantly; the fetch pushes fresh data directly.
      gexHeatmapPrimitiveRef.current?.setData(gexHeatmapGridRef.current, enabled.has("gex-heatmap"));
      // Dealer-gamma regime glow — same toggle-repaint path as the heatmap: re-push the last cached
      // active-lens flip + live spot so flipping "gamma-regime" on/off shows/hides the glow instantly
      // (live flip/spot updates come through refreshOverlays on each tick). No-op when off.
      gammaRegimePrimitiveRef.current?.setData({
        flip: regimeFlipRef.current,
        spot: spotRef.current,
        enabled: enabled.has("gamma-regime"),
      });
      // Session volume profile (P2 #4) — recompute from the raw 1m session bars (not the
      // display-timeframe-aggregated `bars`, so a coarser candle interval doesn't thin the price
      // resolution) whenever this paint runs (tick, timeframe switch, toggle). Cheap: a session's
      // worth of 1m bars is at most ~390 rows.
      const volumeProfileOn = enabled.has("volume-profile");
      volumeProfilePrimitiveRef.current?.setData(
        volumeProfileOn ? computeVolumeProfile(minuteBarsRef.current) : null,
        volumeProfileOn
      );
    }

    // Oscillator sub-panes (RSI / MACD) in their OWN panes below price. The pane LAYOUT is rebuilt
    // only when the enabled-oscillator set changes (toggling on/off), assigning panes 1..N in a
    // fixed order so there's never an empty pane; the series DATA refreshes every paint. Drawing
    // nothing when the study can't compute (too few bars) is honest — the pane just stays empty.
    if (chart) paintOscillators(chart, enabled, bars, closes);

    // ALWAYS-ON technicals narration for the terminal — computed here (every paint: tick, timeframe,
    // replay frame, toggle) from the SHOWN bars, INDEPENDENT of the enabled-overlay set, so the desk
    // terminal keeps reading VWAP/EMA/RSI/MACD/pocket/structure even when nothing is toggled on the
    // chart. Deduped so an unchanged read is not re-emitted.
    const summary = summarizeTechnicals(bars, spotRef.current);
    technicalsForPlayRef.current = playTechnicalsFromSummary(summary);
    const techCb = onTechnicalsChangeRef.current;
    if (techCb) {
      const lines = technicalsCalloutLines(summary);
      const key = lines.map((l) => l.text).join("|");
      if (key !== lastTechnicalsRef.current) {
        lastTechnicalsRef.current = key;
        techCb(lines);
      }
    }
  }, []);

  // Rebuild oscillator panes when the enabled set changes; always refresh their data. Kept a plain
  // function (not a hook) because it's only called from inside the stable paintOverlays.
  function paintOscillators(
    chart: IChartApi,
    enabled: Set<VectorIndicatorId>,
    bars: VectorBar[],
    closes: number[]
  ) {
    const oscMap = oscillatorSeriesRef.current;
    const hideVolume = hideVolumePaneRef.current;
    const oscPaneStart = hideVolume ? 1 : VOLUME_PANE_INDEX + 1;
    // Fixed order → contiguous pane indices (0 = price; 1 = volume when shown; else oscillators at 1+).
    const active = (["rsi", "macd"] as const).filter((id) => enabled.has(id));
    const key = active.join(",");
    if (key !== lastOscKeyRef.current) {
      for (const s of oscMap.values()) chart.removeSeries(s);
      oscMap.clear();
      active.forEach((id, i) => {
        const pane = i + oscPaneStart;
        if (id === "rsi") {
          // `title` labels the pane's live value tag (2026-08-05 audit finding): an unlabeled
          // number in an unlabeled sub-pane gave no clue it was RSI without opening the toggle menu.
          const line = chart.addSeries(LineSeries, { color: "#c084fc", lineWidth: 2, priceLineVisible: false, lastValueVisible: true, title: "RSI (14)" }, pane);
          // 30/70 oversold/overbought guides + the 50 midline, drawn on the RSI series itself.
          for (const [lvl, style] of [[70, LineStyle.Dashed], [50, LineStyle.Dotted], [30, LineStyle.Dashed]] as const) {
            line.createPriceLine({ price: lvl, color: withAlpha("#c084fc", 0.4), lineWidth: 1, lineStyle: style, axisLabelVisible: true, title: String(lvl) });
          }
          oscMap.set("rsi", line);
        } else {
          // MACD pane: histogram (behind) + macd line + signal line — both lines titled + valued
          // (2026-08-05 audit finding fixed the macd/signal `lastValueVisible` inconsistency: the
          // signal line previously showed no value at all while the macd line did).
          oscMap.set("macd-hist", chart.addSeries(HistogramSeries, { priceLineVisible: false, lastValueVisible: false }, pane));
          oscMap.set("macd", chart.addSeries(LineSeries, { color: "#38bdf8", lineWidth: 2, priceLineVisible: false, lastValueVisible: true, title: "MACD" }, pane));
          oscMap.set("macd-signal", chart.addSeries(LineSeries, { color: "#f59e0b", lineWidth: 1, priceLineVisible: false, lastValueVisible: true, title: "Signal" }, pane));
        }
      });
      lastOscKeyRef.current = key;
      // New oscillator panes start at the default stretch of 1 — reassert the layout so price stays
      // dominant and the volume strip (when present) keeps its height as oscillators come and go.
      applyPaneStretch(chart, hideVolume);
    }
    if (!active.length) return;
    if (active.includes("rsi")) {
      const rsi = rsiSeries(closes, 14);
      const data: { time: Time; value: number }[] = [];
      for (let i = 0; i < bars.length; i++) if (rsi[i] != null) data.push({ time: bars[i]!.time, value: rsi[i] as number });
      (oscMap.get("rsi") as ISeriesApi<"Line"> | undefined)?.setData(data);
    }
    if (active.includes("macd")) {
      const m = macdSeries(closes, 12, 26, 9);
      const line: { time: Time; value: number }[] = [];
      const sig: { time: Time; value: number }[] = [];
      const hist: { time: Time; value: number; color: string }[] = [];
      for (let i = 0; i < bars.length; i++) {
        const t = bars[i]!.time;
        if (m[i]!.macd != null) line.push({ time: t, value: m[i]!.macd as number });
        if (m[i]!.signal != null) sig.push({ time: t, value: m[i]!.signal as number });
        if (m[i]!.histogram != null) {
          const h = m[i]!.histogram as number;
          hist.push({ time: t, value: h, color: withAlpha(h >= 0 ? "#34d399" : "#f87171", 0.6) });
        }
      }
      (oscMap.get("macd-hist") as ISeriesApi<"Histogram"> | undefined)?.setData(hist);
      (oscMap.get("macd") as ISeriesApi<"Line"> | undefined)?.setData(line);
      (oscMap.get("macd-signal") as ISeriesApi<"Line"> | undefined)?.setData(sig);
    }
  }

  // Sync the enabled-indicator set to the ref the imperative paint reads, and repaint immediately
  // against the currently-shown bars so toggling an indicator is instant (no wait for the next
  // tick/timeframe change). paintOverlays is stable, so this runs only when the selection changes.
  useEffect(() => {
    indicatorsRef.current = indicators;
    paintOverlays(lastDisplayBarsRef.current);
  }, [indicators, paintOverlays]);

  // Same sync-then-repaint idiom for the opening-range window preset: picking a new window must
  // redraw the OR lines immediately, without waiting for the next tick/timeframe change.
  useEffect(() => {
    openingRangeMinutesRef.current = openingRangeMinutes;
    paintOverlays(lastDisplayBarsRef.current);
  }, [openingRangeMinutes, paintOverlays]);

  // Lazy prior-day OHLC fetch: only when a prior-day/pivot level is enabled, and only once per
  // ticker. The PDH/PDL/PDC + floor-pivot lines need the prior session's high/low/close, which the
  // session bars don't carry. On success, repaint so the lines appear without waiting for a tick.
  // `anchor=sessionYmd` pins "prior day" to the session the chart is DISPLAYING: off-hours the
  // latest seeded session is (say) Friday while the wall clock says Sat/Sun/Mon-pre-open, and an
  // unanchored fetch returned Friday's own H/L/C — PDH/PDL drawn on the displayed session's own
  // extremes, pivots computed from the very session being viewed. During RTH anchor == today.
  useEffect(() => {
    const needsPrior = VECTOR_LEVELS.some((l) => l.needsPriorDay && indicators.has(l.id));
    if (!needsPrior || (priorDayTickerRef.current === ticker && priorDayRef.current)) return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(
          `/api/market/vector/prior-day?ticker=${encodeURIComponent(ticker)}` +
            `&anchor=${encodeURIComponent(sessionYmd)}`
        );
        if (cancelled || !res.ok) return;
        const d = (await res.json()) as { pdh: number | null; pdl: number | null; pdc: number | null };
        if (cancelled) return;
        priorDayRef.current =
          d.pdh != null && d.pdl != null && d.pdc != null
            ? { pdh: d.pdh, pdl: d.pdl, pdc: d.pdc }
            : null;
        priorDayTickerRef.current = ticker;
        paintOverlays(lastDisplayBarsRef.current);
      } catch {
        /* best-effort — the prior-day/pivot lines simply don't draw if the fetch fails */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [indicators, ticker, sessionYmd, paintOverlays]);

  // Lazy options-flow fetch: ONLY when the "Options flow" toggle is enabled (the underlying pull is a
  // bounded Massive/Polygon per-OCC trades fan-out — don't spend it on members who never opt in). Re-
  // fetches on ticker / DTE-horizon change, and on a slow poll while the session is live so fresh
  // prints appear. Scoped to the SAME horizon the walls use so flow and walls describe one expiry set.
  // On success the prints land in flowPrintsRef and we repaint; toggling off clears them and repaints.
  useEffect(() => {
    const enabled = indicators.has("flow-markers");
    if (!enabled) {
      // Cleared → drop any prints and repaint so the markers disappear immediately (not on next tick).
      if (flowPrintsRef.current.length) {
        flowPrintsRef.current = [];
        paintOverlays(lastDisplayBarsRef.current);
      }
      return;
    }
    let cancelled = false;
    const fetchFlow = async () => {
      try {
        const res = await fetch(
          `/api/market/vector/flow?ticker=${encodeURIComponent(ticker)}&dte=${dteHorizon}`
        );
        if (cancelled || !res.ok) return;
        const data = (await res.json()) as {
          prints?: FlowPrint[];
          meta?: { minPremium?: number; truncated?: number };
        };
        if (cancelled) return;
        flowPrintsRef.current = Array.isArray(data.prints) ? data.prints : [];
        flowMinPremiumRef.current = data.meta?.minPremium ?? 0;
        // NO silent truncation: when the server dropped large prints past the display cap, say so
        // once (deduped) — the member is seeing the top N by premium, not every large print.
        const truncated = data.meta?.truncated ?? 0;
        if (truncated > 0 && truncated !== lastFlowTruncatedRef.current) {
          console.info(
            `[vector] options-flow markers capped: showing top ${flowPrintsRef.current.length} by premium (max ${DEFAULT_FLOW_MAX_MARKERS}); ${truncated} additional large print(s) not drawn.`
          );
        }
        lastFlowTruncatedRef.current = truncated;
        paintOverlays(lastDisplayBarsRef.current);
      } catch {
        /* best-effort — the flow markers simply don't draw if the fetch fails (honest empty) */
      }
    };
    void fetchFlow();
    // Live: refresh flow data every 15s. Off-hours a single fetch is enough (static tape).
    const id = liveSession ? setInterval(fetchFlow, 15_000) : null;
    return () => {
      cancelled = true;
      if (id) clearInterval(id);
    };
  }, [indicators, ticker, dteHorizon, liveSession, paintOverlays]);

  // EOD PIN projection (SPX desk only) — fetch the 0DTE projected close + band and draw it on the
  // price chart (solid gold line + dashed band edges). Gated to ticker === "SPX", so /vector and any
  // other ticker never fetch or draw it. Polls at the desk cadence (5s) during a live session; a
  // single fetch off-hours. Best-effort: a failed fetch keeps the last-drawn line rather than
  // blanking it. Draws via paintOverlays → applyPinProjection (idempotent sig ref).
  useEffect(() => {
    if (ticker !== "SPX") return;
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch("/api/market/spx/pin", { cache: "no-store" });
        if (cancelled || !res.ok) return;
        const j = (await res.json()) as {
          pin?: unknown;
          projectedClose?: unknown;
          pinBand?: unknown;
          montecarlo?: { pin?: unknown; projectedClose?: unknown; pinBand?: unknown; cone?: unknown } | null;
        };
        if (cancelled) return;
        // Prefer the MONTE-CARLO projection on the chart (member-directed): its band is empirical, so
        // the on-chart line/band reflect the true (possibly asymmetric) distribution. Fall back to the
        // analytic base when the MC overlay is absent.
        // Use the UNSNAPPED projectedClose (not the snap-to-strike `pin`) so the on-chart pin tag
        // AGREES with the forecaster panel's headline and visibly drifts intraday instead of sitting
        // frozen on a round strike (the "7520 all day" report). Fall back to `pin` if absent.
        const mc = j.montecarlo ?? null;
        const rawPin =
          typeof mc?.projectedClose === "number" ? mc.projectedClose
          : typeof mc?.pin === "number" ? mc.pin
          : typeof j.projectedClose === "number" ? j.projectedClose
          : j.pin;
        const rawBand = Array.isArray(mc?.pinBand) ? mc!.pinBand : j.pinBand;
        const close = typeof rawPin === "number" && Number.isFinite(rawPin) ? rawPin : null;
        const band =
          Array.isArray(rawBand) &&
          rawBand.length === 2 &&
          rawBand.every((n) => typeof n === "number" && Number.isFinite(n))
            ? ([rawBand[0] as number, rawBand[1] as number] as [number, number])
            : null;
        pinProjRef.current = close != null ? { close, band } : null;
        // Parse the MC cone (p10/p50/p90 per time-step) for the on-chart converging curve. Only the
        // MC forecast carries a cone; validate each step is finite + ordered so a malformed payload
        // draws nothing rather than a broken funnel. Empty/absent → null (primitive draws nothing).
        const rawCone = Array.isArray(mc?.cone) ? mc!.cone : null;
        const cone: PinConeStep[] | null = rawCone
          ? (rawCone.filter(
              (s): s is PinConeStep =>
                !!s &&
                typeof s === "object" &&
                ["tMin", "p10", "p50", "p90"].every(
                  (k) => typeof (s as Record<string, unknown>)[k] === "number" && Number.isFinite((s as Record<string, unknown>)[k])
                )
            ) as PinConeStep[])
          : null;
        pinConeRef.current = cone && cone.length >= 2 ? cone : null;
        paintOverlays(lastDisplayBarsRef.current);
      } catch {
        // keep the last-drawn line on a transient blip
      }
    };
    void load();
    const id = liveSession ? setInterval(load, 5_000) : null;
    return () => {
      cancelled = true;
      if (id) clearInterval(id);
    };
  }, [ticker, liveSession, paintOverlays]);

  const toggleIndicator = useCallback((id: VectorIndicatorId) => {
    setIndicators((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);
  const clearIndicators = useCallback(() => setIndicators(new Set()), []);

  const applyFrame = useCallback(
    (cursorTime: number, bars: VectorBar[], history: WallHistorySample[], activeLens: VectorWallLens) => {
      const chart = chartRef.current;
      const series = seriesRef.current;
      if (!chart || !series) return;

      const visibleBars = displayBarsFromMinute(bars, timeframeRef.current, cursorTime);
      applyDisplayBars(series, volumeSeriesRef.current, visibleBars);
      paintOverlays(visibleBars);

      // Horizon-aware replay: when the member has narrowed the DTE (GEX lens) and that horizon
      // has a recorded trail, replay THAT horizon's beads forming point-in-time — not the blended
      // "All" rail the callsites pass. So hitting replay on 0DTE/weekly/monthly reconstructs how
      // that specific horizon's clusters built through the session, matching what the live toggle
      // now draws (#187). VEX / "all" / no-recorded-trail fall back to the passed blended history.
      // Unlike the live composeHorizonTrail there is NO current-column union — replay must never
      // draw structure newer than the cursor, and the recorded trail is already point-in-time.
      const sourceHistory = pickReplayTrailSource(
        dteHorizonRef.current,
        activeLens,
        horizonHistoryRef.current,
        history
      );

      const visibleHistory = sliceHistoryToTime(sourceHistory, cursorTime);
      const v = lensVisuals(activeLens);
      const trailBucketSec = wallTrailSecRef.current;
      const call = applyWallBeadMarkers(
        callBeadsRef.current,
        visibleHistory,
        "callWalls",
        v.callColor,
        activeLens,
        timeframeRef.current,
        cursorTime,
        false,
        wallCountForTimeframe(timeframeRef.current),
        true,
        trailBucketSec,
        spotRef.current,
        compareCompactBeadsRef.current
      );
      const put = applyWallBeadMarkers(
        putBeadsRef.current,
        visibleHistory,
        "putWalls",
        v.putColor,
        activeLens,
        timeframeRef.current,
        cursorTime,
        false,
        wallCountForTimeframe(timeframeRef.current),
        true,
        trailBucketSec,
        spotRef.current,
        compareCompactBeadsRef.current
      );
      // Feed the ribbon rail the point-in-time trails so replay scrubs the bands too, not just dots.
      feedWallRail(
        wallRailPrimitiveRef.current,
        call.rendered,
        put.rendered,
        v.callColor,
        v.putColor,
        true,
        compareCompactBeadsRef.current ? "compare" : "default"
      );
      // Same zoom-stability guarantee in replay: widen the axis for the beads this frame drew.
      beadStrikesRef.current = { call: call.strikes, put: put.strikes };
      pinCandlesOnTop(series);

      // initialWalls/etc are the page-load seed — a reasonable fallback only when the
      // session has genuinely recorded zero wall samples yet. Once history exists, a null
      // return from wallsAtReplayTime/flipAtReplayTime means cursorTime predates the
      // earliest sample; falling back to the seed would misattribute today's page-load-time
      // walls to that earlier point on the replay timeline (same bug shape as
      // wallsAtCrosshairTime above). Reads from sourceHistory so the flip line + wall guides
      // stay coherent with the horizon-scoped beads drawn above.
      const gexAt = sourceHistory.length > 0 ? wallsAtReplayTime(sourceHistory, cursorTime, "gex") : initialWalls;
      const vexAt = sourceHistory.length > 0 ? wallsAtReplayTime(sourceHistory, cursorTime, "vex") : initialVexWalls;
      const gammaAt = sourceHistory.length > 0 ? flipAtReplayTime(sourceHistory, cursorTime, "gex") : initialGammaFlip;
      const vexFlipAt = sourceHistory.length > 0 ? flipAtReplayTime(sourceHistory, cursorTime, "vex") : initialVexFlip;
      // Dark pool has no per-time history — darkPoolRef is TODAY's live ladder. Drawing
      // it on a historical frame mislabels live levels under the cursor timestamp
      // (walls/flip above are carefully time-honest; DP must not be the exception).
      refreshOverlays(activeLens, gexAt, vexAt, gammaAt, vexFlipAt, []);
    },
    [initialWalls, initialVexWalls, initialGammaFlip, initialVexFlip, refreshOverlays, paintOverlays]
  );

  const stopReplayTimer = useCallback(() => {
    if (replayTimerRef.current) {
      clearInterval(replayTimerRef.current);
      replayTimerRef.current = null;
    }
  }, []);

  // GEX walls to DRAW right now: the horizon-scoped fetch when the member has
  // narrowed the DTE, else the live stream walls. Replay/history paths bypass
  // this — they use the time-sliced recorded walls (which were recorded at the
  // full near-term scope), so the horizon override is a live-view concern only.
  const liveGexWalls = useCallback(
    (): VectorWalls | null =>
      pickHorizonScopedValue(dteHorizonRef.current, horizonWallsRef.current, gexWallsRef.current),
    []
  );

  // Gamma flip to DRAW right now — the horizon-scoped flip when the member has narrowed
  // the DTE (so the flip line re-scopes with the walls), else the live stream flip. Same
  // live-view-only scope as liveGexWalls: replay/history paths use time-sliced recorded flips.
  const liveGammaFlip = useCallback(
    (): number | null =>
      pickHorizonScopedValue(dteHorizonRef.current, horizonFlipRef.current, gammaFlipRef.current),
    []
  );

  // Compute the gamma regime from the current spot / flip / walls and emit it up to
  // the page banner. Uses the HORIZON-SCOPED view (liveGexWalls/liveGammaFlip) so the
  // banner describes exactly what the member is looking at: on "all" that's the near-
  // term stream, but when they narrow to 0DTE/weekly/monthly the regime read + flip
  // re-scope with the walls actually drawn on the chart. (User-requested coherence —
  // the terminal must adapt to the DTE selection, not narrate a different scope.)
  const emitRegime = useCallback(() => {
    if (!onRegimeChange) return;
    const walls = liveGexWalls();
    const regime = deriveVectorRegime({
      spot: spotRef.current,
      gammaFlip: liveGammaFlip(),
      topCallWall: walls?.callWalls?.[0]?.strike ?? null,
      topPutWall: walls?.putWalls?.[0]?.strike ?? null,
    });
    if (regime.read === lastRegimeReadRef.current) return;
    lastRegimeReadRef.current = regime.read;
    onRegimeChange(regime);
  }, [onRegimeChange, liveGexWalls, liveGammaFlip]);

  // Emit the nearest-wall proximity callout (dynamic desk-terminal pulse). Uses the
  // HORIZON-SCOPED walls + flip so "spot testing the 190 put wall" refers to the wall
  // the member's DTE selection actually surfaces — deduped by callout text so it only
  // fires when the actionable level actually changes.
  const emitProximity = useCallback(() => {
    if (!onProximityChange) return;
    const prox = deriveWallProximity({
      spot: spotRef.current,
      walls: liveGexWalls(),
      gammaFlip: liveGammaFlip(),
    });
    const key = prox ? `${prox.side}:${prox.strike}:${prox.nearness}` : "none";
    if (key === lastProximityRef.current) return;
    lastProximityRef.current = key;
    onProximityChange(prox);
  }, [onProximityChange, liveGexWalls, liveGammaFlip]);

  // Emit the gamma magnet (dealer-hedging center of mass) up to the desk terminal.
  // Regime posture drives the honest wording (pin in long gamma, pivot in short),
  // so it's derived here from the SAME horizon-scoped walls/flip as the regime banner
  // (liveGexWalls/liveGammaFlip) — the magnet's center of mass re-computes over the
  // walls the member's DTE selection surfaces. Deduped by the level+pull+posture key.
  const emitMagnet = useCallback(() => {
    if (!onMagnetChange) return;
    const walls = liveGexWalls();
    const regime = deriveVectorRegime({
      spot: spotRef.current,
      gammaFlip: liveGammaFlip(),
      topCallWall: walls?.callWalls?.[0]?.strike ?? null,
      topPutWall: walls?.putWalls?.[0]?.strike ?? null,
    });
    const magnet = deriveGammaMagnet({ spot: spotRef.current, walls, posture: regime.posture });
    const key = magnet ? `${magnet.strike}:${magnet.pull}:${magnet.posture}` : "none";
    if (key === lastMagnetRef.current) return;
    lastMagnetRef.current = key;
    onMagnetChange(magnet);
  }, [onMagnetChange, liveGexWalls, liveGammaFlip]);

  // Emit ranked CONFLUENCE zones (CTO#7) — stacks every level the chart already tracks (horizon-
  // scoped walls, flip, max pain, session HOD/LOD, auto-fib golden pocket, prior-day H/L) through
  // the pure confluenceZones engine and sends the top callouts to the desk terminal. Levels the
  // chart doesn't have yet (max pain pre-fetch, prior-day unfetched) simply don't contribute — the
  // zones are honest about what's known NOW and refine as data lands. Deduped by the callout key.
  // Gather every price level the chart currently tracks into the flat list the confluence engine
  // clusters. Shared by the terminal callouts (emitConfluence) AND the chart band (paintConfluence)
  // so the two can never disagree about what stacked where. Levels not yet known (max pain pre-fetch,
  // prior-day unfetched) simply don't contribute — the zones are honest about what's known NOW.
  const gatherConfluenceLevels = useCallback((spot: number): ConfluenceLevel[] => {
    const lvls: ConfluenceLevel[] = [];
    const walls = liveGexWalls();
    for (const w of walls?.callWalls?.slice(0, 3) ?? []) lvls.push({ price: w.strike, kind: "call-wall" });
    for (const w of walls?.putWalls?.slice(0, 3) ?? []) lvls.push({ price: w.strike, kind: "put-wall" });
    const flip = liveGammaFlip();
    if (flip != null) lvls.push({ price: flip, kind: "gamma-flip" });
    if (maxPainValueRef.current != null) lvls.push({ price: maxPainValueRef.current, kind: "max-pain" });
    const bars = lastDisplayBarsRef.current;
    const hl = sessionHodLod(bars);
    if (hl) lvls.push({ price: hl.hod, kind: "hod" }, { price: hl.lod, kind: "lod" });
    const swing = dominantSwing(bars, 3, spot > 0 ? spot * 0.0015 : 0);
    if (swing) {
      const gp = goldenPocket(swing);
      lvls.push({ price: gp.top, kind: "golden-pocket" }, { price: gp.bottom, kind: "golden-pocket" });
    }
    if (priorDayRef.current) {
      lvls.push({ price: priorDayRef.current.pdh, kind: "pdh" }, { price: priorDayRef.current.pdl, kind: "pdl" });
    }
    return lvls;
  }, [liveGexWalls, liveGammaFlip]);

  const emitConfluence = useCallback(() => {
    if (!onConfluenceChange) return;
    const spot = spotRef.current;
    if (!(spot && spot > 0)) return;
    const callouts = confluenceCallouts(confluenceZones(gatherConfluenceLevels(spot), spot).slice(0, 3), spot);
    const key = callouts.join("|") || "none";
    if (key === lastConfluenceRef.current) return;
    lastConfluenceRef.current = key;
    onConfluenceChange(callouts.length ? callouts : null);
  }, [onConfluenceChange, gatherConfluenceLevels]);

  // Repaint the strongest-confluence-zone band on the price pane. Reads the enabled set + the SAME
  // gathered levels as the terminal, so the band and the ranked callout always describe one zone.
  // Cheap and idempotent (reconciles the ≤3 band lines), so it's safe to call from every place the
  // walls/flip/max-pain/bars change — that's what keeps the band tracking the tape live.
  const paintConfluenceBand = useCallback(() => {
    const series = seriesRef.current;
    if (!series) return;
    const spot = spotRef.current ?? 0;
    applyConfluenceBand(series, confluenceBandRef.current, indicatorsRef.current, spot, gatherConfluenceLevels(spot));
  }, [gatherConfluenceLevels]);

  // Toggling the "Confluence zone" indicator on/off must repaint the band immediately (it's on a
  // separate paint path from paintOverlays, which only draws bar-derived overlays). Kept a distinct
  // effect placed after paintConfluenceBand's declaration to avoid a use-before-declaration cycle
  // with the earlier indicator-sync effect.
  useEffect(() => {
    paintConfluenceBand();
  }, [indicators, paintConfluenceBand]);

  // Emit top-wall integrity (is this wall real?) — strength × session persistence
  // (from the same history rail the trails use) × isolation. Scores the HORIZON-SCOPED
  // top walls (liveGexWalls) so the readout matches the walls on the chart. Note: the
  // persistence component reads the near-term-scoped recorded rail (wallHistoryRef), so
  // for a narrowed horizon whose top wall sits at a strike the rail never recorded,
  // persistence is best-effort — strength + isolation still score it honestly, and a
  // strike the rail did track still gets full persistence credit. Deduped by tier+score.
  const emitWallIntegrity = useCallback(() => {
    if (!onWallIntegrityChange) return;
    const integ = scoreTopWalls(liveGexWalls(), wallHistoryRef.current);
    const key = `${integ.call?.strike ?? "-"}:${integ.call?.tier ?? "-"}:${integ.call?.score ?? "-"}|${integ.put?.strike ?? "-"}:${integ.put?.tier ?? "-"}:${integ.put?.score ?? "-"}`;
    if (key === lastWallIntegrityRef.current) return;
    lastWallIntegrityRef.current = key;
    onWallIntegrityChange(integ);
  }, [onWallIntegrityChange, liveGexWalls]);

  // Emit the fused Vector PLAY (buildVectorPlay) — the single concrete trade idea a member sees in
  // the Pulse rail's "Suggested Play" card. Re-derives regime/magnet/proximity/confluence/wall-
  // integrity from the SAME horizon-scoped walls/flip the other emit* callbacks above use (cheap,
  // pure re-derivation rather than plumbing five extra refs), and reads maxPain/expectedMove/
  // technicals off the refs those already-existing fetches/paints populate. Deduped by a coarse key
  // (headline/conviction/grade/entry) so an unchanged read never re-renders the card.
  const emitPlay = useCallback(() => {
    const cb = onPlayChangeRef.current;
    if (!cb) return;
    const spot = spotRef.current;
    const walls = liveGexWalls();
    const flip = liveGammaFlip();
    const regime = deriveVectorRegime({
      spot,
      gammaFlip: flip,
      topCallWall: walls?.callWalls?.[0]?.strike ?? null,
      topPutWall: walls?.putWalls?.[0]?.strike ?? null,
    });
    const magnet = deriveGammaMagnet({ spot, walls, posture: regime.posture });
    const proximity = deriveWallProximity({ spot, walls, gammaFlip: flip });
    const zones = spot && spot > 0 ? confluenceZones(gatherConfluenceLevels(spot), spot) : [];
    const integrity = scoreTopWalls(walls, wallHistoryRef.current);
    const play = buildVectorPlay({
      ticker,
      horizon: dteHorizonRef.current,
      timeframeMin: timeframeRef.current,
      spot,
      regime: { posture: regime.posture },
      gexWalls: walls,
      gammaFlip: flip,
      magnet,
      proximity,
      expectedMove: expectedMoveBandsRef.current,
      maxPain: maxPainValueRef.current,
      confluenceZones: zones,
      wallIntegrity: integrity,
      technicals: technicalsForPlayRef.current,
    });
    const key = play
      ? `${play.headline}|${play.conviction}|${play.grade}|${play.entryZone ?? ""}`
      : "none";
    if (key === lastPlayKeyRef.current) return;
    lastPlayKeyRef.current = key;
    cb(play);
  }, [ticker, liveGexWalls, liveGammaFlip, gatherConfluenceLevels]);

  // Evaluate the member's alert rules against the CURRENT live tick (spot + horizon-scoped walls +
  // flip). The pure engine does the dedupe/cooldown/hysteresis; we just persist its state + the prior
  // spot (for flip-cross) and forward any fired alerts. No-op when there are no rules or no callback.
  const evaluateAlertsNow = useCallback(() => {
    const cb = onAlertsFiredRef.current;
    const rules = alertRulesRef.current;
    const spot = spotRef.current;
    if (!cb || rules.length === 0 || !(spot && spot > 0)) {
      if (spot && spot > 0) priorSpotRef.current = spot; // still track spot so the first real cross is honest
      return;
    }
    const { fired, state } = evaluateAlerts(
      rules,
      { spot, priorSpot: priorSpotRef.current, walls: liveGexWalls(), flip: liveGammaFlip(), nowMs: Date.now() },
      alertStateRef.current
    );
    alertStateRef.current = state;
    priorSpotRef.current = spot;
    if (fired.length) cb(fired);
  }, [liveGexWalls, liveGammaFlip]);

  // DTE horizon → repaint GEX walls. "all" follows the live stream; a narrower
  // horizon fetches expiry-scoped walls on demand (keeping the shared per-second
  // SSE stream untouched) and repaints, refreshing on an interval while live.
  useEffect(() => {
    dteHorizonRef.current = dteHorizon;
    // Surface the horizon to the shell so the GEX ladder re-scopes to the same expiries.
    onDteHorizonChange?.(dteHorizon);
    let cancelled = false;

    // A selection change (DTE horizon or ticker — this effect's own deps) must ALWAYS repaint the
    // terminal, even if the new scope happens to yield the same coarse dedup key as the last emit.
    // The emit dedup refs persist for the component's life, so without this reset a toggle whose
    // read collides with the prior one is SWALLOWED and the terminal stays on the old selection
    // until a full page refresh clears the refs — exactly the "had to refresh" report. Clearing them
    // here guarantees the first post-selection emit fires; steady-state SSE dedup is unaffected.
    lastRegimeReadRef.current = "";
    lastProximityRef.current = "";
    lastMagnetRef.current = "";
    lastWallIntegrityRef.current = "";
    lastPlayKeyRef.current = "";

    const repaintLive = () => {
      if (replayModeRef.current || !seriesRef.current) return;
      refreshOverlays(
        lensRef.current,
        liveGexWalls(),
        vexWallsRef.current,
        liveGammaFlip(),
        vexFlipRef.current,
        darkPoolRef.current
      );
      refreshTrails(lensRef.current);
      emitRegime();
      emitProximity();
      emitMagnet();
      emitConfluence();
      paintConfluenceBand();
      emitWallIntegrity();
      emitPlay();
    };

    const fitSessionOverview = () => {
      if (liveFollowEnabledRef.current) return;
      // Wall-history poll runs every 5s for 0DTE session overview — must not yank a manual zoom.
      if (memberViewportLocked(chartUserPannedRef.current, wheelZoomCooldownRef.current)) return;
      const chart = chartRef.current;
      if (!chart) return;
      const display = displayBarsFromMinute(minuteBarsRef.current, timeframeRef.current);
      applySessionOverviewViewport(chart, display);
      chart.timeScale().applyOptions({ shiftVisibleRangeOnNewBar: false });
      refreshTrails(lensRef.current);
    };

    // Repaint dispatcher: in replay a DTE toggle must redraw the CURRENT cursor frame (not the
    // live tape) so the horizon-scoped beads swap in immediately — applyFrame picks the per-horizon
    // source from dteHorizonRef + horizonHistoryRef, so re-applying the frame is all that's needed.
    // Mirrors the lens effect's in-replay applyFrame call. Off replay this is the live repaint.
    const repaint = () => {
      if (replayModeRef.current) {
        if (!seriesRef.current) return;
        const t = timelineRef.current[cursorIndexRef.current];
        if (t != null) applyFrame(t, minuteBarsRef.current, wallHistoryRef.current, lensRef.current);
        return;
      }
      repaintLive();
    };

    // Max-pain and the expected-move cone are HORIZON-INDEPENDENT reads: each has its own endpoint
    // that accepts ?dte= and returns a value for EVERY horizon, including "all" (verified live — the
    // "all" response carries a real band/strike). They must therefore fire on every selection and are
    // defined + invoked HERE, ABOVE the "all" early-return below. The early-return only skips the
    // horizon-SCOPED walls/history fetch (on "all" the chart follows the live SSE stream, so there's
    // nothing scoped to fetch). Before this move both reads sat AFTER the return, so on the DEFAULT
    // "all" view they never ran — the max-pain line and the ±1σ/2σ cone silently never rendered until
    // the member toggled to a narrower DTE. Same root cause, both fixed together.
    const fetchMaxPain = async () => {
      try {
        const res = await fetch(
          `/api/market/vector/max-pain?ticker=${encodeURIComponent(ticker)}&dte=${dteHorizon}`
        );
        if (cancelled || dteHorizonRef.current !== dteHorizon) return;
        const strike =
          res.ok && seriesRef.current
            ? ((await res.json()) as { maxPain?: number | null }).maxPain ?? null
            : null;
        if (cancelled || dteHorizonRef.current !== dteHorizon || !seriesRef.current) return;
        maxPainValueRef.current = strike;
        // Max-pain LINE removed from the chart (user-directed: "remove Max Pain from chart, not
        // needed") — pass null so no line is drawn (and any existing one is cleared). The value is
        // still kept in maxPainValueRef so it can contribute to the confluence zone stack below.
        applyMaxPainLine(seriesRef.current, maxPainLineRef, null);
        emitConfluence(); // the max-pain level just landed — the zone stack may have changed
        paintConfluenceBand();
        emitPlay();
      } catch {
        // Network throw: keep the last-drawn line rather than blank it on a transient blip.
      }
    };

    // Options-implied EXPECTED MOVE for the current (ticker, horizon) — the ±1σ/2σ range the chain
    // is pricing through the horizon's front expiry. Emits pre-formatted callouts to the terminal
    // (#15 cone, slice 3a) and stores the band for the chart draw (slice 3b). Best-effort: on any
    // failure or a null (no real ATM IV) it emits [] so the terminal drops the section rather than
    // showing stale, and the band clears.
    const fetchExpectedMove = async () => {
      const cb = onExpectedMoveChangeRef.current;
      if (!cb) return;
      try {
        const res = await fetch(
          `/api/market/vector/expected-move?ticker=${encodeURIComponent(ticker)}&dte=${dteHorizon}`
        );
        if (cancelled || dteHorizonRef.current !== dteHorizon) return;
        const em = res.ok
          ? ((await res.json()) as { expectedMove?: ExpectedMove | null }).expectedMove ?? null
          : null;
        if (cancelled || dteHorizonRef.current !== dteHorizon) return;
        const lines = expectedMoveCallouts(em);
        const key = lines.join("|");
        if (key !== lastExpectedMoveRef.current) {
          lastExpectedMoveRef.current = key;
          cb(lines);
        }
        // Store the band + repaint so the chart lines redraw when the toggle is on (slice 3b). The
        // repaint is a no-op for the band's sig-check when nothing changed; paintOverlays gates the
        // actual draw on the "expected-move" toggle.
        expectedMoveBandsRef.current = em;
        paintOverlays(lastDisplayBarsRef.current);
        emitPlay();
      } catch {
        // Network throw: keep the last-emitted lines rather than blank the section on a blip.
      }
    };

    // GEX positioning heatmap (#14) — the horizon-scoped strike×time surface behind the candles.
    // HORIZON-INDEPENDENT in the same sense as max-pain/expected-move: /api/market/vector/gex-heatmap
    // accepts ?dte= and returns a grid for EVERY horizon (including "all"), so it must fire on every
    // selection and is defined + invoked HERE, ABOVE the "all" early-return — otherwise the DEFAULT
    // "all" view would never fetch it and the surface would only appear after toggling a narrower DTE
    // (the exact class of bug #237 fixed for the cone/max-pain). Stores the grid and pushes it to the
    // background primitive with the current toggle state; the primitive paints only when the
    // "gex-heatmap" toggle is on, and a null grid (no honest surface) clears it — never fabricated.
    const fetchGexHeatmap = async (force = false) => {
      const bucketSec = heatmapBucketSecForChartTimeframe(timeframeRef.current);
      const spotNow = spotRef.current;
      if (
        !force &&
        spotNow != null &&
        gexHeatmapSpotAtFetchRef.current != null &&
        gexHeatmapSpotAtFetchRef.current > 0
      ) {
        const move = Math.abs(spotNow - gexHeatmapSpotAtFetchRef.current) / gexHeatmapSpotAtFetchRef.current;
        if (move >= VECTOR_GEX_HEATMAP_FAST_MOVE_PCT) force = true;
      }
      try {
        const forceQ = force ? "&force=1" : "";
        const res = await fetch(
          `/api/market/vector/gex-heatmap?ticker=${encodeURIComponent(ticker)}&dte=${dteHorizon}` +
            `&session=${encodeURIComponent(sessionYmd)}&bucketSec=${bucketSec}${forceQ}`
        );
        if (cancelled || dteHorizonRef.current !== dteHorizon) return;
        const grid = res.ok
          ? ((await res.json()) as { grid?: GexHeatmapGrid | null }).grid ?? null
          : null;
        if (cancelled || dteHorizonRef.current !== dteHorizon) return;
        gexHeatmapGridRef.current = grid;
        if (spotNow != null && spotNow > 0) gexHeatmapSpotAtFetchRef.current = spotNow;
        else if (grid?.spot != null) gexHeatmapSpotAtFetchRef.current = grid.spot;
        gexHeatmapPrimitiveRef.current?.setData(grid, indicatorsRef.current.has("gex-heatmap"));
        if (spotRef.current != null) gexHeatmapPrimitiveRef.current?.setSpot(spotRef.current);
      } catch {
        // Network throw: keep the last-drawn surface rather than blank it on a transient blip.
      }
    };

    void fetchMaxPain();
    void fetchExpectedMove();
    void fetchGexHeatmap(false);

    const heatmapId = liveSession ? setInterval(() => void fetchGexHeatmap(false), GEX_HEATMAP_REFRESH_MS) : null;

    // Clear stale horizon state UP FRONT on every DTE switch — prevents the terminal from
    // briefly narrating the PREVIOUS horizon's walls/confluence while the new fetch is in flight,
    // and avoids the lastConfluenceRef dedup suppressing a re-emit when the new zones happen to
    // match the old key string.
    horizonWallsRef.current = null;
    horizonFlipRef.current = null;
    horizonHistoryRef.current =
      dteHorizon === openingDteHorizon && initialHorizonWallHistory.length
        ? initialHorizonWallHistory
        : [];
    lastConfluenceRef.current = "";

    if (dteHorizon === "0dte") {
      requestAnimationFrame(() => fitSessionOverview());
    }

    // "all" with an SSR seed: off-hours needs no fetch. During live RTH still poll the enriched
    // blended rail so recorder holes (SWEEP OVER BUDGET / per-ticker dark streaks) heal without a
    // full reload — the 5s writer stamps Redis continuously but SSE only carries this tier's
    // in-memory tail, so wallHistoryRef would otherwise freeze mid-session gaps in place.
    if (dteHorizon === "all" && !seedRailEmptyRef.current) {
      const fetchBlendedHistory = async () => {
        try {
          const res = await fetch(
            `/api/market/vector/wall-history?ticker=${encodeURIComponent(ticker)}&dte=all` +
              `&session=${encodeURIComponent(sessionYmd)}`
          );
          if (cancelled || dteHorizonRef.current !== "all" || !res.ok) return;
          const data = (await res.json()) as { history?: WallHistorySample[] };
          if (cancelled || dteHorizonRef.current !== "all") return;
          const remote = Array.isArray(data.history) ? data.history : [];
          if (!remote.length) return;
          const merged = mergeWallHistory(wallHistoryRef.current, remote);
          if (merged === wallHistoryRef.current) return;
          wallHistoryRef.current = merged;
          setSessionHistory(merged);
          if (hasVexInHistory(merged)) setVexAvailable(true);
          repaint();
        } catch {
          /* supplementary — SSE + seed still drive the chart */
        }
      };

      if (liveSession) {
        void fetchBlendedHistory();
        const blendedHistId = setInterval(fetchBlendedHistory, Math.max(wallTrailSec * 1000, 30_000));
        repaint();
        return () => {
          cancelled = true;
          clearInterval(blendedHistId);
          if (heatmapId) clearInterval(heatmapId);
        };
      }

      repaint();
      return () => {
        cancelled = true;
        if (heatmapId) clearInterval(heatmapId);
      };
    }

    // Fetch the RECORDED per-horizon trail (frozen clusters) in parallel with the current walls.
    // Separate from fetchScoped so a slow/empty history read never delays the current-structure
    // repaint. Guarded on the still-active horizon + not cancelled, same as fetchScoped.
    const fetchHistory = async () => {
      try {
        const res = await fetch(
          `/api/market/vector/wall-history?ticker=${encodeURIComponent(ticker)}&dte=${dteHorizon}` +
            `&session=${encodeURIComponent(sessionYmd)}`
        );
        if (cancelled || dteHorizonRef.current !== dteHorizon || !res.ok) return;
        const data = (await res.json()) as { history?: WallHistorySample[] };
        if (cancelled || dteHorizonRef.current !== dteHorizon) return;
        horizonHistoryRef.current = Array.isArray(data.history) ? data.history : [];
        repaint();
        if (dteHorizonRef.current === "0dte") requestAnimationFrame(() => fitSessionOverview());
      } catch {
        // History is a supplementary overlay — on any failure keep the single-column fallback
        // (horizonHistoryRef stays []), which refreshTrails already draws. No repaint needed.
      }
    };

    const fetchScoped = async () => {
      try {
        const res = await fetch(
          `/api/market/vector/walls?ticker=${encodeURIComponent(ticker)}&dte=${dteHorizon}`
        );
        if (cancelled || dteHorizonRef.current !== dteHorizon) return;
        if (!res.ok) {
          // Fetch reachable but errored (e.g. 5xx). Still repaint against the live stream values
          // (liveGexWalls/liveGammaFlip fall back to the un-scoped stream), so the terminal reflects
          // the CURRENT selection instead of freezing on the previous horizon's narration.
          repaintLive();
          return;
        }
        const data = (await res.json()) as { walls?: VectorWalls | null; flip?: number | null };
        if (cancelled || dteHorizonRef.current !== dteHorizon) return;
        horizonWallsRef.current = data.walls ?? null;
        // Re-scope the flip line with the horizon too. A null flip (e.g. no ladder
        // zero-crossing in the scoped expiries) falls back to the live stream flip
        // via liveGammaFlip, so the flip never vanishes just because a horizon narrowed.
        horizonFlipRef.current = data.flip ?? null;
        repaintLive();
      } catch {
        // Network throw: keep last-known scoped walls/flip, but STILL repaint so the terminal
        // re-derives against the current selection (stream fallback) rather than staying stale.
        if (!cancelled && dteHorizonRef.current === dteHorizon) repaintLive();
      }
    };

    void fetchScoped();
    void fetchHistory();
    const scopePollMs = wallTrailSec * 1000;
    // Refresh both walls and wall history on the same cadence for coherent display.
    const id = liveSession ? setInterval(fetchScoped, scopePollMs) : null;
    const histId = liveSession ? setInterval(fetchHistory, scopePollMs) : null;
    return () => {
      cancelled = true;
      if (id) clearInterval(id);
      if (histId) clearInterval(histId);
      if (heatmapId) clearInterval(heatmapId);
    };
  }, [
    dteHorizon,
    ticker,
    wallTrailSec,
    sessionYmd,
    liveSession,
    timeframe,
    // chartReady: at mount this effect runs BEFORE the chart-creation effect builds the series, so
    // repaintLive() bails on !seriesRef.current and the terminal stays blank until the first SSE
    // frame — which never arrives in a closed session (→ "had to refresh"). Re-running once the
    // series exists fires the initial emits against the SSR-seeded walls/spot refs.
    chartReady,
    applyFrame,
    refreshOverlays,
    refreshTrails,
    liveGexWalls,
    liveGammaFlip,
    emitRegime,
    emitProximity,
    emitMagnet, emitConfluence,
    paintConfluenceBand,
    emitWallIntegrity,
    emitPlay,
    onDteHorizonChange,
  ]);

  // Narrowed DTE horizons draw from horizonHistoryRef, polled at ticker-aware cadence (5s oracle / 15s on-demand).
  // While viewing live, stamp scoped walls into the in-memory rail each trail bucket.
  useEffect(() => {
    if (!liveSession || dteHorizon === "all") return;
    const trailSec = wallTrailSecRef.current;
    const id = setInterval(() => {
      if (replayModeRef.current) return;
      const walls = horizonWallsRef.current;
      if (!walls || (!walls.callWalls.length && !walls.putWalls.length)) return;
      const sampleTime = bucketWallSampleTime(Math.floor(Date.now() / 1000), trailSec);
      const sample = buildWallHistorySample({
        time: sampleTime,
        gexWalls: walls,
        gammaFlip: horizonFlipRef.current ?? gammaFlipRef.current,
        vexWalls: null,
        vexFlip: null,
      });
      if (!sample) return;
      const next = recordWallSample(horizonHistoryRef.current, sample);
      if (next === horizonHistoryRef.current) return;
      horizonHistoryRef.current = next;
      refreshTrails(lensRef.current);
    }, trailSec * 1000);
    return () => clearInterval(id);
  }, [liveSession, dteHorizon, wallTrailSec, refreshTrails]);

  // Lens (GEX↔VEX) is a selection too: re-derive the terminal so the lens-gated wall-integrity line
  // (and the rest) reflect the new lens immediately, not on the next SSE frame — which never arrives
  // in a closed session, forcing the member to refresh. Reset the dedup keys so the switch can't be
  // swallowed by a coincidental key match. Placed after the emit callbacks are declared (they read
  // lensRef, synced above) and guarded on the series existing / not replaying.
  useEffect(() => {
    if (!chartReady || replayModeRef.current || !seriesRef.current) return;
    lastRegimeReadRef.current = "";
    lastProximityRef.current = "";
    lastMagnetRef.current = "";
    lastWallIntegrityRef.current = "";
    lastPlayKeyRef.current = "";
    emitRegime();
    emitProximity();
    emitMagnet();
    emitConfluence();
    paintConfluenceBand();
    emitWallIntegrity();
    emitPlay();
  }, [lens, chartReady, emitRegime, emitProximity, emitMagnet, emitConfluence, paintConfluenceBand, emitWallIntegrity, emitPlay]);

  const connectLive = useCallback(() => {
    if (!liveSessionRef.current) return;
    connRef.current?.close();

    // Closed-bar backfill on every (re)connect: the SSE only carries the
    // currently-forming candle, so bars that closed while disconnected
    // (reconnect crossing a minute boundary, tab sleep) — and the bar Polygon
    // hadn't published yet at SSR time — were permanent holes corrupting
    // higher-timeframe aggregates. Fire-and-forget; merge is idempotent.
    void fetch(`/api/market/vector/bars?ticker=${encodeURIComponent(ticker)}`)
      .then(async (res) => {
        if (!res.ok) return;
        const data = (await res.json()) as { bars?: VectorBar[]; sessionYmd?: string };
        if (!data.bars?.length) return;
        // Embed hosts may still carry calendar-today while the seed API reports the latest
        // session with bars (pre-open, weekend, Polygon lag). Seed when empty — never discard
        // real bars on reconnect when the member already has a session painted.
        if (data.sessionYmd !== sessionYmd && minuteBarsRef.current.length > 0) return;
        const merged = mergeBarsByTime(minuteBarsRef.current, data.bars);
        if (merged === minuteBarsRef.current) return;
        minuteBarsRef.current = merged;
        setSessionBars(merged);
        if (!replayModeRef.current && seriesRef.current) {
          const display = displayBarsFromMinute(merged, timeframeRef.current);
          displayBarTimeRef.current = display[display.length - 1]?.time ?? 0;
          // BUG 2: closed-bar backfill on (re)connect is a background re-seed — must not reset
          // the member's zoom/pan. Preserve the viewport (or follow live if at the edge).
          applyDisplayBarsPreservingView(
            chartRef.current,
            seriesRef.current,
            volumeSeriesRef.current,
            display,
            liveFollowEnabledRef.current
          );
          paintOverlays(display);
        }
      })
      .catch(() => {
        /* best-effort — live ticks keep flowing regardless */
      });

    let lastMinuteBarTime = minuteBarsRef.current.length
      ? minuteBarsRef.current[minuteBarsRef.current.length - 1]!.time
      : 0;

    connRef.current = createVectorEventSource(ticker, (snap) => {
      if (snap.sessionYmd && snap.sessionYmd !== sessionYmd) return;
      if (!liveSessionRef.current) return;
      // During replay the connection stays OPEN and every branch below keeps
      // accumulating into refs/state — only chart PAINTS are gated. Closing the
      // stream (the old behavior) permanently lost every bar that closed while
      // the member was in replay: nothing backfills bars on reconnect, so a
      // 10-minute replay left a 10-bar hole in the session for the rest of the
      // day, silently corrupting higher-timeframe OHLC aggregates.
      const inReplay = replayModeRef.current;

      if (snap.wallTrailSec != null && Number.isFinite(snap.wallTrailSec)) {
        setWallTrailSec(Math.floor(snap.wallTrailSec));
      }

      if (snap.wallHistory?.length) {
        const prevTail = wallHistoryRef.current[wallHistoryRef.current.length - 1];
        const merged = mergeWallHistory(wallHistoryRef.current, snap.wallHistory);
        if (merged !== wallHistoryRef.current) {
          const newTail = merged[merged.length - 1];
          if (prevTail && newTail) {
            for (const active of ["gex", "vex"] as const) {
              const incoming = diffVectorWallSample(prevTail, newTail, active);
              if (incoming.length) {
                setWallEvents((ev) => appendVectorWallEvents(ev, incoming));
              }
            }
          }
          wallHistoryRef.current = merged;
          setSessionHistory(merged);
          if (hasVexInHistory(merged)) setVexAvailable(true);
          if (!inReplay) refreshTrails(lensRef.current);
        }
      }

      if (snap.t) {
        onFreshness?.(snap.t);
      }
      if (snap.gexAsOf != null) {
        setGexAsOf(snap.gexAsOf);
      }
      if (snap.vexAsOf != null) {
        setVexAsOf(snap.vexAsOf);
      }

      if (snap.gammaFlip !== undefined) {
        gammaFlipRef.current = snap.gammaFlip ?? null;
      }
      if (snap.vexFlip !== undefined) {
        vexFlipRef.current = snap.vexFlip ?? null;
      }
      if (snap.darkPoolLevels) {
        darkPoolRef.current = snap.darkPoolLevels;
      }
      // Capture the PREVIOUS tick's structure before overwriting — spot-break
      // detection requires the level to have been stable across the tick (a
      // wall relocating across a flat spot is not a breakout).
      const prevStruct = {
        gexWalls: gexWallsRef.current,
        vexWalls: vexWallsRef.current,
        gammaFlip: gammaFlipRef.current,
        vexFlip: vexFlipRef.current,
      };
      if (snap.walls) {
        gexWallsRef.current = snap.walls;
      }
      if (snap.vexWalls) {
        vexWallsRef.current = snap.vexWalls;
        if (snap.vexWalls.callWalls?.length || snap.vexWalls.putWalls?.length) {
          setVexAvailable(true);
        }
      }

      if (snap.candle && snap.candle.time >= lastMinuteBarTime) {
        lastMinuteBarTime = snap.candle.time;
        const curSpot = snap.candle.close;
        const prevSpot = spotRef.current;
        for (const active of ["gex", "vex"] as const) {
          const spotEvents = detectSpotStructureEvents(
            prevSpot,
            curSpot,
            wallsForActiveLens(active, gexWallsRef.current, vexWallsRef.current),
            flipForActiveLens(active, gammaFlipRef.current, vexFlipRef.current),
            active,
            snap.candle.time,
            wallsForActiveLens(active, prevStruct.gexWalls, prevStruct.vexWalls),
            flipForActiveLens(active, prevStruct.gammaFlip, prevStruct.vexFlip),
            ticker
          );
          if (spotEvents.length) {
            setWallEvents((ev) => appendVectorWallEvents(ev, spotEvents));
          }
        }
        spotRef.current = curSpot;
        onSpotChange?.(curSpot);
        gexHeatmapPrimitiveRef.current?.setSpot(curSpot);
        if (
          liveSessionRef.current &&
          !inReplay &&
          gexHeatmapSpotAtFetchRef.current != null &&
          gexHeatmapSpotAtFetchRef.current > 0 &&
          curSpot > 0
        ) {
          const move = Math.abs(curSpot - gexHeatmapSpotAtFetchRef.current) / gexHeatmapSpotAtFetchRef.current;
          if (move >= VECTOR_GEX_HEATMAP_FAST_MOVE_PCT) {
            void fetch(`/api/market/vector/gex-heatmap?ticker=${encodeURIComponent(ticker)}&dte=${dteHorizonRef.current}` +
              `&session=${encodeURIComponent(sessionYmd)}&bucketSec=${heatmapBucketSecForChartTimeframe(timeframeRef.current)}&force=1`)
              .then(async (res) => {
                if (!res.ok) return;
                const grid = ((await res.json()) as { grid?: GexHeatmapGrid | null }).grid ?? null;
                gexHeatmapGridRef.current = grid;
                gexHeatmapSpotAtFetchRef.current = curSpot;
                gexHeatmapPrimitiveRef.current?.setData(grid, indicatorsRef.current.has("gex-heatmap"));
                gexHeatmapPrimitiveRef.current?.setSpot(curSpot);
              })
              .catch(() => {});
          }
        }
        minuteBarsRef.current = upsertBar(minuteBarsRef.current, snap.candle as VectorBar);
        setSessionBars(minuteBarsRef.current);
        if (!inReplay) {
          const displayBars = displayBarsFromMinute(minuteBarsRef.current, timeframeRef.current);
          const lastDisplay = displayBars[displayBars.length - 1];
          if (lastDisplay) {
            displayBarTimeRef.current = lastDisplay.time;
            seriesRef.current?.update(lastDisplay);
            volumeSeriesRef.current?.setData(volumeHistogramData(displayBars));
          }
        }
      }

      // Painting the live overlays during replay would overwrite the cursor-sliced
      // frame applyFrame just drew — same leak shape as the 2026-07-07 finding.
      if (!inReplay) {
        refreshOverlays(
          lensRef.current,
          liveGexWalls(),
          vexWallsRef.current,
          liveGammaFlip(),
          vexFlipRef.current,
          darkPoolRef.current
        );
        emitRegime();
        emitProximity();
        emitMagnet();
        emitConfluence();
        paintConfluenceBand(); // live SSE tick moved the walls — re-fit the band to the new stack
        emitWallIntegrity();
        emitPlay();
        evaluateAlertsNow(); // spot/walls/flip just advanced — check the member's alert rules
      }
    });
  }, [sessionYmd, refreshTrails, refreshOverlays, onFreshness, ticker, liveGexWalls, liveGammaFlip, emitRegime, emitProximity, emitMagnet, emitConfluence, paintConfluenceBand, emitWallIntegrity, emitPlay, evaluateAlertsNow, paintOverlays]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const chart = createChart(container, {
      autoSize: true,
      // Pin the axis locale instead of inheriting navigator.language — a rejected default
      // tag (e.g. "en-US@posix") throws inside the chart's Intl-based time-axis formatting
      // and blanks the whole canvas. See vector-chart-config.ts for the full write-up.
      localization: { locale: VECTOR_CHART_LOCALE },
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: "#9fb4d4",
      },
      grid: {
        vertLines: { color: "rgba(255,255,255,0.06)" },
        horzLines: { color: "rgba(255,255,255,0.06)" },
      },
      timeScale: {
        timeVisible: true,
        secondsVisible: true,
        // Live follow is opt-in after load when defaultChartViewport is "session" — see liveFollowEnabledRef.
        shiftVisibleRangeOnNewBar: defaultChartViewport === "live",
        // Leave whitespace between the last candle and the price axis so the bead bands stop short
        // of the axis (Skylit-style) instead of running flush into it.
        rightOffset: VECTOR_RIGHT_OFFSET_BARS,
      },
      rightPriceScale: { borderColor: "rgba(255,255,255,0.12)" },
      crosshair: {
        vertLine: { color: "rgba(34, 211, 238, 0.35)", width: 1, style: LineStyle.Dashed },
        horzLine: { color: "rgba(34, 211, 238, 0.35)", width: 1, style: LineStyle.Dashed },
      },
    });

    const series = chart.addSeries(CandlestickSeries, {
      upColor: "#a3e635",
      downColor: "#ff2d55",
      borderVisible: false,
      wickUpColor: "#a3e635",
      wickDownColor: "#ff2d55",
      priceLineVisible: false,
      lastValueVisible: true,
      // Widen the auto-fitted candle range to also include the drawn walls within
      // ±WALL_VIEW_MAX_PCT of spot, so put (support) walls below the candle band
      // are visible instead of clipped. Pure union — never narrows the candle range.
      autoscaleInfoProvider: (original: () => AutoscaleInfo | null) => {
        const res = original();
        if (!res || !res.priceRange) return res;
        // During a wheel-zoom cooldown, return the raw candle range WITHOUT extending
        // for walls/beads — this lets the member's scroll-zoom hold tight to the visible
        // candles instead of snapping back to the wide wall-inclusive band on every tick.
        if (memberViewportLocked(chartUserPannedRef.current, wheelZoomCooldownRef.current)) {
          return res;
        }
        // Two composed widenings (each only ever WIDENS, never narrows the candle band):
        // 1) the current live ladder (rangeWallsRef) within the tight ±WALL_VIEW_MAX_PCT window;
        // 2) the strikes ACTUALLY drawn as beads (beadStrikesRef) within the wider BEAD_VIEW_MAX_PCT.
        // (2) is what keeps beads from vanishing on zoom: autoscale re-runs on every zoom off the
        // now-fewer visible candles, and without covering the drawn-bead strikes a bead outside the
        // ladder range clipped out and reappeared on zoom-back. Covering the drawn set makes the
        // rail stable at every zoom (Skylit wide-rail look).
        const ladderRange = extendRangeForWalls(
          res.priceRange,
          spotRef.current,
          rangeWallsRef.current.call,
          rangeWallsRef.current.put,
          WALL_VIEW_MAX_PCT
        );
        const beadViewPct = compareCompactBeadsRef.current ? COMPARE_BEAD_VIEW_MAX_PCT : BEAD_VIEW_MAX_PCT;
        return {
          ...res,
          priceRange: extendRangeForWalls(
            ladderRange,
            spotRef.current,
            beadStrikesRef.current.call,
            beadStrikesRef.current.put,
            beadViewPct,
            beadViewPct
          ),
        };
      },
    }, 0);

    // Volume in its OWN sub-pane below price (like RSI/MACD), not overlaid on the candles. Compare
    // panes omit volume entirely so candles + beads get the full pane height.
    let volumeSeries: ISeriesApi<"Histogram"> | null = null;
    if (!hideVolumePaneRef.current) {
      volumeSeries = chart.addSeries(
        HistogramSeries,
        {
          priceFormat: { type: "volume" },
          lastValueVisible: false,
          priceLineVisible: false,
        },
        VOLUME_PANE_INDEX
      );
      volumeSeries.priceScale().applyOptions({
        scaleMargins: { top: 0.1, bottom: 0 },
      });
    }
    applyPaneStretch(chart, hideVolumePaneRef.current);

    const initialDisplay = displayBarsFromMinute(initialBars, initialTimeframe);
    applyDisplayBars(series, volumeSeries, initialDisplay);
    paintOverlays(initialDisplay);
    displayBarTimeRef.current = initialBars[initialBars.length - 1]?.time ?? 0;
    lastDisplayBarsRef.current = initialDisplay;
    // Deliberate refit on FIRST load only — there is no prior viewport to preserve here.
    // Session overview frames the newest ET day only (seed carries multiple sessions); live
    // follow fits the full seed. Background re-seeds route through applyDisplayBarsPreservingView.
    if (initialBars.length) {
      if (
        wantsSessionOverviewViewport(defaultChartViewport, liveFollowEnabledRef.current)
      ) {
        applySessionOverviewViewport(chart, initialDisplay);
        chart.timeScale().applyOptions({ shiftVisibleRangeOnNewBar: false });
      } else {
        chart.timeScale().fitContent();
      }
    }

    const enableLiveFollowIfAtEdge = () => {
      if (liveFollowEnabledRef.current || !chartUserPannedRef.current) return;
      if (!chartIsFollowingLive(chart)) return;
      liveFollowEnabledRef.current = true;
      chart.timeScale().applyOptions({ shiftVisibleRangeOnNewBar: true });
    };

    chart.timeScale().subscribeVisibleLogicalRangeChange(() => {
      enableLiveFollowIfAtEdge();
    });

    const onVisibleTimeRangeChange = (range: { from: Time; to: Time } | null) => {
      if (applyingExternalRangeRef.current || !range) return;
      const sync = compareSyncRef.current;
      if (!sync?.linkZoom) return;
      const parsed = visibleRangeToEpochSec(range);
      if (!parsed) return;
      onCompareVisibleRangeRef.current?.(sync.paneId, parsed.fromSec, parsed.toSec);
    };
    chart.timeScale().subscribeVisibleTimeRangeChange(onVisibleTimeRangeChange);

    const onChartPointerDown = () => {
      chartUserPannedRef.current = true;
    };
    container.addEventListener("mousedown", onChartPointerDown);
    container.addEventListener("touchstart", onChartPointerDown, { passive: true });

    chartRef.current = chart;
    seriesRef.current = series;
    volumeSeriesRef.current = volumeSeries;
    setChartReady(true);
    callBeadsRef.current = createSeriesMarkers(series, []);
    putBeadsRef.current = createSeriesMarkers(series, []);
    structureMarkersRef.current = createSeriesMarkers(series, []);
    flowMarkersRef.current = createSeriesMarkers(series, []);
    // Wall ribbon rail — the primary bead visual (strength=thickness, magnitude=brightness,
    // build/fade/birth cues). Attached once; fed the composed call+put trails on each repaint.
    const wallRail = new WallRailPrimitive();
    series.attachPrimitive(wallRail);
    wallRailPrimitiveRef.current = wallRail;
    // GEX positioning heatmap (#14): attach the background surface primitive to the candle series.
    // It renders at zOrder "bottom" (under the candles + every overlay); its data/visibility are
    // pushed via setData from paintOverlays + the DTE-scoped fetch, so it stays hidden (draws
    // nothing) until the member enables the "gex-heatmap" toggle AND a real grid has landed.
    const gexHeatmap = new GexHeatmapPrimitive();
    series.attachPrimitive(gexHeatmap);
    gexHeatmapPrimitiveRef.current = gexHeatmap;
    // Dealer-gamma regime boundary glow — attached AFTER the heatmap so, within the shared "bottom"
    // zOrder, the glow sits just over the heatmap yet still under the candles. Stays hidden (draws
    // nothing) until the member enables the "gamma-regime" toggle AND a finite flip is pushed.
    const gammaRegime = new GammaRegimePrimitive();
    series.attachPrimitive(gammaRegime);
    gammaRegimePrimitiveRef.current = gammaRegime;
    // Session volume profile (P2 #4): right-margin bars, background layer like the heatmap/regime
    // glow above. Stays hidden until the member enables "volume-profile" AND real session volume
    // exists.
    const volumeProfile = new VolumeProfilePrimitive();
    series.attachPrimitive(volumeProfile);
    volumeProfilePrimitiveRef.current = volumeProfile;
    // EOD pin CONE (SPX desk only): attach the converging-cone primitive to the candle series. It
    // renders at zOrder "top" (a translucent gold funnel over the candles) and stays hidden until
    // paintOverlays pushes a real MC cone for SPX. The right-margin room it needs comes from
    // VECTOR_RIGHT_OFFSET_BARS on the time scale (the cone maps into that whitespace by time-frac).
    const pinCone = new PinConePrimitive();
    series.attachPrimitive(pinCone);
    pinConePrimitiveRef.current = pinCone;
    // TIME-CONVERGING EXPECTED-MOVE CONE — attach the "remaining move" funnel primitive. Renders at
    // zOrder "bottom" (a faint cyan wash under the candles, alongside the heatmap/regime glow) and
    // stays hidden until paintOverlays pushes a real cone AND the member enables the toggle. The
    // right-margin room it maps into is the same VECTOR_RIGHT_OFFSET_BARS whitespace the pin cone uses.
    const emCone = new EmConePrimitive();
    series.attachPrimitive(emCone);
    emConePrimitiveRef.current = emCone;

    refreshTrails("gex");
    refreshOverlays("gex", initialWalls, initialVexWalls, initialGammaFlip, initialVexFlip, initialDarkPoolLevels);
    pinCandlesOnTop(series);

    if (
      wantsSessionOverviewViewport(defaultChartViewport, liveFollowEnabledRef.current)
    ) {
      // Trails/overlays paint after the first viewport pass — re-frame once markers exist.
      requestAnimationFrame(() => {
        if (memberViewportLocked(chartUserPannedRef.current, wheelZoomCooldownRef.current)) return;
        const display = displayBarsFromMinute(minuteBarsRef.current, timeframeRef.current);
        applySessionOverviewViewport(chart, display);
        chart.timeScale().applyOptions({ shiftVisibleRangeOnNewBar: false });
        refreshTrails(lensRef.current);
      });
    }

    // SCROLL-ZOOM FIX: stamp a cooldown on every wheel event so the autoscaleInfoProvider
    // and reassertPriceAutoScale calls respect the member's zoom for 8s instead of
    // snapping back to the wide wall-inclusive range on the next SSE tick. When the wheel
    // lands on the price-axis strip (rightmost ~65px), also disable autoScale entirely so
    // the member can hold a manual vertical zoom (double-click restores it).
    const onWheel = (e: WheelEvent) => {
      wheelZoomCooldownRef.current = Date.now();
      chartUserPannedRef.current = true;
      const rect = container.getBoundingClientRect();
      const xInChart = e.clientX - rect.left;
      const priceAxisZone = rect.width - 65;
      if (xInChart >= priceAxisZone) {
        series.priceScale().applyOptions({ autoScale: false });
      }
    };
    container.addEventListener("wheel", onWheel, { passive: true });

    chart.subscribeCrosshairMove((param) => {
      if (!param.time || !param.point) {
        setCrosshair(null);
        const sync = compareSyncRef.current;
        if (sync?.linkCrosshair && !applyingExternalCrosshairRef.current) {
          onCompareCrosshairRef.current?.(sync.paneId, null);
        }
        return;
      }
      const bar = param.seriesData.get(series) as VectorBar | undefined;
      const time =
        typeof param.time === "number"
          ? formatReplayClock(param.time)
          : String(param.time);
      const activeLens = lensRef.current;
      const hoverEpochSec = typeof param.time === "number" ? param.time : null;
      const syncState = compareSyncRef.current;
      if (syncState?.linkCrosshair && !applyingExternalCrosshairRef.current && hoverEpochSec != null) {
        onCompareCrosshairRef.current?.(syncState.paneId, hoverEpochSec);
      }
      const history = wallHistoryRef.current;
      const walls = wallsAtCrosshairTime(
        history,
        hoverEpochSec,
        activeLens,
        gexWallsRef.current,
        vexWallsRef.current
      );
      const hoverPrice = series.coordinateToPrice(param.point.y);
      const gexCell =
        indicatorsRef.current.has("gex-heatmap") &&
        gexHeatmapGridRef.current &&
        hoverEpochSec != null &&
        hoverPrice != null &&
        Number.isFinite(hoverPrice)
          ? gexCellAtGridPoint(gexHeatmapGridRef.current, hoverEpochSec, hoverPrice as number)
          : null;
      setCrosshair({
        time,
        close: bar?.close ?? null,
        lens: activeLens,
        flip: flipAtCrosshairTime(
          history,
          hoverEpochSec,
          activeLens,
          gammaFlipRef.current,
          vexFlipRef.current
        ),
        callWalls: walls?.callWalls ?? [],
        putWalls: walls?.putWalls ?? [],
        gexCell,
        // No DP history exists — only today's live ladder. Walls/flip above resolve
        // to their value AT the hovered time; showing live DP under a historical
        // hover timestamp would mislabel it. Show DP only when hovering the present
        // (at/after the latest recorded sample, or before any history exists).
        darkPoolLevels:
          hoverEpochSec == null ||
          history.length === 0 ||
          hoverEpochSec >= (history[history.length - 1]?.time ?? 0)
            ? darkPoolRef.current
            : [],
      });
    });

    // SHARED PRICE AXIS seam — only wired when a host asked for it at mount (the SPX desk
    // passes a stable setState from its first render; the standalone /vector page never sets
    // the prop, so no interval/subscription is created there and behavior is unchanged).
    let priceScaleTimer: ReturnType<typeof setInterval> | null = null;
    let priceScaleThrottle: ReturnType<typeof createRenderThrottle> | null = null;
    if (onPriceScaleRenderRef.current) {
      const emitPriceScale = () => {
        const cb = onPriceScaleRenderRef.current;
        // Read through the refs (not the effect locals) so a mid-teardown tick no-ops.
        const liveChart = chartRef.current;
        const liveSeries = seriesRef.current;
        const el = containerRef.current;
        if (!cb || !liveChart || !liveSeries || !el) return;
        const height = liveChart.paneSize(0).height;
        if (!(height > 0)) return;
        // Visible price range = the prices at the pane's pixel edges (no public API exposes
        // the autoscaled range directly; inverting the coordinate map is exact).
        const top = liveSeries.coordinateToPrice(0);
        const bottom = liveSeries.coordinateToPrice(height);
        if (top == null || bottom == null || !(top > bottom)) return;
        const snap: PriceScaleSnapshot = {
          rangeMin: bottom as number,
          rangeMax: top as number,
          height,
          // paneTop in viewport coords: pane 0 starts at the canvas container's top (time
          // axis + sub-panes are below it), so the container rect top IS the pane top.
          paneTop: el.getBoundingClientRect().top,
        };
        if (!priceScaleMapChanged(lastPriceScaleSnapRef.current, snap)) return;
        lastPriceScaleSnapRef.current = snap;
        cb({
          ...snap,
          // Guarded through the ref so a host calling priceToY after unmount gets null
          // instead of a disposed-series throw.
          priceToY: (price: number) => {
            const s = seriesRef.current;
            if (s !== liveSeries || s == null) return null;
            const y = s.priceToCoordinate(price);
            return y == null ? null : (y as number);
          },
        });
      };
      priceScaleThrottle = createRenderThrottle(emitPriceScale, 250);
      // Poll catch-all (autoscale/data paints have no public event) + immediate response to
      // pan/zoom via the logical-range subscription; both funnel through the same throttle.
      priceScaleTimer = setInterval(() => priceScaleThrottle!.call(), 250);
      chart.timeScale().subscribeVisibleLogicalRangeChange(() => priceScaleThrottle?.call());
      emitPriceScale();
    }

    if (liveSession) connectLive();

    // Host embeds (SPX iOS segment) mount after flex layout settles — nudge autosize when the
    // container gains real dimensions (WKWebView can miss the first ResizeObserver tick at 0×0).
    const layoutObserver = new ResizeObserver(() => {
      const w = container.clientWidth;
      const h = container.clientHeight;
      if (w > 0 && h > 0) chart.resize(w, h);
    });
    layoutObserver.observe(container);
    // Compare grid starts `display:none` below 1280px and can mount before flex settles —
    // nudge autosize when the pane scrolls into view or the container crosses a size threshold.
    let intersectionObserver: IntersectionObserver | null = null;
    const nudgeChartSize = () => {
      const w = container.clientWidth;
      const h = container.clientHeight;
      if (w > 0 && h > 0) chart.resize(w, h);
    };
    if (fillHost && typeof IntersectionObserver !== "undefined") {
      intersectionObserver = new IntersectionObserver(
        (entries) => {
          if (entries.some((e) => e.isIntersecting)) nudgeChartSize();
        },
        { threshold: 0.01 }
      );
      intersectionObserver.observe(container);
    }
    // WKWebView flex layouts often settle one frame late — double-rAF resize for fillHost embeds.
    if (fillHost) {
      requestAnimationFrame(() => {
        requestAnimationFrame(nudgeChartSize);
      });
    }

    return () => {
      layoutObserver.disconnect();
      intersectionObserver?.disconnect();
      container.removeEventListener("wheel", onWheel);
      container.removeEventListener("mousedown", onChartPointerDown);
      container.removeEventListener("touchstart", onChartPointerDown);
      chart.timeScale().unsubscribeVisibleTimeRangeChange(onVisibleTimeRangeChange);
      stopReplayTimer();
      if (priceScaleTimer != null) clearInterval(priceScaleTimer);
      priceScaleThrottle?.cancel();
      lastPriceScaleSnapRef.current = null;
      connRef.current?.close();
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
      callGuideRefs.current = emptyGuideRefs();
      putGuideRefs.current = emptyGuideRefs();
      dpGuideRefs.current = [];
      flipGuideRef.current = null;
      // chart.remove() disposed the ribbon-rail primitive with the series; drop the ref so a remount reattaches.
      wallRailPrimitiveRef.current = null;
      // chart.remove() disposes the series (and its price lines) — just drop the stale refs so a
      // remount (ticker switch) starts clean instead of calling removePriceLine on a dead series.
      kingCallLineRef.current = null;
      kingPutLineRef.current = null;
      maxPainLineRef.current = null;
      maxPainValueRef.current = null;
      // chart.remove() disposed the band's price lines; drop refs + sig so a remount redraws cleanly.
      emBandLinesRef.current = [];
      expectedMoveBandsRef.current = null;
      emBandSigRef.current = "";
      // Same for the EOD pin projection lines.
      pinLinesRef.current = [];
      pinProjRef.current = null;
      pinSigRef.current = "";
      // chart.remove() disposed the pin-cone primitive with the series; drop refs so a remount reattaches.
      pinConePrimitiveRef.current = null;
      pinConeRef.current = null;
      // Same for the EM cone primitive — disposed with the series; drop the ref so a remount reattaches
      // (matches the field comment claiming it's cleared on remount).
      emConePrimitiveRef.current = null;
      // chart.remove() disposes the overlay line series too — swap in a fresh map so a remount
      // rebuilds instead of touching the now-disposed series (matches the sibling ref resets).
      overlaySeriesRef.current = new Map();
      // chart.remove() disposes the oscillator pane series too — swap in a fresh map + clear the
      // layout key so a remount rebuilds the panes from scratch.
      oscillatorSeriesRef.current = new Map();
      lastOscKeyRef.current = "";
      levelLinesRef.current = new Map();
      confluenceBandRef.current = new Map();
      priorDayRef.current = null;
      priorDayTickerRef.current = null;
      callBeadsRef.current = null;
      putBeadsRef.current = null;
      structureMarkersRef.current = null;
      // chart.remove() disposed the flow markers instance too — drop the ref + prints so a remount
      // (ticker switch) starts clean and doesn't touch a dead series.
      flowMarkersRef.current = null;
      flowPrintsRef.current = [];
      lastFlowTruncatedRef.current = -1;
      // chart.remove() disposes the series and its attached primitives; drop the refs + last grid so
      // a remount (ticker switch) re-attaches a fresh primitive instead of touching a dead one.
      gexHeatmapPrimitiveRef.current = null;
      gexHeatmapGridRef.current = null;
      // Same lifecycle as the heatmap primitive — chart.remove() disposed it; drop the refs so a
      // remount re-attaches a fresh glow instead of touching a dead one.
      gammaRegimePrimitiveRef.current = null;
      regimeFlipRef.current = null;
      // Same lifecycle — chart.remove() disposed the volume-profile primitive too.
      volumeProfilePrimitiveRef.current = null;
      volumeSeriesRef.current = null;
      setChartReady(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * SPY volume backfill — merges SPY 1m volume onto SPX bars (idempotent; the index has no
   * native tape volume, see mergeSpyVolumeRows). Polls every SPY_VOLUME_BACKFILL_MS rather
   * than running once at mount: /api/market/vector/spy-volume?ymd=... only ever returns
   * CLOSED Polygon minute bars (the currently-forming bar has no row yet), so a mount-only
   * fetch permanently misses the volume for every bar that closes AFTER that one call —
   * confirmed live: the histogram silently stopped updating for the rest of the session
   * after initial page load, contradicting the "live SPY volume" pane the page advertises.
   * Each poll re-fetches the whole day fresh from Polygon (no caching in fetchSpyVolumeRows)
   * and mergeSpyVolumeRows only touches bars with a newly-available positive volume, so
   * repeated polling is safe/idempotent — this just picks up each newly-closed bar's volume
   * as the session progresses, same cadence as spyVolumeForMinuteBar's own 55s server cache.
   */
  useEffect(() => {
    if (!chartReady || ticker !== "SPX" || hideVolumePaneRef.current) return;
    let cancelled = false;
    const backfill = async () => {
      try {
        const res = await fetch(
          `/api/market/vector/spy-volume?ymd=${encodeURIComponent(sessionYmd)}`
        );
        if (!res.ok || cancelled) return;
        const data = (await res.json()) as {
          volumes?: Array<{ time: number; volume: number }>;
        };
        if (!data.volumes?.length || cancelled) return;
        const merged = mergeSpyVolumeRows(minuteBarsRef.current, data.volumes);
        if (!merged.some((b) => b.volume != null && b.volume > 0)) return;
        minuteBarsRef.current = merged;
        setSessionBars(merged);
        // REPLAY GUARD: this poll fires every 60s regardless of mode. Painting here
        // with no cursorTime slice repaints the FULL live bar array — during replay
        // that silently leaks every bar through "now" onto a chart whose clock label
        // still reads the cursor time (the exact 2026-07-07 leak, re-entering through
        // this effect). Merge into refs/state above is safe and wanted (post-replay
        // display picks it up); the paint must be live-mode only.
        if (replayModeRef.current) return;
        const display = displayBarsFromMinute(merged, timeframeRef.current);
        // BUG 2: this is a purely BACKGROUND re-seed (fires every 60s). Preserve the member's
        // zoom/pan across it — a plain applyDisplayBars/fitContent here is what made the zoom
        // "flash and reset" once a minute. The helper restores the prior viewport, or follows
        // live if the chart was at the edge.
        applyDisplayBarsPreservingView(
          chartRef.current,
          seriesRef.current!,
          volumeSeriesRef.current,
          display,
          liveFollowEnabledRef.current
        );
        paintOverlays(display);
      } catch {
        /* best-effort */
      }
    };
    void backfill();
    const interval = setInterval(backfill, SPY_VOLUME_BACKFILL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [chartReady, sessionYmd, ticker, paintOverlays]);

  useEffect(() => {
    if (!replayMode || !playing || timelineRef.current.length === 0) {
      stopReplayTimer();
      return;
    }
    replayTimerRef.current = setInterval(() => {
      const next = cursorIndexRef.current + 1;
      if (next >= timelineRef.current.length) {
        if (replayLoop) {
          const t0 = timelineRef.current[0]!;
          applyFrame(t0, minuteBarsRef.current, wallHistoryRef.current, lensRef.current);
          cursorIndexRef.current = 0;
          setCursorIndex(0);
          return;
        }
        setPlaying(false);
        return;
      }
      const t = timelineRef.current[next]!;
      applyFrame(t, minuteBarsRef.current, wallHistoryRef.current, lensRef.current);
      cursorIndexRef.current = next;
      setCursorIndex(next);
    }, REPLAY_STEP_MS / Math.max(0.25, replaySpeed));

    return stopReplayTimer;
  }, [replayMode, playing, replaySpeed, replayLoop, applyFrame, stopReplayTimer]);

  const replayTimeline = buildReplayTimeline(sessionHistory, sessionBars);
  const canReplay = replayTimeline.length > 1;

  const enterReplay = () => {
    // The SSE connection stays OPEN during replay — the handler keeps accumulating
    // bars/history/events into refs (so nothing is lost while browsing) and gates
    // every paint on replayModeRef. Set the ref synchronously: an SSE message can
    // arrive between this render being scheduled and the sync effect running, and
    // an un-gated paint here would overwrite the frame drawn below.
    replayModeRef.current = true;
    timelineRef.current = replayTimeline;
    setReplayMode(true);
    setPlaying(false);
    cursorIndexRef.current = 0;
    setCursorIndex(0);
    if (replayTimeline.length > 0) {
      applyFrame(replayTimeline[0]!, minuteBarsRef.current, wallHistoryRef.current, lens);
    }
  };

  const exitReplay = () => {
    stopReplayTimer();
    replayModeRef.current = false;
    setReplayMode(false);
    setPlaying(false);
    const bars = minuteBarsRef.current;
    const display = displayBarsFromMinute(bars, timeframeRef.current);
    displayBarTimeRef.current = display[display.length - 1]?.time ?? 0;
    if (seriesRef.current) {
      applyDisplayBars(seriesRef.current, volumeSeriesRef.current, display);
      paintOverlays(display);
    }
    const history = wallHistoryRef.current;
    refreshTrails(lens);
    const tail = history[history.length - 1]?.time ?? 0;
    refreshOverlays(
      lens,
      wallsAtReplayTime(history, tail, "gex") ?? initialWalls,
      wallsAtReplayTime(history, tail, "vex") ?? initialVexWalls,
      flipAtReplayTime(history, tail, "gex") ?? initialGammaFlip,
      flipAtReplayTime(history, tail, "vex") ?? initialVexFlip,
      darkPoolRef.current
    );
    // User-initiated transition (member clicked out of replay back to live): a refit to the
    // full live range is the expected reset here, not a background update — so fitContent is
    // correct and intentionally NOT routed through the viewport-preserving path.
    chartRef.current?.timeScale().fitContent();
    // Connection was kept open through replay; only reconnect if it actually dropped.
    if (!connRef.current) connectLive();
  };

  const toggleReplay = () => {
    if (replayMode) exitReplay();
    else enterReplay();
  };

  const scrubTo = (index: number) => {
    setPlaying(false);
    const clamped = clampTimelineIndex(timelineRef.current, index);
    cursorIndexRef.current = clamped;
    setCursorIndex(clamped);
    const t = timelineRef.current[clamped];
    if (t != null) applyFrame(t, minuteBarsRef.current, wallHistoryRef.current, lens);
  };

  const stepReplay = (delta: number) => {
    setPlaying(false);
    const clamped = clampTimelineIndex(timelineRef.current, cursorIndexRef.current + delta);
    const t = timelineRef.current[clamped];
    if (t != null) applyFrame(t, minuteBarsRef.current, wallHistoryRef.current, lensRef.current);
    cursorIndexRef.current = clamped;
    setCursorIndex(clamped);
  };

  const jumpReplayOpen = () => {
    scrubTo(timelineIndexAtOrAfterEtClock(timelineRef.current, sessionYmd, 9, 30));
  };

  const jumpReplayClose = () => {
    scrubTo(timelineIndexAtOrBeforeEtClock(timelineRef.current, sessionYmd, 16, 0));
  };

  useEffect(() => {
    if (!replayMode) return;
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;
      if (e.key === "Escape") {
        e.preventDefault();
        toggleReplay();
        return;
      }
      if (e.key === " " || e.code === "Space") {
        e.preventDefault();
        setPlaying((p) => !p);
        return;
      }
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        stepReplay(-1);
        return;
      }
      if (e.key === "ArrowRight") {
        e.preventDefault();
        stepReplay(1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [replayMode]);

  const stepCount = replayMode ? timelineRef.current.length : replayTimeline.length;
  const cursorTime = timelineRef.current[cursorIndex] ?? 0;
  const clockLabel = cursorTime ? formatReplayClock(cursorTime) : "—";

  // Honesty label: any modeled (reconstructed) bead currently in the trail means the member is
  // looking at a mix of modeled + recorded structure — say so explicitly. As live observed
  // samples overwrite the modeled buckets (mergeWallHistory in the SSE handler drops the modeled
  // flag), a fully-observed trail flips this false and the caption disappears on its own.
  const hasModeledBeads = sessionHistory.some((s) => s.modeled === true);
  const showGexHeatmapReconstructedChip = indicators.has("gex-heatmap");

  useEffect(() => {
    if (replayMode) {
      // Lens buttons stay enabled in replay; without a repaint the toolbar/legend
      // switch to the new lens while the drawn walls/beads/flip stay on the OLD
      // lens until the next scrub. Redraw the current frame under the new lens.
      const t = timelineRef.current[cursorIndexRef.current];
      if (t != null) applyFrame(t, minuteBarsRef.current, wallHistoryRef.current, lens);
      return;
    }
    refreshTrails(lens);
    refreshOverlays(
      lens,
      liveGexWalls(),
      vexWallsRef.current,
      liveGammaFlip(),
      vexFlipRef.current,
      darkPoolRef.current
    );
  }, [lens, replayMode, refreshTrails, refreshOverlays, applyFrame, liveGexWalls, liveGammaFlip]);

  useEffect(() => {
    const series = seriesRef.current;
    const chart = chartRef.current;
    if (!series) return;
    if (replayMode) {
      // This effect also re-fires on entering/exiting replay (replayMode is a dep) —
      // e.g. right after enterReplay()'s own applyFrame(replayTimeline[0], ...) call.
      // Re-deriving display bars from the FULL live minuteBarsRef.current (as the live
      // branch below does) would immediately overwrite that correctly cursor-sliced
      // frame with every bar through "now", including bars after the replay cursor —
      // leaking live/future price action into a view whose clock label still reads the
      // earlier cursor time. Route through applyFrame so the slice stays honest.
      applyFrame(cursorTime, minuteBarsRef.current, wallHistoryRef.current, lensRef.current);
    } else {
      const display = displayBarsFromMinute(minuteBarsRef.current, timeframe);
      displayBarTimeRef.current = display[display.length - 1]?.time ?? 0;
      // This effect re-runs not only on a real timeframe switch but whenever one of its
      // callback deps (refreshTrails/refreshOverlays/applyFrame/liveGexWalls/liveGammaFlip) or
      // liveSession changes identity. Those re-runs must NOT wipe the member's zoom/pan — that
      // was the reported "zoom flashes and resets to the default view" bug. So we only fitContent
      // on a GENUINE timeframe change; otherwise we snapshot the visible logical range and
      // restore it across the setData (unless the chart is following the live edge, where
      // maybeScrollToLive below keeps the existing follow behavior instead).
      const timeframeChanged = timeframe !== lastFittedTimeframeRef.current;
      const timeScale = chart?.timeScale() ?? null;
      const following = chart ? chartIsFollowingLive(chart) : false;
      const sessionOverview = wantsSessionOverviewViewport(
        defaultChartViewportRef.current,
        liveFollowEnabledRef.current
      );
      const viewportLocked = memberViewportLocked(
        chartUserPannedRef.current,
        wheelZoomCooldownRef.current
      );
      const prevRange =
        timeScale && !timeframeChanged && !following && (!sessionOverview || viewportLocked)
          ? timeScale.getVisibleLogicalRange()
          : null;
      applyDisplayBars(series, volumeSeriesRef.current, display);
      paintOverlays(display);
      lastDisplayBarsRef.current = display;
      if (timeframeChanged) {
        // Re-fit the time scale to the new bar COUNT. A higher timeframe has far fewer bars (a 6.5h
        // session ≈ 390 1m bars but only ~26 at 15m), and lightweight-charts keeps the previous
        // per-bar pixel spacing — so without a refit those few bars stay crammed into the right edge
        // with a huge empty gap on the left, and the price-following overlays (VWAP/EMA/SMA) get
        // squished into that sliver and look absent. fitContent recomputes the spacing so the bars —
        // and their overlays — fill the chart width at every timeframe. This is the deliberate,
        // user-expected refit; the create effect is the only other deliberate first-load refit.
        if (sessionOverview) {
          applySessionOverviewViewport(chart!, display);
          chart?.timeScale().applyOptions({ shiftVisibleRangeOnNewBar: false });
        } else {
          chart?.timeScale().fitContent();
        }
        lastFittedTimeframeRef.current = timeframe;
      } else if (sessionOverview && !following && !viewportLocked) {
        // Session overview refit only while the member hasn't taken manual control — background
        // effect re-runs (SSE/wall polls) must not reset a zoom/pan the member set.
        applySessionOverviewViewport(chart!, display);
        chart?.timeScale().applyOptions({ shiftVisibleRangeOnNewBar: false });
      } else if (prevRange && timeScale) {
        // Background re-run: pin the exact viewport the member had so zoom/pan survives.
        timeScale.setVisibleLogicalRange(prevRange);
      }
      refreshTrails(lensRef.current);
      // Repaint the wall GUIDES too: the shown-count (wallCountForTimeframe) changes with the
      // timeframe, so a pure timeframe switch (no lens/tick change) must redraw the call/put
      // price lines — growing the count on an upshift, and clearing the now-extra lines on a
      // downshift. refreshTrails above already rescaled the beads; without this the guides
      // would stay frozen at the previous timeframe's count until the next SSE tick.
      refreshOverlays(
        lensRef.current,
        liveGexWalls(),
        vexWallsRef.current,
        liveGammaFlip(),
        vexFlipRef.current,
        darkPoolRef.current
      );
      if (liveSession) {
        maybeScrollToLive(chart, liveFollowEnabledRef.current);
      }
    }
    chart?.timeScale().applyOptions({ secondsVisible: timeframe === 1 });
    // cursorTime intentionally omitted: scrubTo/stepReplay/the replay timer already call
    // applyFrame imperatively on every cursor change, so re-running this effect for that
    // too would just double the work; it only needs the CURRENT cursorTime on the renders
    // where timeframe/replayMode/liveSession actually change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timeframe, replayMode, liveSession, refreshTrails, refreshOverlays, applyFrame, liveGexWalls, liveGammaFlip]);

  const handleLens = (next: VectorWallLens) => {
    if (next === "vex" && !vexAvailable) return;
    setLens(next);
  };

  return (
    <div className="vector-chart-wrap">
      {!sessionBars.length && (
        <p className="mb-3 font-mono text-xs text-sky-300">
          No SPX session bars available yet — wall beads, flip, and dark-pool levels load when data is present.
        </p>
      )}

      <VectorToolbar
        interval={timeframe}
        onInterval={setTimeframe}
        timeframeDisabled={replayMode}
        lens={lens}
        vexAvailable={vexAvailable}
        onLens={handleLens}
        dteHorizon={dteHorizon}
        onDteHorizon={(h) => setDteHorizon(normalizeDteHorizon(h))}
        dteAvailable={dteAvailable}
        gexAsOf={gexAsOf}
        vexAsOf={vexAsOf}
        liveSession={liveSession && !replayMode}
        replayMode={replayMode}
        playing={playing}
        canReplay={canReplay}
        cursorIndex={cursorIndex}
        stepCount={stepCount}
        clockLabel={clockLabel}
        speed={replaySpeed}
        loop={replayLoop}
        onToggleReplay={toggleReplay}
        onTogglePlay={() => setPlaying((p) => !p)}
        onScrub={scrubTo}
        onSpeed={setReplaySpeed}
        onStep={stepReplay}
        onJumpOpen={jumpReplayOpen}
        onJumpClose={jumpReplayClose}
        onToggleLoop={() => setReplayLoop((v) => !v)}
        indicators={indicators}
        onToggleIndicator={toggleIndicator}
        onClearIndicators={clearIndicators}
        barCount={displayBarCount}
        openingRangeMinutes={openingRangeMinutes}
        onOpeningRangeMinutes={setOpeningRangeMinutes}
        leadSlot={leadSlot}
        replayLeadSlot={replayLeadSlot}
        trailSlot={trailSlot}
        hideLinkedControls={toolbarHideLinkedControls}
        comparePane={toolbarHideLinkedControls}
      />

      {/* Regime banner sits directly above the canvas (passed in from the shell) so it still leads
          the chart, without a tall page-level header block eating chart height. */}
      {regimeSlot ? <div className="mb-2">{regimeSlot}</div> : null}

      <div
        ref={chartStageRef}
        className={clsx("relative vector-chart-stage", chartFullscreen && "vector-chart-stage--fullscreen")}
      >
        {chartFullscreen ? (
          <button
            type="button"
            className="ios-chart-fullscreen-exit"
            onClick={exitFullscreen}
            aria-label="Exit fullscreen chart"
          >
            ✕
          </button>
        ) : null}
        <VectorCrosshairLegend state={crosshair} ticker={ticker} />
        <p className="pointer-events-none absolute bottom-2 left-2 z-10 font-mono text-[10px] uppercase tracking-wide text-sky-300">
          SPY vol
        </p>
        {/* Honesty label — visible whenever any modeled (reconstructed) bead is on screen, absent
            once the trail is fully observed. Matches the SPY-vol caption's font-mono/opacity style. */}
        {hasModeledBeads && (
          <p className="pointer-events-none absolute bottom-2 right-2 z-10 font-mono text-[10px] uppercase tracking-wide text-sky-300/70">
            ◇ dim = modeled · ● solid = recorded
          </p>
        )}
        {showGexHeatmapReconstructedChip && (
          <p
            className={`pointer-events-none absolute z-10 font-mono text-[10px] uppercase tracking-wide text-emerald-400/80 ${
              hasModeledBeads ? "bottom-8 right-2" : "bottom-2 right-2"
            }`}
          >
            ◇ {vectorHeatmapScopeLabel(dteHorizon)} · spot-aligned
          </p>
        )}
        <div
          ref={containerRef}
          className={clsx("vector-chart-canvas", fillHost && "vector-chart-canvas--fill-host")}
          style={
            fillHost
              ? undefined
              : { height: "calc(100vh - 132px)", minHeight: 520 }
          }
          aria-busy={liveSession && !replayMode}
        />
      </div>
    </div>
  );
}
