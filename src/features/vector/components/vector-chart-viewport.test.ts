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

test("/vector page preloads 0DTE rail and opens on session viewport for oracle tickers", () => {
  const page = read("src/app/(site)/vector/page.tsx");
  assert.match(page, /VECTOR_ORACLE_TICKERS\.has\(ticker\)/);
  assert.match(page, /defaultDteHorizon=\{VECTOR_ORACLE_TICKERS\.has\(ticker\) \? "0dte" : undefined\}/);
  assert.match(page, /defaultChartViewport="session"/);
});

test("VectorChart: session viewport defers live-edge scroll until member pans", () => {
  const src = read("src/features/vector/components/VectorChart.tsx");
  assert.match(src, /liveFollowEnabledRef/);
  assert.match(src, /defaultChartViewport === "live"/);
  assert.match(src, /maybeScrollToLive\(chart, liveFollowEnabledRef\.current\)/);
  assert.match(src, /pinLiveAnchorBeads/);
  assert.match(src, /fitSessionOverview/);
  assert.match(src, /applySessionOverviewViewport/);
  assert.match(src, /wantsSessionOverviewViewport/);
});

test("VectorChart: manual zoom/pan blocks programmatic session refits", () => {
  const src = read("src/features/vector/components/VectorChart.tsx");
  assert.match(src, /function memberViewportLocked/);
  assert.match(src, /chartUserPannedRef\.current = true/);
  assert.match(src, /memberViewportLocked\(chartUserPannedRef\.current, wheelZoomCooldownRef\.current\)/);
  assert.match(src, /sessionOverview && !following && !viewportLocked/);
  assert.match(src, /Wall-history poll runs every 5s/);
  assert.match(src, /horizonHistoryRef/);
  assert.match(src, /VECTOR_WALL_TRAIL_SEC \* 1000/);
});

test("vector-chart-viewport: session time range uses lastSessionBars", () => {
  const lib = read("src/features/vector/lib/vector-chart-viewport.ts");
  assert.match(lib, /lastSessionBars/);
  assert.match(lib, /setVisibleRange/);
  assert.match(lib, /setVisibleLogicalRange/);
});
