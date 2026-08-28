"use client";

import type { VectorNodeDensity } from "@/features/vector/lib/vector-node-density";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { clsx } from "clsx";
import { PageShell, FreshnessChip } from "@/components/ui";
import { ProductMark } from "@/components/marks/ProductMark";
import { IosNativeSegment } from "@/components/ios/IosNativeSegment";
import { useIosNativeShell } from "@/hooks/useIosNativeShell";
import { useCompactDeskPanels } from "@/hooks/useCompactDeskPanels";
import type { VectorBar } from "@/features/vector/components/VectorChart";
import type { PlayLevelsInput } from "@/features/vector/lib/vector-play-levels";
import type { FlowAlert, VectorDarkPoolLevel, VectorWalls } from "@/lib/api";
import { VectorHelixRail } from "@/features/vector/components/VectorHelixRail";
import { useVectorHelixFlows } from "@/features/vector/lib/use-vector-helix-flows";
import { flowAlertTimeSec } from "@/features/vector/lib/vector-flow-confluence";
import { VectorPlayCard } from "@/features/vector/components/VectorPlayCard";
import { VectorContractPicksCard } from "@/features/vector/components/VectorContractPicksCard";
import { useVectorActionablePicks } from "@/features/vector/lib/use-vector-actionable-picks";
import { VectorPlayIntelStrip } from "@/features/vector/components/VectorPlayIntelStrip";
import { VectorPlayAnalyticsDrawer } from "@/features/vector/components/VectorPlayAnalyticsDrawer";
import { VectorReplayPlayGate } from "@/features/vector/components/VectorReplayPlayGate";
import type { VectorPlay, VectorPlayEmit } from "@/features/vector/lib/vector-play-engine";
import { bootstrapVectorPlayEmit } from "@/features/vector/lib/vector-play-bootstrap";
import type { VectorPlayDeskSnapshot } from "@/features/vector/lib/vector-play-desk-snapshot";
import { VectorOdteMatrixRail } from "@/features/vector/components/VectorOdteMatrixRail";
import { VectorRegimeBanner } from "@/features/vector/components/VectorRegimeBanner";
import { VectorAlertsBell } from "@/features/vector/components/VectorAlertsBell";
import type { AlertRule, AlertKind, FiredAlert } from "@/features/vector/lib/vector-alerts";
import { loadAlertRules, saveAlertRules, buildAlertRule, loadNotifyEnabled, saveNotifyEnabled } from "@/features/vector/lib/vector-alerts-store";
import { notificationForFire, shouldSystemNotify } from "@/features/vector/lib/vector-notify";
import { enableVectorNotifications, notifyPermission, presentSystemNotification } from "@/features/vector/lib/vector-notify-client";
import { deriveVectorRegime, type VectorRegime } from "@/features/vector/lib/vector-regime";
import { deriveWallProximity, type WallProximity } from "@/features/vector/lib/vector-wall-proximity";
import { deriveGammaMagnet, type GammaMagnet } from "@/features/vector/lib/vector-gamma-magnet";
import { scoreTopWalls, type WallIntegrity } from "@/features/vector/lib/vector-wall-integrity";
import type { VectorWallEvent } from "@/features/vector/lib/vector-wall-events";
import type { WallHistorySample, VectorWallLens } from "@/features/vector/lib/vector-wall-history";
import { VECTOR_DEFAULT_DTE_HORIZON, type VectorDteHorizon } from "@/features/vector/lib/vector-dte-horizon";
import type { VectorPriceScaleMap } from "@/features/vector/lib/vector-price-scale-map";
import type { VectorTimeframeMinutes } from "@/features/vector/lib/vector-bar-timeframes";
import { VectorTickerSelect } from "@/features/vector/components/VectorTickerSelect";
import { VectorTickerComparisonStrip } from "@/features/vector/components/VectorTickerComparisonStrip";
import { VectorScanner } from "@/features/vector/components/VectorScanner";
import {
  vectorPanelVisibility,
  shouldExitFocusMode,
  shouldToggleFocusMode,
  focusModeAvailable,
  focusModeContentClass,
} from "@/features/vector/lib/vector-focus-mode";
import { VECTOR_DEFAULT_TICKER } from "@/features/vector/lib/vector-ticker";

const VectorChart = dynamic(
  () => import("@/features/vector/components/VectorChart").then((m) => m.VectorChart),
  {
    ssr: false,
    loading: () => (
      <div
        className="flex min-h-[clamp(560px,80vh,980px)] items-center justify-center rounded-xl border border-cyan-500/20 bg-black/40 text-sm text-cyan-300"
        role="status"
        aria-live="polite"
      >
        Loading chart…
      </div>
    ),
  }
);

const CANDLE_STALE_MS = 10_000;

type Props = {
  ticker: string;
  initialBars: VectorBar[];
  initialWalls: VectorWalls | null;
  initialVexWalls: VectorWalls | null;
  initialWallHistory: WallHistorySample[];
  initialHorizonWallHistory?: WallHistorySample[];
  initialGammaFlip: number | null;
  initialVexFlip: number | null;
  initialDarkPoolLevels: VectorDarkPoolLevel[];
  sessionYmd: string;
  liveSession: boolean;
  /** Server-resolved bead bucket size (5s shared universe, 15s on-demand). */
  initialWallTrailSec?: number;
  /**
   * Embed seam (2026-07-13, member-directed desk consolidation): "chart-only" renders JUST the
   * Vector chart surface — toolbar (timeframe / DTE toggle / indicators / lens / replay), regime
   * banner, freshness chip, and the alert toast — with NO PageShell wrapper, NO ticker select
   * (the host pins the ticker), NO GEX ladder rail, NO desk terminal, NO alerts panel, and NO
   * universe scanner. Used by the SPX Slayer dashboard, which supplies its own page chrome and
   * explicitly wants a terminal-free desk. Default (undefined) is the full /vector page.
   */
  embed?: "chart-only";
  /** Opening DTE horizon override for host desks (SPX Slayer embed opens on 0DTE; the standalone
   *  /vector page keeps the chart's WEEKLY default). Initial state only — the toggle rules after. */
  defaultDteHorizon?: VectorDteHorizon;
  /** Opening candle interval override (SPX Slayer embed opens on 3-minute candles; standalone
   *  /vector uses `VECTOR_DEFAULT_TIMEFRAME` — also 3-minute). Initial state only. */
  defaultTimeframe?: VectorTimeframeMinutes;
  /** Opening time viewport — "session" fits the full RTH tape + bead trail on load (SPX desk 0DTE);
   *  "live" follows the right edge immediately. Both /vector and SPX Slayer default to session. */
  defaultChartViewport?: "session" | "live";
  /** SHARED PRICE AXIS seam (2026-07-13): forwarded verbatim to VectorChart so a host desk
   *  (SPX Slayer) can align its strike ladder to the chart's live y-scale. Only meaningful
   *  for embeds; the standalone /vector page never sets it. See vector-price-scale-map.ts. */
  onPriceScaleRender?: (map: VectorPriceScaleMap) => void;
  /** PULSE → CHART ANCHOR seam (2026-07-26): a transient focus request from the SPX desk's Pulse
   *  rail, forwarded verbatim to VectorChart so it flashes a highlight line at the event's price.
   *  Meaningful ONLY for the chart-only embed (the SPX desk); the standalone /vector page never
   *  sets it and never receives it. `seq` re-fires the flash on repeat clicks of the same level. */
  focusLevel?: { price: number; label: string; tone: string; seq: number; barTimeSec?: number } | null;
  /** PLAYS ON THE CHART seam (2026-07-26): the member's ACTIVE SPX play (entry/stop/target/
   *  invalidation) mapped to price-lines, forwarded verbatim to VectorChart so its risk levels draw
   *  on the tape. Meaningful ONLY for the chart-only embed (the SPX desk); the standalone /vector
   *  page never sets it and never receives it, so that page stays byte-identical. */
  playLevels?: PlayLevelsInput;
  /** Host-desk slot rendered in the chart toolbar immediately LEFT of the Replay control
   *  (user-directed 2026-07-14: the desk focus toggle lives there after the time bar's removal). */
  toolbarReplayLeadSlot?: React.ReactNode;
  /** Client-side ticker nav (avoids full SSR on every symbol switch). */
  onTickerSelect?: (ticker: string) => void | Promise<void>;
  tickerNavBusy?: boolean;
  /** Enter compare mode with the current ticker (desk only). */
  onEnterCompare?: () => void;
  /** Compare pane: hide TF/DTE/lens in chart toolbar (command bar owns them). */
  toolbarHideLinkedControls?: boolean;
  /** Compare pane: omit volume histogram sub-pane for taller price + beads. */
  hideVolumePane?: boolean;
  /** Compare grid: compact bead rail (smaller, behind candles). */
  compareCompactBeads?: boolean;
  /** Compare pane: lift regime/spot to pane header. */
  onCompareRegimeChange?: (regime: VectorRegime) => void;
  onCompareSpotChange?: (spot: number) => void;
  compareDefaultLens?: VectorWallLens;
  suppressRegimeBanner?: boolean;
  compareSync?: import("@/features/vector/lib/vector-compare-sync").VectorCompareChartSyncBind | null;
  onCompareCrosshair?: (paneId: string, timeSec: number | null) => void;
  onCompareVisibleRange?: (paneId: string, fromSec: number, toSec: number) => void;
  linkedReplay?: import("@/features/vector/lib/vector-compare-replay").VectorLinkedReplayBind | null;
  hideReplayControls?: boolean;
  /** Initial NODES pick, threaded to the chart. Compare panes pass a lower count than the desk. */
  defaultNodeDensity?: VectorNodeDensity;
  onReplayTimeline?: (timeline: number[]) => void;
  compareFourUp?: boolean;
  compareFourUpBackground?: boolean;
  /** Compare grid — forwarded to VectorChart for Shift+1/2/3 zoom shortcuts. */
  comparePane?: boolean;
  compareKeyboardActive?: boolean;
  /** Host desk portal target — renders the Vector toolbar full-width above the desk grid. */
  toolbarPortalEl?: HTMLElement | null;
  /** Compare embed: export play-engine desk state for the focused play strip. */
  onPlayDeskSnapshot?: (snapshot: VectorPlayDeskSnapshot) => void;
};

type VectorIosPanel = "chart" | "pulse" | "ladder" | "scanner" | "plays";

const VECTOR_IOS_PANELS: { id: VectorIosPanel; label: string }[] = [
  { id: "chart", label: "Chart" },
  { id: "plays", label: "Plays" },
  { id: "pulse", label: "Helix" },
  { id: "ladder", label: "Matrix" },
  { id: "scanner", label: "Scanner" },
];

function formatSessionLabel(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d, 17, 0, 0));
  return dt.toLocaleDateString("en-US", {
    timeZone: "America/New_York",
    month: "short",
    day: "numeric",
  });
}

/** /vector page frame — multi-ticker chart + universe scanner. */
export function VectorPageShell({
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
  embed,
  defaultDteHorizon,
  defaultTimeframe,
  defaultChartViewport = "session",
  onPriceScaleRender,
  focusLevel,
  playLevels,
  toolbarReplayLeadSlot,
  onTickerSelect,
  tickerNavBusy,
  onEnterCompare,
  toolbarHideLinkedControls,
  hideVolumePane,
  compareCompactBeads,
  onCompareRegimeChange,
  onCompareSpotChange,
  compareDefaultLens,
  suppressRegimeBanner,
  compareSync = null,
  onCompareCrosshair,
  onCompareVisibleRange,
  linkedReplay = null,
  hideReplayControls = false,
  defaultNodeDensity,
  onReplayTimeline,
  compareFourUp = false,
  compareFourUpBackground = false,
  comparePane = false,
  compareKeyboardActive = true,
  toolbarPortalEl: hostToolbarPortalEl = null,
  onPlayDeskSnapshot,
}: Props) {
  const chartOnly = embed === "chart-only";
  const router = useRouter();
  const nativeShell = useIosNativeShell();
  const compactPanels = useCompactDeskPanels(nativeShell);
  const pageToolbarPortalRef = useRef<HTMLDivElement>(null);
  const [pageToolbarPortalEl, setPageToolbarPortalEl] = useState<HTMLElement | null>(null);
  useLayoutEffect(() => {
    if (chartOnly || hostToolbarPortalEl) return;
    setPageToolbarPortalEl(pageToolbarPortalRef.current);
  }, [chartOnly, hostToolbarPortalEl]);
  const toolbarPortalEl = hostToolbarPortalEl ?? pageToolbarPortalEl;
  const [iosPanel, setIosPanel] = useState<VectorIosPanel>("chart");
  const sessionLabel = formatSessionLabel(sessionYmd);
  const [streamUpdatedAt, setStreamUpdatedAt] = useState<number | null>(null);
  const [wallEvents, setWallEvents] = useState<VectorWallEvent[]>([]);
  const [lens, setLens] = useState<VectorWallLens>("gex");
  // Mirror the chart's DTE horizon so the GEX ladder re-scopes to the same expiries the walls use.
  // Must match VectorChart's default (0DTE, or the host's defaultDteHorizon override) — this
  // copy drives the GEX ladder's scope label + fetch. When it defaulted to "all" while the chart
  // scoped weekly, the ladder's first paint showed the near-term aggregate against a mismatched
  // chart until hydration converged them.
  const [dteHorizon, setDteHorizon] = useState<VectorDteHorizon>(
    defaultDteHorizon ?? VECTOR_DEFAULT_DTE_HORIZON
  );
  // Live Helix → chart strike flash (same seq pattern as SPX Pulse → chart focusLevel).
  const [chartFocus, setChartFocus] = useState<{
    price: number;
    label: string;
    tone: string;
    seq: number;
    barTimeSec?: number;
  } | null>(null);
  const pushHelixChartFocus = useCallback((flow: FlowAlert) => {
    if (typeof flow.strike !== "number" || !Number.isFinite(flow.strike)) return;
    const isCall = flow.option_type?.toUpperCase() === "CALL";
    const barTimeSec = flowAlertTimeSec(flow);
    setChartFocus((prev) => ({
      price: flow.strike,
      label: `${flow.strike}${isCall ? "C" : "P"}`,
      tone: isCall ? "bull" : "bear",
      seq: (prev?.seq ?? 0) + 1,
      ...(barTimeSec != null ? { barTimeSec } : {}),
    }));
  }, []);
  const handleHelixStrikeFocus = useCallback(
    (strike: number, flow: FlowAlert) => {
      pushHelixChartFocus({ ...flow, strike });
    },
    [pushHelixChartFocus]
  );
  const handleHelixFlowFlash = useCallback(
    (flow: FlowAlert) => {
      pushHelixChartFocus(flow);
    },
    [pushHelixChartFocus]
  );
  const handleMatrixStrikeFocus = useCallback((strike: number) => {
    setChartFocus((prev) => ({
      price: strike,
      label: String(strike),
      tone: "sky",
      seq: (prev?.seq ?? 0) + 1,
    }));
  }, []);
  const [scannerOpen, setScannerOpen] = useState(false);
  // FOCUS MODE (member ask 2026-08-18): chart fills the viewport, every side rail UNMOUNTS. See
  // vector-focus-mode.ts for why unmounting (not CSS-hiding) is the rule — the rails poll and
  // subscribe, and leaving them alive behind a fullscreen chart spends frame budget on panels
  // nobody can see.
  const [focusMode, setFocusMode] = useState(false);
  const [playAnalyticsOpen, setPlayAnalyticsOpen] = useState(false);
  /** True while VectorChart is in session replay — play engine + live pick polls pause. */
  const [chartReplayMode, setChartReplayMode] = useState(false);
  const handleReplayModeChange = useCallback((active: boolean) => {
    setChartReplayMode(active);
  }, []);
  const panels = vectorPanelVisibility(focusMode);
  const activeTicker = ticker || VECTOR_DEFAULT_TICKER;
  const helixState = useVectorHelixFlows(activeTicker, liveSession, handleHelixFlowFlash);
  const navigateTicker = useCallback(
    (t: string) => {
      if (onTickerSelect) {
        void onTickerSelect(t);
        return;
      }
      router.push(t === VECTOR_DEFAULT_TICKER ? "/vector" : `/vector?ticker=${encodeURIComponent(t)}`);
    },
    [onTickerSelect, router]
  );
  useEffect(() => {
    if (!compactPanels) return;
    try {
      const saved = window.sessionStorage.getItem("vector-ios-panel");
      if (saved === "chart" || saved === "pulse" || saved === "ladder" || saved === "scanner" || saved === "plays") {
        setIosPanel(saved);
      }
    } catch {
      /* sessionStorage unavailable */
    }
  }, [compactPanels]);

  const selectIosPanel = useCallback((next: VectorIosPanel) => {
    setIosPanel(next);
    try {
      window.sessionStorage.setItem("vector-ios-panel", next);
    } catch {
      /* best-effort */
    }
  }, []);

  // Seed the regime from the SSR snapshot so the banner is right on first paint;
  // VectorChart streams live updates via onRegimeChange during a session.
  const [regime, setRegime] = useState<VectorRegime>(() =>
    deriveVectorRegime({
      spot: initialBars.length ? initialBars[initialBars.length - 1]!.close : null,
      gammaFlip: initialGammaFlip,
      topCallWall: initialWalls?.callWalls?.[0]?.strike ?? null,
      topPutWall: initialWalls?.putWalls?.[0]?.strike ?? null,
    })
  );
  const [proximity, setProximity] = useState<WallProximity | null>(() =>
    deriveWallProximity({
      spot: initialBars.length ? initialBars[initialBars.length - 1]!.close : null,
      walls: initialWalls,
      gammaFlip: initialGammaFlip,
    })
  );
  const [confluence, setConfluence] = useState<string[] | null>(null);
  // The fused, single concrete trade idea (buildVectorPlay) — null until the chart has emitted its
  // first read (needs a live spot). Rendered above the Pulse rail's raw narration as the "so what do
  // I do" synthesis; VectorPlayCard degrades to nothing when null rather than showing a placeholder.
  const [playEmit, setPlayEmit] = useState<VectorPlayEmit | null>(null);
  const play = playEmit?.play ?? null;
  // Options-implied EXPECTED MOVE callouts (±1σ/2σ range) — narrated by the terminal, horizon-scoped
  // (#15 cone, slice 3a). Empty when the chain has no real ATM IV to price the move.
  const [expectedMove, setExpectedMove] = useState<string[]>([]);
  // Alerts (in-page delivery): the member's rules (persisted per ticker), recent fires (for the
  // panel + terminal), and the transient toast for the newest fire.
  const [alertRules, setAlertRules] = useState<AlertRule[]>([]);
  const [recentAlerts, setRecentAlerts] = useState<FiredAlert[]>([]);
  const [toast, setToast] = useState<FiredAlert | null>(null);
  // OS-notification opt-in for this device (delivery slice 2). `notifyEnabled` is the member's
  // intent (persisted); `notifyPerm` mirrors the browser permission so the panel can show the real
  // state (granted / denied / needs-prompt). Both are read after mount to stay SSR-safe.
  const [notifyEnabled, setNotifyEnabled] = useState(false);
  const [notifyPerm, setNotifyPerm] = useState<NotificationPermission>("default");
  const [magnet, setMagnet] = useState<GammaMagnet | null>(() =>
    deriveGammaMagnet({
      spot: initialBars.length ? initialBars[initialBars.length - 1]!.close : null,
      walls: initialWalls,
      posture: deriveVectorRegime({
        spot: initialBars.length ? initialBars[initialBars.length - 1]!.close : null,
        gammaFlip: initialGammaFlip,
        topCallWall: initialWalls?.callWalls?.[0]?.strike ?? null,
        topPutWall: initialWalls?.putWalls?.[0]?.strike ?? null,
      }).posture,
    })
  );
  const [wallIntegrity, setWallIntegrity] = useState<{
    call: WallIntegrity | null;
    put: WallIntegrity | null;
  }>(() => scoreTopWalls(initialWalls, initialWallHistory));
  // Live spot price from chart's SSE stream — passed to GEX ladder so it updates every second
  // instead of polling every 15s. Null until the first candle arrives.
  const [liveSpot, setLiveSpot] = useState<number | null>(
    initialBars.length ? initialBars[initialBars.length - 1]!.close : null
  );
  // BUG FIX (2026-08-27): liveSpot was never reset on a ticker switch, so a stale price from the
  // PREVIOUS ticker kept being passed as VectorOdteMatrixRail's `liveSpot` prop (which it prefers
  // over its own ticker-scoped fetch: `liveSpot ?? data?.spot ?? initialSpot`) until the new
  // ticker's first live tick arrived. That window — a fresh SSE reconnect plus first candle, up to
  // several seconds — showed the matrix rail's spot row / King-strike / wall highlighting computed
  // against a DIFFERENT ticker's price entirely; if the two tickers don't share a strike range, the
  // "spot" row pins to whatever real-but-meaningless strike happens to be closest to the leftover
  // number. Nulling here on ticker change lets the rail correctly fall back to its own fetched
  // spot for the new ticker, mirroring the alert-rules reset a few lines below.
  useEffect(() => {
    setLiveSpot(initialBars.length ? initialBars[initialBars.length - 1]!.close : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- ticker switch only, mirrors the alert-rules reset below
  }, [activeTicker]);

  // LADDER↔CHART BAND (2026-08-09). The measured bug: on NVDA the ladder spanned 162.5→300 while
  // the chart's price axis spanned ~197.5→247.5. Same instrument, two unrelated scales, so finding
  // a level meant scrolling a rail that had nothing to do with what the chart was showing.
  //
  // The fix reuses the SHARED PRICE AXIS seam built for the SPX desk rather than adding a second
  // one: `onPriceScaleRender` already reports the chart's live visible price range, already
  // throttled (~250ms leading+trailing) and already change-gated, so this costs one extra setState
  // per meaningful zoom/pan and nothing at all while the tape is quiet. VectorChart is untouched.
  const [chartPriceBand, setChartPriceBand] = useState<{ min: number; max: number } | null>(null);
  const handlePriceScaleRender = useCallback((map: VectorPriceScaleMap) => {
    setChartPriceBand((prev) =>
      prev && prev.min === map.rangeMin && prev.max === map.rangeMax
        ? prev // identity-stable so the ladder doesn't re-render on pane resize/scroll alone
        : { min: map.rangeMin, max: map.rangeMax }
    );
  }, []);
  const priceBand = chartPriceBand;

  // Load the member's saved alert rules whenever the ticker changes (and clear the recent history so
  // one ticker's fires don't bleed into another). Persisted per ticker in localStorage.
  useEffect(() => {
    setAlertRules(loadAlertRules(activeTicker));
    setRecentAlerts([]);
    setToast(null);
  }, [activeTicker]);

  // BUG FIX (2026-08-27): playEmit/expectedMove/confluence are populated by VectorChart callbacks
  // but live in THIS parent — reset on ticker switch so the play card never shows stale levels.
  // Seed immediately from bootstrap walls/spot so the play rail is not blank for 5–15s while
  // lightweight-charts mounts (on-demand tickers, SPX index cold load).
  useEffect(() => {
    setExpectedMove([]);
    setConfluence(null);
    setPlayAnalyticsOpen(false);
    const spot = initialBars.length ? initialBars[initialBars.length - 1]!.close : null;
    setPlayEmit(
      bootstrapVectorPlayEmit({
        ticker: activeTicker,
        horizon: dteHorizon,
        timeframeMin: defaultTimeframe ?? 3,
        spot,
        walls: initialWalls,
        gammaFlip: initialGammaFlip,
        darkPoolLevels: initialDarkPoolLevels,
      })
    );
  }, [
    activeTicker,
    initialBars,
    initialWalls,
    initialGammaFlip,
    initialDarkPoolLevels,
    dteHorizon,
    defaultTimeframe,
  ]);

  useEffect(() => {
    if (!onPlayDeskSnapshot) return;
    onPlayDeskSnapshot({
      playEmit,
      regime,
      expectedMove,
      confluence,
      wallIntegrity,
      magnet,
      proximity,
      chartReplayMode,
      helixFlows: helixState.flows,
    });
  }, [
    onPlayDeskSnapshot,
    playEmit,
    regime,
    expectedMove,
    confluence,
    wallIntegrity,
    magnet,
    proximity,
    chartReplayMode,
    helixState.flows,
  ]);

  // Auto-dismiss the toast a few seconds after the newest fire.
  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), 6000);
    return () => clearTimeout(id);
  }, [toast]);

  // F toggles focus mode; Escape exits when fullscreen. Desktop web only.
  const canFocusMode = focusModeAvailable({ chartOnly, nativeShell });
  const focusModeRef = useRef(focusMode);
  focusModeRef.current = focusMode;
  useEffect(() => {
    if (!canFocusMode) return;
    const onKey = (e: KeyboardEvent) => {
      if (shouldExitFocusMode(e) && focusModeRef.current) {
        setFocusMode(false);
        return;
      }
      if (shouldToggleFocusMode(e, true)) {
        setFocusMode((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [canFocusMode]);

  // Never strand a member in a fullscreen chart with no exit: if the surface stops offering focus
  // mode under them (iOS shell hydrates, or the desk re-renders as an embed), drop out of it.
  useEffect(() => {
    if (!canFocusMode && focusMode) setFocusMode(false);
  }, [canFocusMode, focusMode]);

  // Hydrate the OS-notification opt-in + live browser permission after mount (localStorage/Notification
  // are client-only). If the member had opted in but later revoked permission in the browser, the
  // panel reflects that mismatch rather than silently pretending alerts will ring.
  useEffect(() => {
    setNotifyEnabled(loadNotifyEnabled());
    setNotifyPerm(notifyPermission());
  }, []);

  // Toggle OS notifications for this device. Enabling prompts for permission (and opportunistically
  // registers a web-push subscription when VAPID is configured — inert otherwise). We only persist
  // the opt-in when permission actually lands 'granted', so a dismissed/denied prompt doesn't leave
  // the toggle stuck "on" with no way for banners to fire.
  // useCallback here (not just an inline function): VectorAlertsBell/GexShiftLeadersStrip are
  // React.memo'd specifically to skip the ~1Hz liveSpot re-render churn (SSE spot ticks) — a plain
  // function expression would hand memo a fresh identity every render and silently defeat it.
  const handleToggleNotify = useCallback(async () => {
    if (notifyEnabled) {
      setNotifyEnabled(false);
      saveNotifyEnabled(false);
      return;
    }
    const perm = await enableVectorNotifications();
    setNotifyPerm(perm);
    const on = perm === "granted";
    setNotifyEnabled(on);
    saveNotifyEnabled(on);
  }, [notifyEnabled]);

  const persistRules = useCallback(
    (next: AlertRule[]) => {
      setAlertRules(next);
      saveAlertRules(activeTicker, next);
      // Best-effort SERVER mirror (task: server-side wall-touch/flip-cross delivery). localStorage
      // above is still the source of truth for this tab's in-page experience — a failed/slow sync
      // here must never block or break it, so it's fire-and-forget with the error swallowed.
      //
      // WHAT THE MIRROR IS FOR, AND WHAT IT IS NOT DOING TODAY. `/api/cron/vector-alerts` reads
      // this copy to push alerts to a CLOSED tab. That cron is dormant on two independent counts,
      // both verified 2026-08-22: it has no deployed EventBridge rule, and `VECTOR_ALERTS_PUSH` is
      // not set in production, so the route self-reports `{ok:true, inert:true}` even when called
      // by hand. Nothing member-facing is broken by that — the alerts panel only ever offers
      // delivery "while this tab is in the background", never closed-tab — but this comment used
      // to state the closed-tab behaviour as a live guarantee, which it is not. Keep writing the
      // mirror: it is what makes turning the feature on a config decision rather than a rebuild.
      // See docs/audit/VECTOR-MAP.md section 7.
      fetch("/api/vector/alerts/rules", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ticker: activeTicker, rules: next }),
      }).catch(() => {
        /* best-effort — local experience is unaffected */
      });
    },
    [activeTicker]
  );
  const handleAddRule = useCallback(
    (kind: AlertKind, tolerancePct?: number) =>
      persistRules([...alertRules, buildAlertRule(alertRules, activeTicker, kind, tolerancePct)]),
    [alertRules, activeTicker, persistRules]
  );
  const handleToggleRule = useCallback(
    (id: string) => persistRules(alertRules.map((r) => (r.id === id ? { ...r, enabled: !r.enabled } : r))),
    [alertRules, persistRules]
  );
  const handleRemoveRule = useCallback(
    (id: string) => persistRules(alertRules.filter((r) => r.id !== id)),
    [alertRules, persistRules]
  );
  const handleAlertsFired = (fired: FiredAlert[]) => {
    if (!fired.length) return;
    setRecentAlerts((prev) => [...fired].reverse().concat(prev).slice(0, 20));
    setToast(fired[fired.length - 1]!);
    // OS notification (slice 2) — only when the member opted in, granted permission, and the tab is
    // HIDDEN. Permission is read live (not the possibly-stale `notifyPerm`) so a mid-session revoke is
    // honoured. When the tab is visible the toast + terminal already cover it; the OS channel is for
    // the tabbed-away case. `tag`-based dedup in the payload collapses repeated ticks at one level.
    const hidden = typeof document !== "undefined" && document.hidden;
    if (shouldSystemNotify({ enabled: notifyEnabled, permission: notifyPermission(), hidden })) {
      for (const f of fired) void presentSystemNotification(notificationForFire(f));
    }
  };

  // Freshness live→stale flips inside FreshnessChip (staleAfterMs) so this shell
  // is NOT re-rendered every second — was a full-tree storm during RTH.
  const freshnessStatus = !liveSession
    ? "cached"
    : streamUpdatedAt == null
      ? "syncing"
      : "live";

  // Compact page title cluster — folded INTO the chart toolbar row (far left) so the header and the
  // timeframe/indicator controls share one line, reclaiming the vertical space the old full-width
  // PageHeader + separate regime block ate. Product decision per member request: maximise chart area.
  const iosCompactChrome = compactPanels && nativeShell;
  /** SPX Slayer iOS embed — spot + gamma chips live in SpxIosMarketStrip above the segment. */
  const spxIosEmbed = chartOnly && nativeShell;
  const chartLead = spxIosEmbed
    ? null
    : chartOnly || iosCompactChrome
      ? chartOnly ? (
        <span className="rounded border border-cyan-500/30 bg-cyan-500/10 px-1.5 py-0.5 font-mono text-[11px] font-bold tracking-widest text-cyan-200">
          {activeTicker}
        </span>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <VectorTickerSelect ticker={activeTicker} onTickerSelect={onTickerSelect ? navigateTicker : undefined} busy={tickerNavBusy} />
        </div>
      )
    : (
      <div className="vector-toolbar-brand flex flex-wrap items-center gap-2 pr-1">
        <ProductMark product="vector" size={22} animated={false} />
        <span className="font-mono text-sm font-bold uppercase tracking-[0.18em] text-cyan-100">Vector</span>
        <VectorTickerSelect ticker={activeTicker} onTickerSelect={onTickerSelect ? navigateTicker : undefined} busy={tickerNavBusy} />
        {onEnterCompare ? (
          <button
            type="button"
            className="vector-compare-enter-btn"
            onClick={onEnterCompare}
            data-testid="vector-enter-compare"
          >
            Compare
          </button>
        ) : null}
        {canFocusMode ? (
          <button
            type="button"
            className="vector-focus-enter-btn"
            onClick={() => setFocusMode((v) => !v)}
            data-testid="vector-focus-toggle"
            aria-pressed={focusMode}
            title={focusMode ? "Exit fullscreen chart (Esc or F)" : "Fullscreen chart — hides side panels (F)"}
          >
            {focusMode ? "Exit full screen" : "Full screen"}
          </button>
        ) : null}
      </div>
    );
  const chartFreshness =
    spxIosEmbed || (chartOnly && suppressRegimeBanner) ? null : (
      <FreshnessChip
        status={freshnessStatus}
        asOf={liveSession && streamUpdatedAt ? new Date(streamUpdatedAt) : null}
        staleAfterMs={liveSession ? CANDLE_STALE_MS : undefined}
        label={liveSession ? "Live session" : `${sessionLabel} close`}
      />
    );
  // Alerts moved off the standalone page and into a bell icon anchored right next to this chip
  // (member: "add a clickable icon next to LIVE SESSION on the top", 2026-08-27) — see
  // VectorAlertsBell for the popover + rationale. Deliberately NOT added to `chartFreshness`
  // itself: that value is also used by the chartOnly SPX Slayer embed (line below), which never
  // rendered a standalone alerts panel either and stays terminal/panel-free by design (member
  // directive, 2026-08-05) — only the full standalone /vector page gets the bell.
  const chartFreshnessWithAlerts =
    chartFreshness == null ? null : (
      <span className="vector-freshness-alerts-group">
        {chartFreshness}
        <VectorAlertsBell
          ticker={activeTicker}
          rules={alertRules}
          recent={recentAlerts}
          onAdd={handleAddRule}
          onToggle={handleToggleRule}
          onRemove={handleRemoveRule}
          notifyEnabled={notifyEnabled}
          notifyPermission={notifyPerm}
          onToggleNotify={handleToggleNotify}
        />
      </span>
    );
  const embedRegimeSlot = spxIosEmbed || suppressRegimeBanner ? null : <VectorRegimeBanner regime={regime} />;

  const handleRegime = useCallback(
    (r: VectorRegime) => {
      setRegime(r);
      onCompareRegimeChange?.(r);
    },
    [onCompareRegimeChange]
  );

  const handleSpot = useCallback(
    (s: number) => {
      setLiveSpot(s);
      onCompareSpotChange?.(s);
    },
    [onCompareSpotChange]
  );

  // Hooks must run unconditionally on every render — this sits ABOVE the chartOnly early return
  // below (react-hooks/rules-of-hooks). The embed path never renders VectorContractPicksCard, but
  // the hook itself still has to fire every render regardless of which branch returns.
  const {
    active: contractPicks,
    closed: closedContractPicks,
    loading: contractPicksLoading,
  } = useVectorActionablePicks(
    activeTicker,
    playEmit,
    helixState.flows,
    liveSession,
    chartReplayMode
  );

  // Chart-only embed (SPX Slayer flagship desk): the SAME VectorChart with the SAME seed props and
  // the SAME toolbar/regime/freshness/toast plumbing — just none of the page chrome or side rails.
  // Saved alert rules for the pinned ticker still evaluate + toast here, so a member's /vector
  // wall-touch alerts keep ringing on the dashboard. Terminal narration is deliberately absent
  // (member-directed: no terminals on SPX Slayer, 2026-07-13).
  if (chartOnly) {
    return (
      <div className="vector-embed-chart-only min-w-0">
        <VectorChart
          key={activeTicker}
          ticker={activeTicker}
          initialBars={initialBars}
          initialWalls={initialWalls}
          initialVexWalls={initialVexWalls}
          initialWallHistory={initialWallHistory}
          initialHorizonWallHistory={initialHorizonWallHistory}
          initialGammaFlip={initialGammaFlip}
          initialVexFlip={initialVexFlip}
          initialDarkPoolLevels={initialDarkPoolLevels}
          initialWallTrailSec={initialWallTrailSec}
          sessionYmd={sessionYmd}
          liveSession={liveSession}
          defaultDteHorizon={defaultDteHorizon}
          defaultTimeframe={defaultTimeframe}
          defaultChartViewport={defaultChartViewport}
          defaultLens={compareDefaultLens}
          toolbarHideLinkedControls={toolbarHideLinkedControls}
          hideVolumePane={hideVolumePane}
          compareCompactBeads={compareCompactBeads}
          compareSync={compareSync}
          onCompareCrosshair={onCompareCrosshair}
          onCompareVisibleRange={onCompareVisibleRange}
          linkedReplay={linkedReplay}
          hideReplayControls={hideReplayControls}
          defaultNodeDensity={defaultNodeDensity}
          onReplayTimeline={onReplayTimeline}
          onReplayModeChange={handleReplayModeChange}
          compareFourUp={compareFourUp}
          compareFourUpBackground={compareFourUpBackground}
          comparePane={comparePane}
          compareKeyboardActive={compareKeyboardActive}
          onPriceScaleRender={onPriceScaleRender}
          focusLevel={focusLevel}
          playLevels={playLevels}
          fillHost
          onFreshness={liveSession ? setStreamUpdatedAt : undefined}
          onRegimeChange={handleRegime}
          onSpotChange={liveSession ? handleSpot : undefined}
          onProximityChange={setProximity}
          onMagnetChange={setMagnet}
          onWallIntegrityChange={setWallIntegrity}
          onConfluenceChange={setConfluence}
          onExpectedMoveChange={setExpectedMove}
          onPlayChange={setPlayEmit}
          alertRules={alertRules}
          onAlertsFired={handleAlertsFired}
          leadSlot={chartLead}
          trailSlot={chartFreshness}
          replayLeadSlot={toolbarReplayLeadSlot}
          regimeSlot={embedRegimeSlot}
          toolbarPortalEl={toolbarPortalEl}
          sessionHelixFlows={helixState.flows}
        />
        {toast && (
          <div className="vector-alert-toast" role="status" aria-live="polite">
            <span className="vector-alert-toast-dot" aria-hidden="true" />
            <span className="vector-alert-toast-msg">🔔 {toast.message}</span>
            <button type="button" className="vector-alert-toast-x" onClick={() => setToast(null)} aria-label="Dismiss">
              ✕
            </button>
          </div>
        )}
      </div>
    );
  }

  const helixRail = (
    <VectorHelixRail
      ticker={activeTicker}
      liveSession={liveSession}
      helixState={helixState}
      onStrikeFocus={handleHelixStrikeFocus}
    />
  );

  // Desktop 4th "action" column: fused trade idea + contract picks + desk intel — play-engine only
  // (technicals stay on-chart as overlays; no separate Technicals panel in this rail).
  const actionRail = (
    <>
      {chartReplayMode ? <VectorReplayPlayGate className="mb-2" /> : null}
      <VectorPlayCard
        play={play}
        className="mb-2"
        replayPaused={chartReplayMode}
        onOpenAnalytics={() => setPlayAnalyticsOpen(true)}
      />
      <VectorPlayIntelStrip
        regime={regime}
        expectedMove={expectedMove}
        confluence={confluence}
        wallIntegrity={wallIntegrity}
        className="mb-2"
      />
      <VectorContractPicksCard
        ticker={activeTicker}
        play={play}
        picks={contractPicks}
        closedPicks={closedContractPicks}
        loading={contractPicksLoading}
        spot={playEmit?.spot ?? liveSpot}
        gammaFlip={playEmit?.gammaFlip ?? null}
        replayPaused={chartReplayMode}
        className="mb-2"
      />
      <VectorPlayAnalyticsDrawer
        open={playAnalyticsOpen}
        onClose={() => setPlayAnalyticsOpen(false)}
        ticker={activeTicker}
        play={play}
        playEmit={playEmit}
        regime={regime}
        magnet={magnet}
        proximity={proximity}
        expectedMove={expectedMove}
        confluence={confluence}
        wallIntegrity={wallIntegrity}
      />
    </>
  );

  const chartBlock = (
    <VectorChart
      key={activeTicker}
      ticker={activeTicker}
      initialBars={initialBars}
      initialWalls={initialWalls}
      initialVexWalls={initialVexWalls}
      initialWallHistory={initialWallHistory}
      initialHorizonWallHistory={initialHorizonWallHistory}
      initialGammaFlip={initialGammaFlip}
      initialVexFlip={initialVexFlip}
      initialDarkPoolLevels={initialDarkPoolLevels}
      initialWallTrailSec={initialWallTrailSec}
      sessionYmd={sessionYmd}
      liveSession={liveSession}
      defaultDteHorizon={defaultDteHorizon}
      defaultTimeframe={defaultTimeframe}
      defaultChartViewport={defaultChartViewport}
      defaultNodeDensity={defaultNodeDensity}
      onFreshness={liveSession ? setStreamUpdatedAt : undefined}
      onSpotChange={liveSession ? setLiveSpot : undefined}
      onWallEventsChange={setWallEvents}
      onLensChange={setLens}
      onRegimeChange={setRegime}
      onProximityChange={setProximity}
      onMagnetChange={setMagnet}
      onConfluenceChange={setConfluence}
      onWallIntegrityChange={setWallIntegrity}
      onDteHorizonChange={setDteHorizon}
      onExpectedMoveChange={setExpectedMove}
      onPlayChange={setPlayEmit}
      onReplayModeChange={handleReplayModeChange}
      focusLevel={chartFocus}
      // The chart-only embed returns earlier with its own VectorChart, so in practice only the
      // standalone page reaches here and `onPriceScaleRender` is undefined. The `??` keeps a host's
      // callback authoritative anyway rather than silently stealing the seam — the two consumers
      // are mutually exclusive (an embed has no ladder rail), so there is nothing to merge.
      onPriceScaleRender={onPriceScaleRender ?? handlePriceScaleRender}
      alertRules={alertRules}
      onAlertsFired={handleAlertsFired}
      leadSlot={chartLead}
      trailSlot={chartFreshnessWithAlerts}
      // Regime narrative banner removed on the standalone page (member request, 2026-08-26): the
      // "Short/Long gamma …" callout ate a full row above the canvas for a read the SCALP rail and
      // ODTE matrix already give at a glance. `regime` state itself is untouched — still forwarded
      // to Compare sync and the contract-picks reasoning — only the visual banner is gone.
      regimeSlot={null}
      toolbarPortalEl={toolbarPortalEl}
      sessionHelixFlows={helixState.flows}
    />
  );

  const alertToast =
    toast != null ? (
      <div className="vector-alert-toast" role="status" aria-live="polite">
        <span className="vector-alert-toast-dot" aria-hidden="true" />
        <span className="vector-alert-toast-msg">🔔 {toast.message}</span>
        <button type="button" className="vector-alert-toast-x" onClick={() => setToast(null)} aria-label="Dismiss">
          ✕
        </button>
      </div>
    ) : null;

  return (
    <PageShell
      fullBleed
      backdrop={false}
      className={clsx(
        "vector-page-shell ios-native-page ios-native-page-vector",
        nativeShell && "vector-page-shell-native"
      )}
      contentClassName={clsx(
        "vector-page-content !py-0",
        // PageShell's wrapper is `relative z-10`, which is a STACKING CONTEXT — without lifting it
        // too, the fullscreen surface's z-110 can never beat the nav's z-100. See
        // focusModeContentClass() for the full reasoning.
        focusModeContentClass(focusMode),
        nativeShell && "vector-page-content-native"
      )}
    >
      <div
        className={clsx(
          nativeShell ? "vector-page-inner-native px-2 pt-0 sm:px-3" : "px-2 pt-0 sm:px-4 xl:px-6",
          // Focus mode fullscreens THIS wrapper — not the grid — so the chart toolbar (which is
          // portalled above the grid and carries the way out) stays on screen above the chart.
          focusMode && "vector-page-inner-focus"
        )}
      >
        {compactPanels && nativeShell ? (
          <IosNativeSegment
            value={iosPanel}
            onChange={selectIosPanel}
            accent="#2dd4bf"
            variant="compact"
            aria-label="Vector desk view"
            className="ios-native-desk-segment ios-native-desk-segment-vector"
            segments={VECTOR_IOS_PANELS}
          />
        ) : null}

        {!chartOnly && !hostToolbarPortalEl ? (
          <div
            ref={pageToolbarPortalRef}
            className="vector-page-toolbar"
            data-testid="vector-page-toolbar"
          />
        ) : null}

        {!chartOnly && !comparePane && !focusMode && !(compactPanels && nativeShell) ? (
          <VectorTickerComparisonStrip
            activeTicker={activeTicker}
            onSelect={navigateTicker}
            className="vector-comparison-strip-page mb-2"
          />
        ) : null}

        <div
          className={clsx(
            "vector-chart-terminal-grid",
            compactPanels && nativeShell && "vector-chart-terminal-grid-native",
            compactPanels && nativeShell && iosPanel === "chart" && "vector-ios-chart-focus",
            focusMode && "vector-chart-terminal-grid-focus"
          )}
          data-ios-panel={compactPanels && nativeShell ? iosPanel : undefined}
          data-focus-mode={focusMode ? "on" : undefined}
        >
          {/*
            Every grid child is KEYED. Focus mode removes siblings, and without keys React would
            reconcile the remaining children by index — handing the chart the slot the ladder rail
            just vacated and remounting VectorChart, which would drop the lightweight-charts
            instance, the SSE stream and the member's zoom on every toggle.
          */}
          {panels.ladder ? (
          <div
            key="ladder"
            className={clsx(
              "vector-ladder-rail",
              compactPanels && nativeShell && iosPanel !== "ladder" && "ios-native-panel-hidden"
            )}
          >
            <VectorOdteMatrixRail
              ticker={activeTicker}
              liveSession={liveSession}
              initialSpot={initialBars.length ? initialBars[initialBars.length - 1]!.close : null}
              liveSpot={liveSpot}
              dteHorizon={dteHorizon}
              wallsPollMs={
                initialWallTrailSec != null ? initialWallTrailSec * 1000 : undefined
              }
              priceBand={priceBand}
              onStrikeFocus={handleMatrixStrikeFocus}
            />
          </div>
          ) : null}

          <div
            key="chart"
            className={clsx(
              "vector-chart-terminal-chart min-w-0",
              compactPanels && nativeShell && iosPanel !== "chart" && "ios-native-panel-hidden"
            )}
          >
            {chartBlock}
          </div>

          {panels.terminal ? (
          <div
            key="terminal"
            className={clsx(
              "vector-terminal-rail",
              compactPanels && nativeShell && iosPanel !== "pulse" && "ios-native-panel-hidden"
            )}
          >
            {helixRail}
          </div>
          ) : null}

          {/*
            Action rail: desktop 4th column; iOS native "Plays" segment (2026-08-27).
          */}
          {panels.action &&
            (!compactPanels || !nativeShell || iosPanel === "plays") && (
            <div key="action" className="vector-action-rail">{actionRail}</div>
          )}
        </div>

        {alertToast}

        {!panels.scanner ? null : compactPanels && nativeShell ? (
          <div
            className={clsx(
              "vector-scanner-native",
              iosPanel !== "scanner" && "ios-native-panel-hidden"
            )}
          >
            <VectorScanner
              activeTicker={activeTicker}
              onSelect={(t) => navigateTicker(t)}
            />
          </div>
        ) : (
          <details className="vector-scanner-panel" open={scannerOpen}>
            <summary
              className="vector-scanner-summary"
              onClick={(e) => {
                e.preventDefault();
                setScannerOpen((v) => !v);
              }}
            >
              <span className="vector-scanner-summary-label">Universe scanner</span>
              <span className="vector-scanner-summary-hint">
                {scannerOpen ? "Hide" : "Gamma structure across the liquid universe"}
              </span>
            </summary>
            <div className="vector-scanner-body">
              <VectorScanner
                activeTicker={activeTicker}
                onSelect={(t) => navigateTicker(t)}
              />
            </div>
          </details>
        )}
      </div>
    </PageShell>
  );
}
