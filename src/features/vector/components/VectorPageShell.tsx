"use client";

import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { clsx } from "clsx";
import { PageShell, FreshnessChip } from "@/components/ui";
import { ProductMark } from "@/components/marks/ProductMark";
import { IosNativeSegment } from "@/components/ios/IosNativeSegment";
import { useIosNativeShell } from "@/hooks/useIosNativeShell";
import { useCompactDeskPanels } from "@/hooks/useCompactDeskPanels";
import type { VectorBar } from "@/features/vector/components/VectorChart";
import type { PlayLevelsInput } from "@/features/vector/lib/vector-play-levels";
import type { VectorDarkPoolLevel, VectorWalls } from "@/lib/api";
import type { WallHistorySample, VectorWallLens } from "@/features/vector/lib/vector-wall-history";
import type { VectorDteHorizon } from "@/features/vector/lib/vector-dte-horizon";
import type { VectorPriceScaleMap } from "@/features/vector/lib/vector-price-scale-map";
import type { VectorTimeframeMinutes } from "@/features/vector/lib/vector-bar-timeframes";
import type { TechnicalsLine } from "@/features/vector/lib/vector-technicals";
import { VectorTickerSelect } from "@/features/vector/components/VectorTickerSelect";
import { VectorScanner } from "@/features/vector/components/VectorScanner";
import { VectorTickerComparisonStrip } from "@/features/vector/components/VectorTickerComparisonStrip";
import { VectorPulse } from "@/features/vector/components/VectorPulse";
import { VectorPlayCard } from "@/features/vector/components/VectorPlayCard";
import { VectorTechnicalsPanel } from "@/features/vector/components/VectorTechnicalsPanel";
import type { VectorPlay } from "@/features/vector/lib/vector-play-engine";
import { VectorGexLadder } from "@/features/vector/components/VectorGexLadder";
import { VectorDailyChart } from "@/features/vector/components/VectorDailyChart";
import { VectorRegimeBanner } from "@/features/vector/components/VectorRegimeBanner";
import { VectorAlertsPanel } from "@/features/vector/components/VectorAlertsPanel";
import type { AlertRule, AlertKind, FiredAlert } from "@/features/vector/lib/vector-alerts";
import { loadAlertRules, saveAlertRules, buildAlertRule, loadNotifyEnabled, saveNotifyEnabled } from "@/features/vector/lib/vector-alerts-store";
import { notificationForFire, shouldSystemNotify } from "@/features/vector/lib/vector-notify";
import { enableVectorNotifications, notifyPermission, presentSystemNotification } from "@/features/vector/lib/vector-notify-client";
import { deriveVectorRegime, type VectorRegime } from "@/features/vector/lib/vector-regime";
import { deriveWallProximity, type WallProximity } from "@/features/vector/lib/vector-wall-proximity";
import { deriveGammaMagnet, type GammaMagnet } from "@/features/vector/lib/vector-gamma-magnet";
import { scoreTopWalls, type WallIntegrity } from "@/features/vector/lib/vector-wall-integrity";
import type { VectorWallEvent } from "@/features/vector/lib/vector-wall-events";
import { VECTOR_DEFAULT_TICKER } from "@/features/vector/lib/vector-ticker";
import { GexShiftLeadersStrip } from "@/components/gex/GexShiftLeadersStrip";
import { pickGexShiftLeaders, matrixShiftForLens, type GexShiftLeader } from "@/lib/gex-shift-leaders";
import { vectorGexScopeLabel } from "@/lib/gex-scope-labels";
import { VECTOR_GEX_HEATMAP_POLL_MS } from "@/features/vector/lib/vector-cadence";

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
  focusLevel?: { price: number; label: string; tone: string; seq: number } | null;
  /** PLAYS ON THE CHART seam (2026-07-26): the member's ACTIVE SPX play (entry/stop/target/
   *  invalidation) mapped to price-lines, forwarded verbatim to VectorChart so its risk levels draw
   *  on the tape. Meaningful ONLY for the chart-only embed (the SPX desk); the standalone /vector
   *  page never sets it and never receives it, so that page stays byte-identical. */
  playLevels?: PlayLevelsInput;
  /** Host-desk slot rendered in the chart toolbar immediately LEFT of the Replay control
   *  (user-directed 2026-07-14: the desk focus toggle lives there after the time bar's removal). */
  toolbarReplayLeadSlot?: React.ReactNode;
};

type VectorIosPanel = "chart" | "pulse" | "ladder" | "scanner";

const VECTOR_IOS_PANELS: { id: VectorIosPanel; label: string }[] = [
  { id: "chart", label: "Chart" },
  { id: "pulse", label: "Pulse" },
  { id: "ladder", label: "Ladder" },
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
}: Props) {
  const chartOnly = embed === "chart-only";
  const router = useRouter();
  const nativeShell = useIosNativeShell();
  const compactPanels = useCompactDeskPanels(nativeShell);
  const [iosPanel, setIosPanel] = useState<VectorIosPanel>("chart");
  const sessionLabel = formatSessionLabel(sessionYmd);
  const [streamUpdatedAt, setStreamUpdatedAt] = useState<number | null>(null);
  const [wallEvents, setWallEvents] = useState<VectorWallEvent[]>([]);
  const [lens, setLens] = useState<VectorWallLens>("gex");
  // Mirror the chart's DTE horizon so the GEX ladder re-scopes to the same expiries the walls use.
  // Must match VectorChart's default ("weekly", or the host's defaultDteHorizon override) — this
  // copy drives the GEX ladder's scope label + fetch. When it defaulted to "all" while the chart
  // defaulted to weekly, the ladder's first paint showed the near-term aggregate against a
  // weekly-scoped chart until hydration converged them.
  const [dteHorizon, setDteHorizon] = useState<VectorDteHorizon>(defaultDteHorizon ?? "weekly");
  // Price under the historical chart's crosshair, lifted here so the GEX ladder — a sibling, not
  // a child, of the chart — can highlight the matching strike. Null whenever the cursor is off
  // the plot.
  const [hoverPrice, setHoverPrice] = useState<number | null>(null);
  const [scannerOpen, setScannerOpen] = useState(false);
  const activeTicker = ticker || VECTOR_DEFAULT_TICKER;
  // Daily/Weekly/4H historical view (CTO audit P2 #5, and P2 "4h remains open" 2026-08-05) — a
  // separate chart surface from the intraday VectorChart (see VectorDailyChart's header comment
  // for why). Standalone-page-only; the chart-only embed (SPX Slayer) never renders this toggle
  // and always stays intraday.
  const [chartView, setChartView] = useState<"intraday" | "1D" | "1W" | "4H">("intraday");

  useEffect(() => {
    if (!compactPanels) return;
    try {
      const saved = window.sessionStorage.getItem("vector-ios-panel");
      if (saved === "chart" || saved === "pulse" || saved === "ladder" || saved === "scanner") {
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
  const [play, setPlay] = useState<VectorPlay | null>(null);
  // Always-on technicals lines (VWAP/EMA/RSI/MACD/pocket/structure) — narrated by the terminal even
  // when the member hasn't toggled the overlays on the chart.
  const [technicals, setTechnicals] = useState<TechnicalsLine[]>([]);
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
  const [shiftLeaders, setShiftLeaders] = useState<GexShiftLeader[]>([]);
  const [wallIntegrity, setWallIntegrity] = useState<{
    call: WallIntegrity | null;
    put: WallIntegrity | null;
  }>(() => scoreTopWalls(initialWalls, initialWallHistory));
  // Live spot price from chart's SSE stream — passed to GEX ladder so it updates every second
  // instead of polling every 15s. Null until the first candle arrives.
  const [liveSpot, setLiveSpot] = useState<number | null>(
    initialBars.length ? initialBars[initialBars.length - 1]!.close : null
  );

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
  // Only the intraday surface emits a band. The 1D/1W/4H views are a DIFFERENT chart component
  // (VectorDailyChart) spanning months of price, and scoping the rail to a multi-month range would
  // hide nothing while implying the two are linked — so those views get the full rail, as before.
  const priceBand = chartView === "intraday" ? chartPriceBand : null;

  // Load the member's saved alert rules whenever the ticker changes (and clear the recent history so
  // one ticker's fires don't bleed into another). Persisted per ticker in localStorage.
  useEffect(() => {
    setAlertRules(loadAlertRules(activeTicker));
    setRecentAlerts([]);
    setToast(null);
  }, [activeTicker]);

  useEffect(() => {
    let cancelled = false;
    const loadShift = async () => {
      try {
        const res = await fetch(
          `/api/market/gex-heatmap?ticker=${encodeURIComponent(activeTicker)}`,
          { cache: "no-store" }
        );
        if (!res.ok || cancelled) return;
        const payload = (await res.json()) as {
          gex?: { strike_totals?: Record<string, number> };
          shift?: { available?: boolean; delta_by_strike?: Record<string, number> };
        };
        if (cancelled) return;
        setShiftLeaders(pickGexShiftLeaders(payload.gex?.strike_totals, matrixShiftForLens("gex", payload)));
      } catch {
        /* best-effort terminal chrome */
      }
    };
    void loadShift();
    const id = liveSession ? setInterval(loadShift, VECTOR_GEX_HEATMAP_POLL_MS) : null;
    return () => {
      cancelled = true;
      if (id) clearInterval(id);
    };
  }, [activeTicker, liveSession]);

  // Auto-dismiss the toast a few seconds after the newest fire.
  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), 6000);
    return () => clearTimeout(id);
  }, [toast]);

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
  // useCallback here (not just an inline function): VectorAlertsPanel/GexShiftLeadersStrip are
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
      // here must never block or break it, so it's fire-and-forget with the error swallowed. The
      // mirrored copy is what `/api/cron/vector-alerts` reads to fire push alerts to a closed tab.
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

  const kicker =
    activeTicker === "SPX" ? "Live SPX chart" : `Live ${activeTicker} chart`;

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
        <VectorTickerSelect ticker={activeTicker} />
      )
    : (
      <div className="flex items-center gap-2 pr-1">
        <ProductMark product="vector" size={22} animated={false} />
        <span className="font-mono text-sm font-bold uppercase tracking-[0.18em] text-cyan-100">Vector</span>
        <span className="hidden font-mono text-[10px] uppercase tracking-[0.2em] text-cyan-400/60 md:inline">
          · {kicker}
        </span>
        <VectorTickerSelect ticker={activeTicker} />
      </div>
    );
  const chartFreshness = spxIosEmbed ? null : (
    <FreshnessChip
      status={freshnessStatus}
      asOf={liveSession && streamUpdatedAt ? new Date(streamUpdatedAt) : null}
      staleAfterMs={liveSession ? CANDLE_STALE_MS : undefined}
      label={liveSession ? "Live session" : `${sessionLabel} close`}
    />
  );
  const embedRegimeSlot = spxIosEmbed ? null : <VectorRegimeBanner regime={regime} />;

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
          onPriceScaleRender={onPriceScaleRender}
          focusLevel={focusLevel}
          playLevels={playLevels}
          fillHost
          onFreshness={liveSession ? setStreamUpdatedAt : undefined}
          onRegimeChange={setRegime}
          alertRules={alertRules}
          onAlertsFired={handleAlertsFired}
          leadSlot={chartLead}
          trailSlot={chartFreshness}
          replayLeadSlot={toolbarReplayLeadSlot}
          regimeSlot={embedRegimeSlot}
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

  const pulseRail = (
    <>
      <GexShiftLeadersStrip
        leaders={shiftLeaders}
        scopeLabel={`${vectorGexScopeLabel(dteHorizon)} matrix`}
        className="mb-2"
      />
      <VectorPulse
        ticker={activeTicker}
        lens={lens}
        wallEvents={wallEvents}
        liveSession={liveSession}
        streamUpdatedAt={streamUpdatedAt}
        regime={regime}
        proximity={proximity}
        magnet={magnet}
        confluence={confluence}
        technicals={technicals}
        showTechnicals={false}
        expectedMove={expectedMove}
        alerts={recentAlerts.slice(0, 5).map((f) => f.message)}
        wallIntegrity={wallIntegrity}
        liveSpot={liveSpot}
      />
      {/* Cross-ticker wall-structure comparison (P2, 2026-08-05 CTO audit) — additive, below the
          Pulse rail. Renders nothing when the universe snapshot hasn't loaded or no comparison
          ticker resolves a row, so it never displaces the panels above/below it. */}
      <VectorTickerComparisonStrip
        activeTicker={activeTicker}
        onSelect={(t) =>
          router.push(t === VECTOR_DEFAULT_TICKER ? "/vector" : `/vector?ticker=${encodeURIComponent(t)}`)
        }
        className="mb-2"
      />
    </>
  );

  // Desktop 4th "action" column (2026-08-05, member-directed): the things a member actually ACTS
  // on — the fused trade idea, the technical read, and the alert-rule builder — pulled out of the
  // long narrative feed (regime/signals/gamma-magnet/wall-integrity/confluence/expected-move) so
  // they're visible without scrolling. Below the wide-desktop breakpoint this still renders (see
  // .vector-action-rail in globals.css), just as a full-width row under the 3-column area rather
  // than its own column — nothing is ever lost, only the wide-desktop layout changes.
  const actionRail = (
    <>
      <VectorPlayCard play={play} className="mb-2" />
      <VectorTechnicalsPanel technicals={technicals} className="mb-2" />
      <VectorAlertsPanel
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
      onTechnicalsChange={setTechnicals}
      onExpectedMoveChange={setExpectedMove}
      onPlayChange={setPlay}
      // The chart-only embed returns earlier with its own VectorChart, so in practice only the
      // standalone page reaches here and `onPriceScaleRender` is undefined. The `??` keeps a host's
      // callback authoritative anyway rather than silently stealing the seam — the two consumers
      // are mutually exclusive (an embed has no ladder rail), so there is nothing to merge.
      onPriceScaleRender={onPriceScaleRender ?? handlePriceScaleRender}
      alertRules={alertRules}
      onAlertsFired={handleAlertsFired}
      leadSlot={chartLead}
      trailSlot={chartFreshness}
      regimeSlot={<VectorRegimeBanner regime={regime} />}
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
      contentClassName={clsx(nativeShell && "vector-page-content-native !py-0")}
    >
      <div
        className={clsx(
          nativeShell ? "vector-page-inner-native px-2 pt-0 sm:px-3" : "px-2 pt-2 sm:px-4 xl:px-6"
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

        <div
          className={clsx(
            "vector-chart-terminal-grid",
            compactPanels && nativeShell && "vector-chart-terminal-grid-native",
            compactPanels && nativeShell && iosPanel === "chart" && "vector-ios-chart-focus"
          )}
          data-ios-panel={compactPanels && nativeShell ? iosPanel : undefined}
        >
          <div
            className={clsx(
              "vector-ladder-rail",
              compactPanels && nativeShell && iosPanel !== "ladder" && "ios-native-panel-hidden"
            )}
          >
            <VectorGexLadder
              hoverPrice={hoverPrice}
              ticker={activeTicker}
              liveSession={liveSession}
              initialSpot={initialBars.length ? initialBars[initialBars.length - 1]!.close : null}
              liveSpot={liveSpot}
              dteHorizon={dteHorizon}
              wallsPollMs={
                initialWallTrailSec != null ? initialWallTrailSec * 1000 : undefined
              }
              priceBand={priceBand}
            />
          </div>

          <div
            className={clsx(
              "vector-chart-terminal-chart min-w-0",
              compactPanels && nativeShell && iosPanel !== "chart" && "ios-native-panel-hidden"
            )}
          >
            {!iosCompactChrome && (
              <div className="vector-chart-view-toggle" role="group" aria-label="Chart view">
                {(["intraday", "1D", "1W", "4H"] as const).map((v) => (
                  <button
                    key={v}
                    type="button"
                    onClick={() => setChartView(v)}
                    className={clsx("vector-chart-view-btn", v === chartView && "is-active")}
                  >
                    {v === "intraday" ? "Intraday" : v}
                  </button>
                ))}
              </div>
            )}
            {chartView === "intraday" ? (
              chartBlock
            ) : (
              <VectorDailyChart
                ticker={activeTicker}
                unit={chartView}
                onHoverPrice={setHoverPrice}
              />
            )}
          </div>

          <div
            className={clsx(
              "vector-terminal-rail",
              compactPanels && nativeShell && iosPanel !== "pulse" && "ios-native-panel-hidden"
            )}
          >
            {pulseRail}
          </div>

          {/*
            Desktop 4th "action" column (member request, 2026-08-05): Play card + Technicals +
            Alert builder, split out of the narrative pulse rail so they're visible without
            scrolling. Skipped entirely inside the iOS native app shell — that shell's segment
            switcher (VECTOR_IOS_PANELS) only knows ladder/chart/pulse/scanner, and mobile wasn't
            in scope for this change; on ordinary responsive web (non-native, narrow viewport) the
            CSS below still stacks it as a full-width row rather than hiding it.
          */}
          {!(compactPanels && nativeShell) && (
            <div className="vector-action-rail">{actionRail}</div>
          )}
        </div>

        {alertToast}

        {compactPanels && nativeShell ? (
          <div
            className={clsx(
              "vector-scanner-native",
              iosPanel !== "scanner" && "ios-native-panel-hidden"
            )}
          >
            <VectorScanner
              activeTicker={activeTicker}
              onSelect={(t) =>
                router.push(t === VECTOR_DEFAULT_TICKER ? "/vector" : `/vector?ticker=${encodeURIComponent(t)}`)
              }
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
                onSelect={(t) =>
                  router.push(t === VECTOR_DEFAULT_TICKER ? "/vector" : `/vector?ticker=${encodeURIComponent(t)}`)
                }
              />
            </div>
          </details>
        )}
      </div>
    </PageShell>
  );
}
