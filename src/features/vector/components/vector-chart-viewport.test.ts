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
  // Poll cadence follows server-resolved wallTrailSec (5s universe / 15s on-demand), not static client guess.
  assert.match(src, /scopePollMs = wallTrailSec \* 1000/);
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

test("VectorChart: session viewport keeps the full-day bead rail during live RTH", () => {
  const src = read("src/features/vector/components/VectorChart.tsx");
  assert.match(
    src,
    /liveSessionRef\.current && !replayModeRef\.current && !sessionOverview/
  );
  assert.match(src, /const sessionOverview = wantsSessionOverviewViewport/);
});

test("VectorChart fetches and uses the blended rail when it was given no seed", () => {
  const src = read("src/features/vector/components/VectorChart.tsx");
  assert.match(src, /const seedRailEmpty = initialWallHistory\.length === 0/);
  // The "all" horizon must not skip its fetch when there is no seed to fall back on...
  assert.match(src, /dteHorizon === "all" && !seedRailEmptyRef\.current/);
  // ...and the fetched rail must be allowed through as a recorded trail source.
  assert.match(src, /horizon !== "all" \|\| seedRailEmptyRef\.current/);
});
