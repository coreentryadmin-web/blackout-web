import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

test("SPX embed seeds 0DTE horizon history and opens on session viewport", () => {
  assert.match(read("src/features/spx/components/SpxVectorEmbed.tsx"), /defaultDteHorizon="0dte"/);
  assert.match(read("src/features/spx/components/SpxVectorEmbed.tsx"), /defaultChartViewport="session"/);
  const shell = read("src/features/vector/components/VectorPageShell.tsx");
  assert.match(shell, /defaultChartViewport = "session"/);
  assert.match(shell, /defaultChartViewport=\{defaultChartViewport\}/);
  assert.match(shell, /initialHorizonWallHistory=\{initialHorizonWallHistory\}/);
});

test("/vector page preloads 0DTE rail for oracle tickers and weekly for single names", () => {
  const page = read("src/app/(site)/vector/page.tsx");
  assert.match(page, /defaultVectorDteHorizon/);
  assert.match(page, /defaultDteHorizon=\{defaultVectorDteHorizon\(ticker\)\}/);
  assert.match(page, /defaultChartViewport="session"/);
});

test("VectorChart: session viewport defers live-edge scroll until member pans", () => {
  const src = read("src/features/vector/components/VectorChart.tsx");
  assert.match(src, /liveFollowEnabledRef/);
  assert.match(src, /defaultChartViewport = "session"/);
  assert.match(src, /maybeScrollToLive\(chart, liveFollowEnabledRef\.current\)/);
  assert.match(src, /pinLiveAnchorBeads/);
  assert.match(src, /fitSessionOverview/);
  assert.match(src, /applySessionOverviewViewport/);
  assert.match(src, /wantsSessionOverviewViewport/);
});

test("VectorChart: session overview blocks live-follow flip and auto-coarsen", () => {
  const src = read("src/features/vector/components/VectorChart.tsx");
  assert.match(src, /sessionOverviewActive/);
  assert.match(src, /intradayZoomPresetRef/);
  assert.match(src, /intradayZoomPresetRef\.current === "session"/);
  assert.match(src, /if \(sessionOverviewActive\(\)\) return;/);
  assert.match(src, /chartUserPannedRef\.current = false/);
  assert.match(src, /fitContent\(\)/);
});

test("VectorChart: default load frames session overview when defaultChartViewport is session", () => {
  const src = read("src/features/vector/components/VectorChart.tsx");
  assert.match(src, /defaultChartViewport === "session" \? "session" : null/);
  assert.match(src, /sessionFramedOnLoad/);
  assert.match(src, /applySessionOverviewViewport\(chart, initialDisplay\)/);
});

test("VectorChart: member wheel zoom not overridden by adaptive bar spacing", () => {
  const src = read("src/features/vector/components/VectorChart.tsx");
  const render = read("src/features/vector/lib/vector-candle-render.ts");
  assert.match(src, /viewportLocked = memberViewportLocked/);
  // Spacing must NOT run inside subscribeVisibleLogicalRangeChange — that callback fires
  // synchronously during wheel zoom and would cancel every tick before capture-phase stamp.
  assert.doesNotMatch(
    src,
    /syncCandleViewportFromRange[\s\S]{0,800}adaptiveBarSpacingForZoom/
  );
  assert.match(render, /applyAdaptiveBarSpacingToChart/);
  assert.match(src, /applyAdaptiveBarSpacingToChart/);
  assert.match(src, /addEventListener\("wheel", onWheel, \{ passive: true, capture: true \}/);
  assert.match(src, /handleScale: true/);
});

test("VectorChart: candle render spacing, borders, and zoom presets wired", () => {
  const src = read("src/features/vector/components/VectorChart.tsx");
  assert.match(src, /vectorCandlestickOptions/);
  assert.match(src, /vectorTimeScaleSpacingOptions/);
  assert.match(read("src/features/vector/lib/vector-candle-render.ts"), /VECTOR_MIN_BAR_SPACING/);
  assert.match(src, /VectorIntradayZoomControls/);
  assert.match(src, /syncCandleViewportFromRange/);
  assert.match(src, /setOverlayDim/);
});

test("VectorDailyChart: shared candle spacing and borders", () => {
  const src = read("src/features/vector/components/VectorDailyChart.tsx");
  assert.match(src, /vectorCandlestickOptions/);
  assert.match(src, /vectorTimeScaleSpacingOptions/);
  assert.match(src, /adaptiveBarSpacingForZoom/);
});

test("VectorChart: dark-pool walls toggle wired to applyDarkPoolGuides", () => {
  const src = read("src/features/vector/components/VectorChart.tsx");
  const toolbar = read("src/features/vector/components/VectorToolbar.tsx");
  assert.match(src, /darkPoolWallsEnabledRef/);
  assert.match(src, /applyDarkPoolGuides\(series, dpGuideRefs, dp, darkPoolWallsEnabledRef\.current\)/);
  assert.match(src, /VECTOR_DARK_POOL_WALLS_STORAGE_KEY/);
  assert.match(toolbar, /VectorDarkPoolToggle/);
});

test("VectorChart: off-hours candle dimming wired", () => {
  const src = read("src/features/vector/components/VectorChart.tsx");
  const vol = read("src/features/vector/lib/vector-volume-render.ts");
  assert.match(src, /toCandlestickDisplayData/);
  assert.match(vol, /volumeAlphaForBar/);
  assert.match(read("src/features/vector/lib/vector-candle-render.ts"), /hasExtendedHoursBars/);
});

test("VectorChart: compare 4-up performance mode wired", () => {
  const src = read("src/features/vector/components/VectorChart.tsx");
  assert.match(src, /compareFourUpBackground/);
  assert.match(src, /vectorComparePerfPollMs/);
  assert.match(read("src/features/vector/components/VectorCompareDesk.tsx"), /compareFourUpBackground=/);
});

test("VectorChart: intraday zoom keyboard shortcuts wired", () => {
  const src = read("src/features/vector/components/VectorChart.tsx");
  assert.match(src, /intradayZoomPresetFromKeyboard/);
  assert.match(src, /compareKeyboardActive/);
  assert.match(read("src/features/vector/components/VectorIntradayZoomControls.tsx"), /intradayZoomShortcutLabel/);
});

test("VectorChart: flow confluence candle pulse wired", () => {
  const src = read("src/features/vector/components/VectorChart.tsx");
  assert.match(src, /pushFlowConfluencePulse/);
  assert.match(src, /applyFlowConfluenceToCandles/);
  assert.match(read("src/features/vector/lib/use-vector-helix-flows.ts"), /onFlowFlashRef/);
  assert.match(read("src/features/vector/components/VectorPageShell.tsx"), /handleHelixFlowFlash/);
});

test("VectorCompare: sync zoom preset command bar wired", () => {
  assert.match(
    read("src/features/vector/components/VectorCompareCommandBar.tsx"),
    /vector-compare-sync-zoom/
  );
  assert.match(read("src/features/vector/components/VectorCompareDesk.tsx"), /applySyncZoomPreset/);
  assert.match(read("src/features/vector/components/VectorChart.tsx"), /compareSync\?\.zoomPreset/);
  assert.match(read("src/features/vector/lib/vector-compare-sync.ts"), /VectorCompareZoomPresetSync/);
});

test("VectorChart: member drawing tools wired", () => {
  const src = read("src/features/vector/components/VectorChart.tsx");
  const toolbar = read("src/features/vector/components/VectorToolbar.tsx");
  assert.match(src, /drawTools=\{/);
  assert.match(toolbar, /VectorDrawToolsMenu/);
  assert.match(src, /UserDrawingsPrimitive/);
  assert.match(src, /useVectorChartDrawings/);
  assert.match(read("src/features/vector/lib/vector-drawings-store.ts"), /vector:drawings:v1:/);
});

test("Vector desk: toolbar can portal full-width above the page grid", () => {
  const chart = read("src/features/vector/components/VectorChart.tsx");
  const shell = read("src/features/vector/components/VectorPageShell.tsx");
  assert.match(chart, /toolbarPortalEl/);
  assert.match(chart, /createPortal\(toolbar, toolbarPortalEl\)/);
  assert.match(shell, /vector-page-toolbar/);
  assert.match(shell, /toolbarPortalEl=\{toolbarPortalEl\}/);
});

test("VectorChart: crosshair hover throttled to animation frame", () => {
  const src = read("src/features/vector/components/VectorChart.tsx");
  assert.match(src, /scheduleCrosshairUpdate/);
  assert.match(src, /vectorCrosshairStatesEqual/);
  assert.match(src, /renderVectorCrosshairLegend/);
  assert.match(read("src/features/vector/components/VectorCrosshairLegend.tsx"), /renderVectorCrosshairLegend/);
});

test("VectorChart: extended-hours background shade wired", () => {
  const src = read("src/features/vector/components/VectorChart.tsx");
  assert.match(src, /ExtendedHoursShadePrimitive/);
  assert.match(src, /extendedHoursShadeBands/);
  assert.match(read("src/features/vector/lib/vector-session-hours.ts"), /extendedHoursShadeBands/);
});

test("VectorChart: manual zoom/pan blocks programmatic session refits", () => {
  const src = read("src/features/vector/components/VectorChart.tsx");
  assert.match(src, /function memberViewportLocked/);
  assert.match(src, /chartUserPannedRef\.current = true/);
  assert.match(src, /memberViewportLocked\(chartUserPannedRef\.current, wheelZoomCooldownRef\.current\)/);
  assert.match(src, /sessionFramed && !following && !viewportLocked/);
  assert.match(src, /Wall-history poll runs every 5s/);
  // Poll cadence follows server-resolved wallTrailSec (5s universe / 15s on-demand), not static client guess.
  assert.match(src, /scopePollMs = vectorComparePerfPollMs/);
  assert.match(src, /wallTrailSecRef/);
  assert.match(src, /vectorWallTrailSecClient/);
});

test("vector-chart-viewport: session time range uses lastSessionBars", () => {
  const lib = read("src/features/vector/lib/vector-chart-viewport.ts");
  assert.match(lib, /lastSessionBars/);
  assert.match(lib, /setVisibleRange/);
  assert.match(lib, /setVisibleLogicalRange/);
});

// ---------------------------------------------------------------------------------------------
// FINDINGS 2026-08-07 — "no beads on most of the chart", reported on AMD, META and every other
// single name. The rail was healthy (AMD: 1,111 samples, 04:00 → 23:40 ET, full session); the
// chart simply framed THREE sessions of bars (2,645, Aug 4 04:00 → Aug 6 19:59) against a rail
// trimmed to ONE, so beads could only ever cover the newest ~25% of the x-axis.
// ---------------------------------------------------------------------------------------------

test("wantsSessionOverviewViewport: session viewport frames the session for EVERY ticker/lens", async () => {
  const { wantsSessionOverviewViewport } = await import(
    "@/features/vector/lib/vector-chart-viewport"
  );
  // The predicate takes exactly two inputs. A third (the DTE horizon) is what scoped #868's fix to
  // SPX/SPY/QQQ and left every single name broken for two and a half weeks.
  assert.equal(wantsSessionOverviewViewport.length, 2, "must not take a horizon argument");
  assert.equal(wantsSessionOverviewViewport("session", false), true);
  assert.equal(wantsSessionOverviewViewport("live", false), false, "live viewport follows the tape");
  assert.equal(
    wantsSessionOverviewViewport("session", true),
    false,
    "once the member opts into live-follow, stop refitting under them"
  );
});

test("no caller reintroduces a horizon condition on the session viewport", () => {
  const src = read("src/features/vector/components/VectorChart.tsx");
  const lib = read("src/features/vector/lib/vector-chart-viewport.ts");
  // A third argument at any call site means the horizon (or some other lens) is gating the fit
  // again — the exact shape of the original bug.
  for (const [name, text] of [["VectorChart.tsx", src], ["vector-chart-viewport.ts", lib]] as const) {
    for (const call of text.match(/wantsSessionOverviewViewport\([^)]*\)/gs) ?? []) {
      const args = call.slice(call.indexOf("(") + 1, call.lastIndexOf(")"));
      const arity = args.trim() ? args.split(",").filter((a) => a.trim()).length : 0;
      assert.ok(arity <= 2, `${name}: ${call.replace(/\s+/g, " ")} passes ${arity} args`);
      assert.ok(
        !/dteHorizon|DteHorizon/.test(args),
        `${name}: the session fit must not depend on the DTE horizon — ${call.replace(/\s+/g, " ")}`
      );
    }
  }
});

// ---------------------------------------------------------------------------------------------
// FINDINGS 2026-08-07 — the SPX Slayer dashboard drew no recorded beads outside the 0DTE horizon.
// Four layers each assumed the blended "all" rail is SSR-seeded; the dashboard embed deliberately
// passes initialWallHistory={[]} (a cold Polygon reconstruct can block the HTML for 30–90s), so
// the blended rail was structurally always empty there. These pin the seed-less path open.
// ---------------------------------------------------------------------------------------------

test("wall-history route serves the blended 'all' rail instead of short-circuiting it away", () => {
  const route = read("src/app/api/market/vector/wall-history/route.ts");
  assert.doesNotMatch(
    route,
    /if \(horizon === "all" \|\| !session\)/,
    'the "all" short-circuit is the bug — a caller with no SSR seed could never obtain the rail'
  );
  assert.match(route, /horizon === "all"\s*\?\s*loadSessionWallHistory\(session, ticker\)/);
  assert.match(route, /loadSessionWallHistory\(session, ticker, horizon\)/);
  assert.match(route, /if \(!session\)/);
  assert.match(route, /enrichSessionWallHistory/, "blended rail must gap-fill like SSR seed");
});

test("VectorChart: session overview tightens vertical autoscale for readable beads", () => {
  const src = read("src/features/vector/components/VectorChart.tsx");
  assert.match(src, /SESSION_OVERVIEW_BEAD_VIEW_MAX_PCT/);
  assert.match(src, /SESSION_OVERVIEW_MAX_SPAN_PCT/);
  assert.match(src, /clampPriceRangeSpan/);
  assert.match(src, /sessionOverviewFrame/);
});

test("VectorChart: session viewport keeps the full-day bead rail during live RTH", () => {
  const src = read("src/features/vector/components/VectorChart.tsx");
  assert.match(
    src,
    /liveSessionRef\.current && !replayModeRef\.current && !sessionOverview/
  );
  assert.match(src, /const sessionOverview = wantsSessionOverviewViewport/);
});

test("VectorChart: refreshTrails is a no-op during replay so applyFrame owns the bead rail", () => {
  const src = read("src/features/vector/components/VectorChart.tsx");
  assert.match(src, /if \(replayModeRef\.current\) return;/);
  assert.match(src, /alignWallHistoryToBarTimes/);
  assert.match(src, /applyFrameRef\.current/);
});

test("VectorChart: live 'all' horizon polls enriched blended history during RTH", () => {
  const src = read("src/features/vector/components/VectorChart.tsx");
  assert.match(src, /fetchBlendedHistory/);
  assert.match(src, /dteHorizon === "all" && !seedRailEmptyRef\.current/);
  assert.match(src, /mergeWallHistory\(wallHistoryRef\.current, remote\)/);
});

test("Vector desk defaults to weekly DTE when host does not override", () => {
  const chart = read("src/features/vector/components/VectorChart.tsx");
  assert.match(chart, /VECTOR_DEFAULT_DTE_HORIZON/);
  const horizon = read("src/features/vector/lib/vector-dte-horizon.ts");
  assert.match(horizon, /VECTOR_DEFAULT_DTE_HORIZON: VectorDteHorizon = "weekly"/);
});

test("VectorChart fetches and uses the blended rail when it was given no seed", () => {
  const src = read("src/features/vector/components/VectorChart.tsx");
  assert.match(src, /const seedRailEmpty = initialWallHistory\.length === 0/);
  // The "all" horizon must not skip its fetch when there is no seed to fall back on...
  assert.match(src, /dteHorizon === "all" && !seedRailEmptyRef\.current/);
  // ...and the fetched rail must be allowed through as a recorded trail source.
  assert.match(src, /horizon !== "all" \|\| seedRailEmptyRef\.current/);
});

test("VectorPageShell: chart view toggle stays mounted when historical chart replaces intraday", () => {
  const shell = read("src/features/vector/components/VectorPageShell.tsx");
  assert.match(shell, /vector-chart-column-head/);
  assert.match(shell, /data-testid="vector-chart-column-head"/);
  assert.match(shell, /chartColumnHead/);
  assert.match(shell, /chartView === "intraday" \? \(\s*chartBlock/);
  assert.match(shell, /VectorDailyChart/);
  assert.doesNotMatch(
    shell,
    /chartLead[\s\S]{0,400}VectorChartViewSelect/,
    "view select must not live only inside VectorChart leadSlot"
  );
});

test("VectorChartViewSelect: segmented Intraday/4H/1D/1W control", () => {
  const src = read("src/features/vector/components/VectorChartViewSelect.tsx");
  assert.match(src, /vector-chart-view-\$\{opt\.value\.toLowerCase\(\)\}/);
  assert.match(src, /aria-pressed/);
  assert.doesNotMatch(src, /<select/);
});
