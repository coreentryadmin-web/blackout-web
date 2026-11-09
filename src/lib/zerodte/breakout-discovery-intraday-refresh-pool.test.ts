// BUG FIX (2026-11-09, task #95 — sibling of PR #7832's swing-discovery fix). `discoverBreakoutSetups`'s
// Wave-C1 intraday-structure minute-bar refresh (gated by BREAKOUT_INTRADAY_REFRESH) used to fan out
// up to BREAKOUT_INTRADAY_REFRESH_LIMIT (40) concurrent `fetchStockMinuteBars` calls via a bare
// `Promise.all`, with no local concurrency bound of its own — relying entirely on the shared
// cluster-wide Polygon circuit breaker (polygon-rate-limiter.ts) to self-regulate. Now routed through
// `runPolygonPool` (default concurrency 8), the same established fix PR #7832 applied to
// swing-discovery's own duplicate copy of this logic.
//
// THIS IS A SEPARATE TEST FILE, DELIBERATELY: `BREAKOUT_INTRADAY_REFRESH` is a module-top-level
// `const` captured once at `breakout-discovery.ts`'s module evaluation from
// `process.env.BREAKOUT_INTRADAY_REFRESH` (see that file's own `envFlag` helper). `node --test` with
// multiple file args runs each file in its own child process, so setting the env var here cannot
// leak into breakout-discovery.test.ts (which relies on the flag defaulting OFF) or any other file.
//
// WITHIN this file, the module under test must be loaded via a DYNAMIC `import()`, not a static
// `import ... from`. ES module semantics hoist every static import declaration above all other
// top-level code in the file, REGARDLESS of its source position — so a static
// `import { discoverBreakoutSetups } from "./breakout-discovery"` would still evaluate
// breakout-discovery.ts (and capture BREAKOUT_INTRADAY_REFRESH from process.env) BEFORE the
// `process.env.BREAKOUT_INTRADAY_REFRESH = "1"` line below ever runs, no matter where that line sits
// in the source (confirmed live: a first draft of this file did exactly that and still read the flag
// as false). A dynamic `import()` is an ordinary function call, evaluated in normal top-to-bottom
// order, so running it AFTER the env assignment works. Mirrors the established pattern in
// unusual-whales-abort-wiring.test.ts ("ONE import for the whole file" via a dynamic import after
// its own env setup) and polygon-largo-cancellation.test.ts's identical warning about this trap.
process.env.BREAKOUT_INTRADAY_REFRESH = "1";

import { test } from "node:test";
import assert from "node:assert/strict";
import type { DailyMarketBar } from "@/lib/providers/polygon";
import type { BreakoutMover } from "@/features/nighthawk/lib/candidates";
import type { BreakoutDiscoveryDeps } from "./breakout-discovery";

// Dynamic + loaded once for the whole file, AFTER the env mutation above (see the file-header note).
const breakoutDiscoveryPromise = import("./breakout-discovery");

const RTH_NOW_ET_MINUTES = 11 * 60; // 11:00 ET — inside the [9:30, 15:30) commit window.
const MOVER_COUNT = 20; // comfortably > the pool's concurrency (8), well under the 40 refresh limit.
const DELAY_MS = 15; // long enough that an unbounded fan-out and a pooled one are distinguishable.

/** A fresh, same-session grouped-daily bar for ticker `i` (passes the WS-19 freshness gate). */
function freshBar(i: number, nowMs: number): DailyMarketBar {
  const t = nowMs - 19 * 3_600_000; // ~19h old — same-session, well under the 24h staleness cap.
  return { T: `TICK${i}`, o: 100, h: 130, l: 99, c: 129 + i, vw: 120, v: 5_000_000 + i, t };
}

test("sanity: BREAKOUT_INTRADAY_REFRESH is ON for this test file (else the rest of this file tests nothing)", async () => {
  const { BREAKOUT_INTRADAY_REFRESH } = await breakoutDiscoveryPromise;
  assert.equal(BREAKOUT_INTRADAY_REFRESH, true);
});

test("discoverBreakoutSetups: BREAKOUT_INTRADAY_REFRESH minute-bar fan-out is concurrency-bounded via runPolygonPool, not a bare Promise.all", async () => {
  const { discoverBreakoutSetups } = await breakoutDiscoveryPromise;
  const now = Date.parse("2026-07-24T15:00:00Z");
  const bars = Array.from({ length: MOVER_COUNT }, (_, i) => freshBar(i, now));

  let inFlight = 0;
  let maxInFlight = 0;
  let totalCalls = 0;
  const seenTickers = new Set<string>();

  // Records concurrency directly, which is a strictly stronger proof than a source-text assertion:
  // a bare `Promise.all` would push `inFlight` to MOVER_COUNT (20) immediately; a pool bounded to 8
  // can never let `maxInFlight` exceed 8 regardless of how many tickers are queued.
  const fetchMinuteBars: BreakoutDiscoveryDeps["fetchMinuteBars"] = async (ticker: string) => {
    totalCalls += 1;
    seenTickers.add(ticker);
    inFlight += 1;
    maxInFlight = Math.max(maxInFlight, inFlight);
    await new Promise((resolve) => setTimeout(resolve, DELAY_MS));
    inFlight -= 1;
    return [];
  };

  const deps: Partial<BreakoutDiscoveryDeps> = {
    fetchSummary: (async () => ({ results: bars })) as unknown as BreakoutDiscoveryDeps["fetchSummary"],
    // Every bar qualifies as a (long) mover; breakdowns side left empty so `tickers` below is just
    // this cohort, deduped — isolates the fan-out under test from the rest of the pipeline.
    screen: ((results: Parameters<BreakoutDiscoveryDeps["screen"]>[0]) =>
      (results as DailyMarketBar[]).map(
        (r): BreakoutMover => ({
          ticker: r.T,
          gain: 0.25,
          volume: r.v,
          close_strength: 0.95,
          dollar: r.c * r.v,
          bar: { h: r.h || 130, l: r.l || 99, o: r.o || 100 },
        })
      )) as BreakoutDiscoveryDeps["screen"],
    screenBreakdowns: (() => [] as BreakoutMover[]) as BreakoutDiscoveryDeps["screenBreakdowns"],
    // No chain available for any ticker — short-circuits straight to a "no_chain" miss per
    // candidate, so the chain-fetch stage (already-bounded, out of scope here) never runs at all;
    // this isolates the minute-bar refresh fan-out as the only concurrent I/O in this test.
    resolveChain: (async () => null) as unknown as BreakoutDiscoveryDeps["resolveChain"],
    fetchMinuteBars,
  };

  const out = await discoverBreakoutSetups({
    today: "2026-07-24",
    nowEtMinutes: RTH_NOW_ET_MINUTES,
    excludeTickers: new Set(),
    nowMs: now,
    deps,
  });

  assert.equal(out.status, "ok");
  assert.equal(totalCalls, MOVER_COUNT, "every qualifying ticker must still be refreshed — pooling paces, never drops");
  assert.equal(seenTickers.size, MOVER_COUNT, "every ticker must be distinct (no duplicate/missed fetches)");
  assert.ok(
    maxInFlight <= 8,
    `minute-bar refresh must never exceed the pool's default concurrency (8); observed ${maxInFlight} ` +
      `concurrent calls out of ${MOVER_COUNT} queued — a bare Promise.all would show ${MOVER_COUNT}`
  );
  assert.ok(maxInFlight > 1, "sanity: the pool must still run tasks concurrently, not strictly one-at-a-time");
});
