import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Regression: off-hours pulse must not clobber lastPulseForSignals with price:0 or serve
 * empty shells when the matrix already has a grounded spot (platform-integrity spx-desk-spot).
 */
test("buildSpxDeskPulse: closed market reuses lastPulseForSignals instead of price:0", () => {
  const src = readFileSync(join(process.cwd(), "src/features/spx/lib/spx-desk.ts"), "utf8");
  assert.match(
    src,
    /if \(!rthOpen && !premarketPlan\) \{[\s\S]*lastPulseForSignals\?\.price[\s\S]*market_label: label/,
    "closed-market branch must return last good pulse when available"
  );
  assert.doesNotMatch(
    src,
    /lastPulseForSignals = closedPulse/,
    "must not overwrite lastPulseForSignals with a zero-price closed shell"
  );
});

test("buildSpxDesk: falls back to lastPulseForSignals when index snap is empty", () => {
  const src = readFileSync(join(process.cwd(), "src/features/spx/lib/spx-desk.ts"), "utf8");
  assert.match(
    src,
    /const price =[\s\S]*spxSnap\?\.price \?\? lastPulseForSignals\?\.price \?\? priorFromBars\.pdc \?\? 0;/,
    "full desk build must reuse last RTH print or prior session close off-hours"
  );
});

test("buildSpxDeskPulse: cold replica off-hours falls back to priorDayForPulseLane pdc", () => {
  const src = readFileSync(join(process.cwd(), "src/features/spx/lib/spx-desk.ts"), "utf8");
  assert.match(
    src,
    /if \(!rthOpen && !premarketPlan\) \{[\s\S]*priorDayForPulseLane\(\)[\s\S]*prior\.pdc/,
    "closed-market branch must anchor to prior session close when lastPulse is empty"
  );
});

test("buildSpxDeskPulse: cold replica awaits the real prior-day fetch when priorDayForPulseLane is still empty", () => {
  // priorDayForPulseLane() is "never block cold" — on a true cold cache it fires
  // fetchPriorDayCached() in the background and returns pdc:null immediately, so the FIRST
  // off-hours request after a rollout must not stop at that null; it needs to await the real
  // fetch (fetchPriorDayCached is idempotent — returns the fresh cache if another caller already
  // populated it) before falling through to the empty/closedPulse shell.
  const src = readFileSync(join(process.cwd(), "src/features/spx/lib/spx-desk.ts"), "utf8");
  assert.match(
    src,
    /if \(!rthOpen && !premarketPlan\) \{[\s\S]*let prior = await priorDayForPulseLane\(\);\s*\n\s*if \(!\(prior\.pdc != null && prior\.pdc > 0\)\) \{\s*\n\s*prior = await fetchPriorDayCached\(\)\.catch\(\(\) => prior\);/,
    "closed-market branch must await fetchPriorDayCached() when the fire-and-forget priorDayForPulseLane() is still empty"
  );
});

test("buildSpxDeskPulse: cold replica prefers TODAY's own close once the regular session has closed (2026-09-12 fix)", () => {
  // Root-cause fix for the live 2026-09-12 bug: `prior` above (priorDayForPulseLane /
  // fetchPriorDayCached) is EXCLUSIVE of today by design (correct for RTH/pivot callers), so
  // once today's own session has genuinely closed (label === "EXTENDED", still the same ET
  // calendar day) it must be overridden with today's own settled bar rather than served as-is
  // — otherwise a cold replica serves a stale prior-day close as "today's" off-hours price.
  const src = readFileSync(join(process.cwd(), "src/features/spx/lib/spx-desk.ts"), "utf8");
  assert.match(
    src,
    /if \(!rthOpen && !premarketPlan\) \{[\s\S]*let prior = await priorDayForPulseLane\(\);[\s\S]*if \(label === "EXTENDED"\) \{\s*\n\s*const todaysOwnClose = await fetchTodaysOwnCloseIfSessionComplete\(\)\.catch\(\(\) => null\);\s*\n\s*if \(todaysOwnClose\?\.pdc != null && todaysOwnClose\.pdc > 0\) \{\s*\n\s*prior = todaysOwnClose;/,
    "closed-market branch must override the exclusive-of-today prior with today's own close once the session is EXTENDED"
  );
});

test("fetchTodaysOwnCloseIfSessionComplete: calls priorDayFromDailyBars with anchorSessionComplete=true", () => {
  const src = readFileSync(join(process.cwd(), "src/features/spx/lib/spx-desk.ts"), "utf8");
  assert.match(
    src,
    /async function fetchTodaysOwnCloseIfSessionComplete\(\)[\s\S]*?return priorDayFromDailyBars\(bars, today, true\);/,
    "must pass anchorSessionComplete=true so today's own settled bar is eligible, not skipped"
  );
});

test("buildSpxDeskPulseMinimal: price chain includes prior.pdc", () => {
  const src = readFileSync(join(process.cwd(), "src/features/spx/lib/spx-desk.ts"), "utf8");
  const minimalIdx = src.indexOf("export async function buildSpxDeskPulseMinimal");
  const priceLine = src.slice(minimalIdx).match(
    /const price = spxSnap\?\.price \?\? lastPulseForSignals\?\.price \?\? prior\.pdc \?\? 0;/
  );
  assert.ok(priceLine, "minimal pulse must fall back to prior.pdc on cold cache");
});

test("stickyDeskGexFallback: preserves gex_net, gex_king, max_pain from last good state", () => {
  const src = readFileSync(join(process.cwd(), "src/features/spx/lib/spx-desk.ts"), "utf8");
  assert.match(
    src,
    /lastGoodGexNet: number \| null = null;/,
    "must declare sticky variable for gex_net"
  );
  assert.match(
    src,
    /lastGoodGexKing: number \| null = null;/,
    "must declare sticky variable for gex_king"
  );
  assert.match(
    src,
    /lastGoodMaxPain: number \| null = null;/,
    "must declare sticky variable for max_pain"
  );
  assert.match(
    src,
    /function stickyDeskGexFallback[\s\S]*gex_net: lastGoodGexNet,/,
    "stickyDeskGexFallback must return lastGoodGexNet instead of null"
  );
  assert.match(
    src,
    /function stickyDeskGexFallback[\s\S]*gex_king: lastGoodGexKing,/,
    "stickyDeskGexFallback must return lastGoodGexKing instead of null"
  );
  assert.match(
    src,
    /function stickyDeskGexFallback[\s\S]*max_pain: lastGoodMaxPain,/,
    "stickyDeskGexFallback must return lastGoodMaxPain instead of null"
  );
  assert.match(
    src,
    /lastGoodGexNet = pos\.net_gex;/,
    "resolveCanonicalDeskGex must capture net_gex from fresh fetch"
  );
  assert.match(
    src,
    /lastGoodGexKing = king;/,
    "resolveCanonicalDeskGex must capture king from fresh fetch"
  );
  assert.match(
    src,
    /lastGoodMaxPain = pos\.max_pain;/,
    "resolveCanonicalDeskGex must capture max_pain from fresh fetch"
  );
});
