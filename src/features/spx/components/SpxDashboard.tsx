"use client";

import React, { Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { clsx } from "clsx";
import { useAppAuth } from "@/lib/auth-client";
import { useMergedDesk } from "@/features/spx/hooks/useMergedDesk";
import { useSpxPlay } from "@/features/spx/hooks/useSpxPlay";
import { resolveSpxChartPlayLevels } from "@/features/spx/lib/spx-chart-play-levels";
import type { VectorPlayDeskSnapshot } from "@/features/vector/lib/vector-play-desk-snapshot";
import { useIosNativeShell } from "@/hooks/useIosNativeShell";
import { useCompactDeskPanels } from "@/hooks/useCompactDeskPanels";
import { IosNativeSegment } from "@/components/ios/IosNativeSegment";
import { EmptyState, Button } from "@/components/ui";
import { shouldShowHaltDegradedBanner } from "@/features/spx/lib/spx-halt-banner";
import {
  SPX_DESK_FOCUS_STORAGE_KEY,
  focusHotkeyAction,
  nextFocusState,
} from "@/features/spx/lib/spx-desk-focus";
// Type-only: the shared-price-axis map the embedded chart emits (see vector-price-scale-map.ts).
import type { VectorPriceScaleMap } from "@/features/vector/lib/vector-price-scale-map";
import { SpxVectorEmbed } from "./SpxVectorEmbed";

const SpxSniperHeader = dynamic(
  () => import("./SpxSniperHeader").then((m) => ({ default: m.SpxSniperHeader })),
  { loading: () => null }
);

const SpxGexMatrixHeatmap = dynamic(
  () => import("./SpxGexMatrixHeatmap").then((m) => ({ default: m.SpxGexMatrixHeatmap })),
  { loading: () => null }
);

const SpxPinForecast = dynamic(
  () => import("./SpxPinForecast").then((m) => ({ default: m.SpxPinForecast })),
  { loading: () => null }
);

const SpxVectorPlayRail = dynamic(
  () => import("./SpxVectorPlayRail").then((m) => ({ default: m.SpxVectorPlayRail })),
  { loading: () => null }
);

// DESK CONSOLIDATION (2026-07-13, member-directed): the Trade Alerts panel (plays kanban +
// engine cards) and the Slayer desk terminal (mounted inside that same component) are
// REMOVED from the flagship desk in favour of the embedded SPX Vector chart below — one
// flagship desk, one source of truth, and explicitly NO terminal panels on SPX Slayer. The
// components stay in the repo untouched (see ./SpxTradeAlerts.tsx) so restoring them is one
// render away if the member reverses the call.
const SpxIntelRail = dynamic(
  () => import("./SpxIntelRail").then((m) => ({ default: m.SpxIntelRail })),
  { loading: () => null }
);

class SpxPanelErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean }
> {
  state = { hasError: false };
  static getDerivedStateFromError() {
    return { hasError: true };
  }
  render() {
    if (this.state.hasError)
      return (
        <div className="text-bear p-4 text-xs font-mono">
          Panel unavailable — reload the page to reconnect.
        </div>
      );
    return this.props.children;
  }
}

type SpxDashboardProps = {
  /** Launch-gated Vector chart column — client-hydrated via SpxVectorEmbed (no SSR seed). */
  vectorEnabled: boolean;
};

export function SpxDashboard({ vectorEnabled }: SpxDashboardProps) {
  const { isLoaded, tier } = useAppAuth();
  const { desk, live, deskLoading, deskLaneFailed, sessionActive } = useMergedDesk();
  const nativeShell = useIosNativeShell();
  const compactPanels = useCompactDeskPanels(nativeShell);
  const [iosPanel, setIosPanel] = useState<"vector" | "matrix" | "intel">("vector");

  useEffect(() => {
    if (!compactPanels) return;
    try {
      const saved = window.sessionStorage.getItem("spx-ios-panel");
      if (saved === "vector" || saved === "matrix" || saved === "intel") setIosPanel(saved);
    } catch {
      /* sessionStorage unavailable */
    }
  }, [compactPanels]);

  const selectIosPanel = useCallback((next: "vector" | "matrix" | "intel") => {
    setIosPanel(next);
    try {
      window.sessionStorage.setItem("spx-ios-panel", next);
    } catch {
      /* best-effort */
    }
  }, []);

  // SHARED PRICE AXIS (2026-07-13): the embedded Vector chart reports its live y-mapping
  // through the VectorPageShell seam; the matrix column's ladder view consumes it so bars
  // and the spot line land at the SAME pixel heights as the chart.
  const [priceScaleMap, setPriceScaleMap] = useState<VectorPriceScaleMap | null>(null);
  const vectorToolbarPortalRef = useRef<HTMLDivElement>(null);
  const [vectorToolbarPortalEl, setVectorToolbarPortalEl] = useState<HTMLElement | null>(null);
  useLayoutEffect(() => {
    setVectorToolbarPortalEl(vectorToolbarPortalRef.current);
  }, []);

  // PULSE → CHART ANCHOR (2026-07-26): a Pulse event's "→ chart" click flows UP through
  // SpxIntelRail as a focus request and DOWN into the embedded Vector chart via `focusLevel`.
  // `seq` is a monotonic counter, NOT a value the chart reads for content — it exists so that
  // clicking the SAME level twice still re-fires the chart's flash effect (identical {price,label,
  // tone} would otherwise dedupe under React's referential-equality effect keying).
  const [chartFocus, setChartFocus] = useState<{
    price: number;
    label: string;
    tone: string;
    seq: number;
  } | null>(null);

  // PLAYS ON THE CHART (2026-07-26): the member's ACTIVE SPX play (entry/stop/target/invalidation)
  // drawn as labeled price-lines on the embedded Vector chart — the play's risk levels right on the
  // tape they're trading. Session gate matches the Pulse/commentary rails exactly (live desk AND a
  // real desk snapshot) so the play SWR only polls when the desk is actually live. The mapped input
  // is memoized on the play's identity so an unchanged play doesn't churn the chart's reconcile.
  // Play polling + verdict bar use sessionActive (ET clock + pulse), NOT resolveDeskLive.
  // Brief desk-lane refresh can drop `live` for a poll while RTH is still open — gating on
  // `live && desk.available` cleared play cache and flashed CLOSED on the verdict bar while
  // /api/market/spx/play stayed SCANNING (SPX-VERDICT-CLOSED-FLICKER, 2026-08-05).
  const [vectorDesk, setVectorDesk] = useState<VectorPlayDeskSnapshot | null>(null);
  const handleVectorDeskSnapshot = useCallback((snapshot: VectorPlayDeskSnapshot) => {
    setVectorDesk(snapshot);
  }, []);

  const { play, playLoading } = useSpxPlay(sessionActive);
  const playLevels = useMemo(
    () => resolveSpxChartPlayLevels(play, vectorDesk?.playEmit ?? null),
    [play, vectorDesk?.playEmit]
  );

  // FOCUS MODE (2026-07-13): `F` toggles / `Esc` exits (ignored while typing), persisted
  // per device. Hydrated after mount so SSR markup is deterministic. Compact/iOS shells
  // keep the segmented layout — focus is a desktop-grid concept.
  const [focusMode, setFocusMode] = useState(false);
  useEffect(() => {
    try {
      setFocusMode(window.localStorage.getItem(SPX_DESK_FOCUS_STORAGE_KEY) === "1");
    } catch {
      /* storage unavailable — default expanded */
    }
  }, []);
  const applyFocus = useCallback((updater: (cur: boolean) => boolean) => {
    setFocusMode((cur) => {
      const next = updater(cur);
      if (next !== cur) {
        try {
          window.localStorage.setItem(SPX_DESK_FOCUS_STORAGE_KEY, next ? "1" : "0");
        } catch {
          /* best-effort persistence */
        }
      }
      return next;
    });
  }, []);
  const toggleFocus = useCallback(() => applyFocus((cur) => !cur), [applyFocus]);
  useEffect(() => {
    if (compactPanels) return;
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target instanceof HTMLElement ? e.target : null;
      // setFocusMode's functional form reads the CURRENT value, but the Escape decision
      // needs it BEFORE the reducer runs — resolve the action inside the updater instead.
      applyFocus((cur) => {
        const action = focusHotkeyAction(e, target, cur);
        return nextFocusState(cur, action);
      });
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [compactPanels, applyFocus]);
  const focusActive = focusMode && !compactPanels;

  if (isLoaded && tier && tier !== "premium" && tier !== "community" && tier !== "admin") {
    return (
      <div className="flex min-h-[60vh] items-center justify-center px-4">
        <EmptyState
          title="Membership required"
          description={
            <>
              <span className="hide-in-ios-app">
                This account does not have an active membership. Upgrade to access the live desk.
              </span>
              <span className="show-in-ios-app">
                This account does not have an active membership. Membership is managed on the web.
              </span>
            </>
          }
          action={
            <>
              <Button href="/upgrade" variant="primary" size="sm" className="hide-in-ios-app">
                Unlock Access
              </Button>
              <Button href="/upgrade" variant="primary" size="sm" className="show-in-ios-app">
                Check membership
              </Button>
            </>
          }
          className="max-w-md"
        />
      </div>
    );
  }

  if (deskLoading && !desk) {
    return (
      <div className="spx-sniper-desk spx-sniper-desk-loading" aria-busy="true">
        <div className="spx-desk-placeholder" />
      </div>
    );
  }

  const activeHalts = desk?.active_halts ?? [];
  const haltChannelStale = desk?.halt_channel_stale ?? false;
  const showHaltDegradedBanner = shouldShowHaltDegradedBanner({
    sessionActive,
    haltChannelStale,
    activeHaltsCount: activeHalts.length,
  });

  return (
    <div
      className={clsx(
        "spx-sniper-desk spx-sniper-desk-fill",
        compactPanels && nativeShell && "spx-sniper-desk-ios-scroll",
        compactPanels && iosPanel === "vector" && "spx-sniper-desk--ios-vector-focus"
      )}
      data-ios-panel={compactPanels ? iosPanel : undefined}
    >
      {deskLaneFailed && (
        <div
          className="flex items-center gap-2 rounded border border-amber-500/40 bg-amber-500/10 px-4 py-2 text-xs font-mono text-amber-200"
          role="alert"
        >
          Desk rebuild failed — showing last cached snapshot. Retrying in the background.
        </div>
      )}
      {activeHalts.length > 0 && (
        <div
          className="flex items-center gap-2 rounded border border-bear/40 bg-bear/10 px-4 py-2 text-xs font-mono text-bear"
          role="alert"
        >
          <span className="font-bold">TRADING HALT</span>
          {activeHalts.map((h) => (
            <span key={h.symbol}>
              {h.symbol}
              {h.halt_type ? ` · ${h.halt_type}` : ""}
              {h.reason ? ` — ${h.reason}` : ""}
            </span>
          ))}
        </div>
      )}
      {showHaltDegradedBanner && (
        <div
          className="flex items-center gap-2 rounded border border-amber-400/40 bg-amber-400/10 px-4 py-2 text-xs font-mono text-amber-400"
          role="alert"
        >
          <span>Halt feed degraded — restricted entry mode; verify no active halts before entering</span>
        </div>
      )}
      {compactPanels && nativeShell ? (
        <div className="spx-ios-desk-chrome">
          <SpxPanelErrorBoundary>
            <div className="spx-ios-top-rail">
              <SpxSniperHeader
                desk={desk}
                live={live}
                nativeShell={nativeShell}
                sessionActive={sessionActive}
                iosVectorFocus={iosPanel === "vector"}
                stripOnly={iosPanel === "vector"}
              />
            </div>
          </SpxPanelErrorBoundary>
          <IosNativeSegment
            value={iosPanel}
            onChange={selectIosPanel}
            accent="#a3e635"
            variant="compact"
            aria-label="SPX desk view"
            className="ios-native-desk-segment ios-native-desk-segment-spx"
            segments={[
              { id: "vector", label: "Vector" },
              { id: "matrix", label: "Matrix" },
              { id: "intel", label: "Intel" },
            ]}
          />
        </div>
      ) : null}
      {!(compactPanels && nativeShell) ? (
        <SpxPanelErrorBoundary>
          <SpxSniperHeader
            desk={desk}
            live={live}
            nativeShell={nativeShell}
            sessionActive={sessionActive}
            iosVectorFocus={compactPanels && iosPanel === "vector"}
          />
        </SpxPanelErrorBoundary>
      ) : null}

      {/* Web / non-native compact: segment below header */}
      {compactPanels && !nativeShell ? (
        <IosNativeSegment
          value={iosPanel}
          onChange={selectIosPanel}
          accent="#a3e635"
          aria-label="SPX desk view"
          className="ios-native-desk-segment"
          segments={[
            { id: "vector", label: "Vector" },
            { id: "matrix", label: "Matrix" },
            { id: "intel", label: "Intel" },
          ]}
        />
      ) : null}

      {/*
        Three grid slots (desk v3, 2026-07-13 member-directed consolidation):
        Largo commentary | Matrix | embedded SPX Vector chart (chart-only, no terminal).
        The former Plays (kanban) and Terminal columns were removed in favour of the Vector
        chart — the components remain in the repo unused so a reversal is one render away.
      */}
      <div
        ref={vectorToolbarPortalRef}
        className="vector-page-toolbar spx-desk-vector-toolbar"
        data-testid="vector-page-toolbar"
      />
      {/* --desk-v2 keeps the shared rail styling (gap, borders, Largo/matrix columns);
          --desk-v3 swaps the grid template from four rails to three and adds the vector column. */}
      <div
        className={clsx(
          "spx-sniper-triple spx-sniper-triple--desk-v2 spx-sniper-triple--desk-v3",
          focusActive && "spx-sniper-triple--focus"
        )}
        data-ios-panel={compactPanels ? iosPanel : undefined}
      >
        <SpxPanelErrorBoundary>
          <Suspense fallback={null}>
            <aside
              className={clsx(
                "spx-sniper-intel-col spx-left-commentary",
                compactPanels && iosPanel !== "intel" && "ios-native-panel-hidden",
                compactPanels && iosPanel === "intel" && "ios-native-panel-visible"
              )}
            >
              <SpxIntelRail
                desk={desk}
                live={live}
                focus={focusActive}
                nativeShell={nativeShell}
                onFocusLevel={(price, label, tone) =>
                  setChartFocus((prev) => ({ price, label, tone, seq: (prev?.seq ?? 0) + 1 }))
                }
              />
            </aside>
          </Suspense>
        </SpxPanelErrorBoundary>

        <SpxPanelErrorBoundary>
          <aside
            className={clsx(
              "spx-sniper-left-rail spx-left-matrix",
              compactPanels && iosPanel !== "matrix" && "ios-native-panel-hidden",
              compactPanels && iosPanel === "matrix" && "ios-native-panel-visible"
            )}
          >
            {/* Spot module removed from this column (user-directed 2026-07-14): spot now lives
                in the header ribbon left of EMA, and the Dealer Gamma Map gets the full column
                height — same as the other two panels. */}
            {/* Spot module removed from this column (user-directed 2026-07-14): spot now lives in
                the header ribbon. The EOD Pin Forecaster was ALSO split out into its own 4th panel
                (below) so the Dealer Gamma Map now gets the FULL column height (member-directed:
                "4 panels with EOD pin as the new panel so we can get full view of the matrix"). */}
            <SpxGexMatrixHeatmap
              live={live}
              sessionActive={sessionActive}
              liveSpot={desk?.price ?? null}
              deskGammaFlip={desk?.gamma_flip ?? null}
              deskGexKing={desk?.gex_king ?? null}
              gexStale={desk?.gex_stale}
              openingRange={desk?.opening_range ?? null}
              unifiedTape={desk?.unified_tape}
              flow0dteNet={desk?.flow_0dte_net}
              flow0dteCallPrem={desk?.flow_0dte_call_premium}
              flow0dtePutPrem={desk?.flow_0dte_put_premium}
              priceScaleMap={priceScaleMap}
              focus={focusActive}
            />
          </aside>
        </SpxPanelErrorBoundary>

        {/* EOD Pin Forecaster — now its OWN 4th desk panel (was stacked under the matrix). On the
            compact/iOS shell it rides the "matrix" segment so the two 0DTE-structure panels stay
            together there. */}
        <SpxPanelErrorBoundary>
          <aside
            className={clsx(
              "spx-sniper-left-rail spx-left-pin",
              compactPanels && iosPanel !== "matrix" && "ios-native-panel-hidden",
              compactPanels && iosPanel === "matrix" && "ios-native-panel-visible"
            )}
          >
            <div className="spx-left-pin-stack">
              <SpxPinForecast sessionActive={sessionActive} />
              <SpxVectorPlayRail
                vectorDesk={vectorEnabled ? vectorDesk : null}
                slayerPlay={play}
                slayerLoading={playLoading}
                sessionActive={sessionActive}
                compactDefaultCollapsed={compactPanels}
              />
            </div>
          </aside>
        </SpxPanelErrorBoundary>

        <SpxPanelErrorBoundary>
          <section
            className={clsx(
              "spx-sniper-vector-col",
              compactPanels && iosPanel !== "vector" && "ios-native-panel-hidden",
              compactPanels && iosPanel === "vector" && "ios-native-panel-visible"
            )}
            aria-label="SPX Vector chart"
          >
            {vectorEnabled ? (
              !compactPanels || iosPanel === "vector" ? (
                <>
                  <SpxVectorEmbed
                    key="spx-vector-embed"
                    onPriceScaleRender={setPriceScaleMap}
                    focusLevel={chartFocus}
                    playLevels={playLevels}
                    onPlayDeskSnapshot={handleVectorDeskSnapshot}
                    toolbarPortalEl={vectorToolbarPortalEl}
                    toolbarReplayLeadSlot={
                    // Focus toggle relocated here from the removed session time bar
                    // (user-directed 2026-07-14: "move Focus to left of Replay").
                    !compactPanels ? (
                      <button
                        type="button"
                        id="spx-desk-focus-toggle"
                        className={clsx("spx-desk-focus-btn", focusActive && "spx-desk-focus-btn--active")}
                        onClick={toggleFocus}
                        aria-pressed={focusActive}
                        title={focusActive ? "Exit focus mode (F or Esc)" : "Focus mode — chart fills the desk (F)"}
                      >
                        ⛶ Focus
                      </button>
                    ) : undefined
                  }
                  />
                  {nativeShell && iosPanel === "vector" ? (
                    <div className="spx-ios-trade-setup mt-2">
                      <SpxVectorPlayRail
                        vectorDesk={vectorDesk}
                        slayerPlay={play}
                        slayerLoading={playLoading}
                        sessionActive={sessionActive}
                        compactDefaultCollapsed={false}
                      />
                    </div>
                  ) : null}
                </>
              ) : null
            ) : (
              <EmptyState
                title="Vector isn't on your plan yet"
                description="The embedded SPX Vector chart is a Premium feature. Vector itself is fully live — upgrade to unlock it here."
                action={
                  <Button href="/upgrade" variant="primary" size="sm">
                    Upgrade to Premium
                  </Button>
                }
                className="m-auto max-w-md"
              />
            )}
          </section>
        </SpxPanelErrorBoundary>
      </div>
    </div>
  );
}
