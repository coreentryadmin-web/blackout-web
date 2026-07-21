import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

test("SPX embed seeds 0DTE horizon history and opens on session viewport", () => {
  assert.match(
    read("src/app/(site)/dashboard/page.tsx"),
    /loadVectorSeedProps\("SPX", \{ seedDteHorizon: "0dte" \}\)/
  );
  const shell = read("src/features/vector/components/VectorPageShell.tsx");
  assert.match(shell, /defaultChartViewport = "session"/);
  assert.match(shell, /defaultChartViewport=\{defaultChartViewport\}/);
  assert.match(shell, /initialHorizonWallHistory=\{initialHorizonWallHistory\}/);
});

test("/vector page preloads 0DTE rail and opens on session viewport for SPX", () => {
  const page = read("src/app/(site)/vector/page.tsx");
  assert.match(page, /seedDteHorizon: "0dte"/);
  assert.match(page, /defaultDteHorizon=\{ticker === "SPX" \? "0dte" : undefined\}/);
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
});

test("vector-chart-viewport: session logical range uses lastSessionBars", () => {
  const lib = read("src/features/vector/lib/vector-chart-viewport.ts");
  assert.match(lib, /lastSessionBars/);
  assert.match(lib, /setVisibleLogicalRange/);
});
