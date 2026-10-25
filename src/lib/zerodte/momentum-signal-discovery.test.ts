import { test } from "node:test";
import assert from "node:assert/strict";

import {
  discoverMomentumSetups,
  momentumScanUniverse,
  todayExpiryChainRows,
  rateByRvol,
  type MomentumDiscoveryDeps,
} from "./momentum-signal-discovery.ts";
import type { RelativeVolumeShadowRead } from "./relative-volume-source.ts";

const RTH_NOW_ET_MINUTES = 11 * 60; // 11:00 ET — inside the [9:30, 15:30) commit window.
const TODAY = "2026-07-06"; // 2026-07-06 is EDT: 13:30 UTC = 9:30 ET.
const OPEN_MS = Date.parse("2026-07-06T13:30:00Z");
const M = 60_000;

function bar(i: number, h: number, l: number, c: number, v = 1000): { t: number; o: number; h: number; l: number; c: number; v: number } {
  return { t: OPEN_MS + i * M, o: c, h, l, c, v };
}

/** 60 real, ET-anchored lookback bars establishing a LONG-setup level at 110 (one bar reaches
 *  h=110, the rest of the lookback window is a wide, noisy range), then 15 compression bars
 *  coiling tightly just under 110 — the exact fixture shape early-entry-state.test.ts's own
 *  `baseLongBars` uses, just with real epoch timestamps so a live-shaped `fetchMinuteBars` fake
 *  can return it. A breakout bar (minute 75) closes decisively above the trigger. */
function confirmedCoilAndBreakoutBars() {
  const bars = [];
  for (let i = 0; i < 59; i++) bars.push(bar(i, 103 + (i % 3), 95, 100));
  bars.push(bar(59, 110, 100, 105));
  for (let i = 60; i < 75; i++) {
    const touchesLevel = i === 62 || i === 69;
    bars.push(bar(i, touchesLevel ? 109.85 : 109.3, 108.8, 109.1));
  }
  bars.push(bar(75, 111.5, 109.5, 111.2)); // the real breakout
  return bars;
}

/** The same coil, but with NO breakout bar appended -- stays WATCH, never reaches ENTRY. */
function coilOnlyBars() {
  return confirmedCoilAndBreakoutBars().slice(0, 75);
}

/** Flat all the way through — never coils, never confirms. */
function flatBars() {
  return Array.from({ length: 90 }, (_, i) => bar(i, 100.5, 99.5, 100));
}

// `discoverMomentumSetups` recomputes a REAL per-minute RVOL ratio from the bars' own cumulative
// volume + flat proration (rateByRvol) -- it does NOT read computeRvolShadow's own `.baseline`/
// `.candidate` ratio fields (those are a single "as of now" read; a per-minute walk needs a
// ratio at EVERY minute, which only `avg_daily_volume` can drive). So what matters for these
// fixtures is `avg_daily_volume`, sized against confirmedCoilAndBreakoutBars's real v=1000/bar
// cumulative volume -- 150,000 clears the 1.5x floor by minute 74 (the watch/entry window);
// 10,000,000 (highRvol's old value) never would have.
function highRvol(): RelativeVolumeShadowRead {
  return {
    baseline: { ratio: 2.0, classification: "very_high", session_fraction_elapsed: 0.3, expected_fraction_source: "flat_proration" },
    candidate: { ratio: 2.0, classification: "very_high", session_fraction_elapsed: 0.3, expected_fraction_source: "flat_proration" },
    avg_daily_volume: 150_000,
    profile_days_used: null,
  };
}

function lowRvol(): RelativeVolumeShadowRead {
  return {
    baseline: { ratio: 0.1, classification: "low", session_fraction_elapsed: 0.3, expected_fraction_source: "flat_proration" },
    candidate: { ratio: 0.1, classification: "low", session_fraction_elapsed: 0.3, expected_fraction_source: "flat_proration" },
    avg_daily_volume: 50_000_000,
    profile_days_used: null,
  };
}

function priceBandRow(overrides: Partial<ReturnType<typeof cheapTodayRow>> = {}) {
  return { ...cheapTodayRow(), ...overrides };
}

function cheapTodayRow() {
  return {
    expiry: TODAY,
    strike: 115,
    call_bid: 1.7,
    call_ask: 1.8,
    call_oi: 500,
    call_iv: 0.4,
    put_bid: 1.7,
    put_ask: 1.8,
    put_oi: 500,
    put_iv: 0.4,
  };
}

function makeDeps(over: Partial<MomentumDiscoveryDeps> = {}): {
  deps: Partial<MomentumDiscoveryDeps>;
  calls: { fetchMinuteBars: number; resolveChain: number; computeRvolShadow: number };
} {
  const calls = { fetchMinuteBars: 0, resolveChain: 0, computeRvolShadow: 0 };
  const deps: Partial<MomentumDiscoveryDeps> = {
    fetchMinuteBars: (async () => {
      calls.fetchMinuteBars++;
      return confirmedCoilAndBreakoutBars();
    }) as MomentumDiscoveryDeps["fetchMinuteBars"],
    resolveChain: (async () => {
      calls.resolveChain++;
      return { spot: 111.2, rows: [priceBandRow()] };
    }) as MomentumDiscoveryDeps["resolveChain"],
    computeRvolShadow: (async () => {
      calls.computeRvolShadow++;
      return highRvol();
    }) as MomentumDiscoveryDeps["computeRvolShadow"],
    ...over,
  };
  return { deps, calls };
}

test("momentumScanUniverse: collapses the SPXW spelling alias into SPX, never scans it as a second underlying", () => {
  const universe = momentumScanUniverse(new Set(["AAPL", "SPX", "SPXW", "QQQ"]));
  assert.ok(universe.includes("SPX"));
  assert.ok(!universe.includes("SPXW"));
  assert.equal(universe.length, 3);
});

test("todayExpiryChainRows: filters to TODAY's expiry only, emitting both call and put rows per strike", () => {
  const rows = todayExpiryChainRows(
    [cheapTodayRow(), { ...cheapTodayRow(), expiry: "2026-07-10", strike: 105 }],
    TODAY
  );
  assert.equal(rows.length, 2, "one call + one put row for the single today-expiry strike");
  assert.ok(rows.every((r) => r.strike === 115));
  assert.deepEqual(new Set(rows.map((r) => r.side)), new Set(["call", "put"]));
});

test("todayExpiryChainRows: a ticker with no same-day listing returns an empty array, never fabricated", () => {
  const rows = todayExpiryChainRows([{ ...cheapTodayRow(), expiry: "2026-07-10" }], TODAY);
  assert.deepEqual(rows, []);
});

test("rateByRvol: builds a real per-minute RVOL series from cumulative bar volume, flat proration", () => {
  // RVOL_MIN_ELAPSED_MINUTES (relative-volume.ts) floors the ratio to null for the first 3
  // elapsed RTH minutes -- need at least 4 bars (elapsed 0..3) before a real ratio appears.
  const bars = Array.from({ length: 4 }, (_, i) => bar(i, 100.5, 99.5, 100, 5000)).map((b) => ({ t: b.t, h: b.h, l: b.l, c: b.c, v: b.v }));
  const rated = rateByRvol(bars, 390_000); // avg daily volume -> ~1000/min flat expectation
  assert.equal(rated.length, 4);
  assert.equal(rated[2]!.rvolRatio, null, "still inside the 3-minute floor");
  assert.ok(rated[3]!.rvolRatio != null && rated[3]!.rvolRatio > 1, "20,000 cum shares by minute 3 vs a ~1000/min flat expectation is well above 1x");
});

test("rateByRvol: a null avgDailyVolume yields a null ratio throughout, never fabricated", () => {
  const bars = [bar(0, 100.5, 99.5, 100, 5000)].map((b) => ({ t: b.t, h: b.h, l: b.l, c: b.c, v: b.v }));
  const rated = rateByRvol(bars, null);
  assert.equal(rated[0]!.rvolRatio, null);
});

test("discoverMomentumSetups: outside the RTH commit window -> skip_off_hours, zero IO", () => {
  const { deps, calls } = makeDeps();
  return discoverMomentumSetups({
    today: TODAY,
    nowEtMinutes: 8 * 60, // 8:00 ET -- before the window
    excludeTickers: new Set(),
    includeTickers: new Set(["AAPL"]),
    deps,
  }).then((outcome) => {
    assert.equal(outcome.status, "skip_off_hours");
    assert.deepEqual(outcome.setups, []);
    assert.equal(calls.fetchMinuteBars, 0);
    assert.equal(calls.resolveChain, 0);
  });
});

test("discoverMomentumSetups: a confirmed coil+breakout ticker with a qualifying $1-$3 contract produces a MOMENTUM setup", async () => {
  const { deps } = makeDeps();
  const outcome = await discoverMomentumSetups({
    today: TODAY,
    nowEtMinutes: RTH_NOW_ET_MINUTES,
    excludeTickers: new Set(),
    includeTickers: new Set(["AAPL"]),
    deps,
  });
  assert.equal(outcome.status, "ok");
  assert.equal(outcome.setups.length, 1);
  const setup = outcome.setups[0]!;
  assert.deepEqual(setup.discovery_origin, ["MOMENTUM"]);
  assert.equal(setup.ticker, "AAPL");
  assert.equal(setup.direction, "long");
  assert.equal(setup.dte, 0);
  assert.equal(setup.top_strike, 115);
  assert.deepEqual(outcome.watches, [], "a fully-triggered ENTRY is not also reported as a WATCH");
});

test("discoverMomentumSetups: a coil that never breaks out is reported as a WATCH, not committed to the board", async () => {
  const { deps } = makeDeps({
    fetchMinuteBars: (async () => coilOnlyBars()) as MomentumDiscoveryDeps["fetchMinuteBars"],
  });
  const outcome = await discoverMomentumSetups({
    today: TODAY,
    nowEtMinutes: RTH_NOW_ET_MINUTES,
    excludeTickers: new Set(),
    includeTickers: new Set(["AAPL"]),
    deps,
  });
  assert.deepEqual(outcome.setups, [], "a WATCH is real, but never a committed board setup");
  assert.equal(outcome.watches.length, 1);
  assert.equal(outcome.watches[0]!.ticker, "AAPL");
  assert.equal(outcome.watches[0]!.direction, "long");
  assert.equal(outcome.watches[0]!.level, 110);
  assert.ok(outcome.watches[0]!.why_developing.length > 0);
});

test("discoverMomentumSetups: low RVOL never even forms a WATCH, and never reaches a chain fetch", async () => {
  const { deps, calls } = makeDeps({
    computeRvolShadow: (async () => {
      calls.computeRvolShadow++;
      return lowRvol();
    }) as MomentumDiscoveryDeps["computeRvolShadow"],
  });
  const outcome = await discoverMomentumSetups({
    today: TODAY,
    nowEtMinutes: RTH_NOW_ET_MINUTES,
    excludeTickers: new Set(),
    includeTickers: new Set(["AAPL"]),
    deps,
  });
  assert.equal(outcome.status, "ok");
  assert.deepEqual(outcome.setups, []);
  assert.deepEqual(outcome.watches, []);
  assert.equal(calls.resolveChain, 0, "the chain fetch must never run for a ticker that failed the detection pre-check");
});

test("discoverMomentumSetups: flat bars (no real coil) never reach a chain fetch", async () => {
  const { deps, calls } = makeDeps({
    fetchMinuteBars: (async () => {
      calls.fetchMinuteBars++;
      return flatBars();
    }) as MomentumDiscoveryDeps["fetchMinuteBars"],
  });
  const outcome = await discoverMomentumSetups({
    today: TODAY,
    nowEtMinutes: RTH_NOW_ET_MINUTES,
    excludeTickers: new Set(),
    includeTickers: new Set(["AAPL"]),
    deps,
  });
  assert.deepEqual(outcome.setups, []);
  assert.deepEqual(outcome.watches, []);
  assert.equal(calls.resolveChain, 0);
});

test("discoverMomentumSetups: excludeTickers drops a universe name before any fetch", async () => {
  const { deps, calls } = makeDeps();
  const outcome = await discoverMomentumSetups({
    today: TODAY,
    nowEtMinutes: RTH_NOW_ET_MINUTES,
    excludeTickers: new Set(["AAPL"]),
    includeTickers: new Set(["AAPL"]),
    deps,
  });
  assert.deepEqual(outcome.setups, []);
  assert.equal(calls.fetchMinuteBars, 0);
});

test("discoverMomentumSetups: a ticker with no same-day-expiry contract produces no setup despite confirming", async () => {
  const { deps } = makeDeps({
    resolveChain: (async () => ({ spot: 111.2, rows: [{ ...cheapTodayRow(), expiry: "2026-07-10" }] })) as MomentumDiscoveryDeps["resolveChain"],
  });
  const outcome = await discoverMomentumSetups({
    today: TODAY,
    nowEtMinutes: RTH_NOW_ET_MINUTES,
    excludeTickers: new Set(),
    includeTickers: new Set(["AAPL"]),
    deps,
  });
  assert.deepEqual(outcome.setups, []);
});

test("discoverMomentumSetups: a resolveChain throw is swallowed -- best-effort, one bad ticker never sinks the pass", async () => {
  const { deps } = makeDeps({
    resolveChain: (async () => {
      throw new Error("boom");
    }) as MomentumDiscoveryDeps["resolveChain"],
  });
  const outcome = await discoverMomentumSetups({
    today: TODAY,
    nowEtMinutes: RTH_NOW_ET_MINUTES,
    excludeTickers: new Set(),
    includeTickers: new Set(["AAPL"]),
    deps,
  });
  assert.equal(outcome.status, "ok");
  assert.deepEqual(outcome.setups, []);
});

test("discoverMomentumSetups: an ask ABOVE the $3.00 ceiling is hard-rejected, never committed (NO TRADE)", async () => {
  const { deps } = makeDeps({
    resolveChain: (async () => ({
      spot: 111.2,
      rows: [priceBandRow({ call_bid: 3.2, call_ask: 3.4 })],
    })) as MomentumDiscoveryDeps["resolveChain"],
  });
  const outcome = await discoverMomentumSetups({
    today: TODAY,
    nowEtMinutes: RTH_NOW_ET_MINUTES,
    excludeTickers: new Set(),
    includeTickers: new Set(["AAPL"]),
    deps,
  });
  assert.deepEqual(outcome.setups, []);
});

test("discoverMomentumSetups: an ask BELOW the $1.00 floor is also hard-rejected -- cheap alone never qualifies", async () => {
  const { deps } = makeDeps({
    resolveChain: (async () => ({
      spot: 111.2,
      rows: [priceBandRow({ call_bid: 0.3, call_ask: 0.4 })],
    })) as MomentumDiscoveryDeps["resolveChain"],
  });
  const outcome = await discoverMomentumSetups({
    today: TODAY,
    nowEtMinutes: RTH_NOW_ET_MINUTES,
    excludeTickers: new Set(),
    includeTickers: new Set(["AAPL"]),
    deps,
  });
  assert.deepEqual(outcome.setups, []);
});

test("discoverMomentumSetups: omitting includeTickers falls back to the real 0DTE ticker universe", async () => {
  const { deps, calls } = makeDeps();
  const outcome = await discoverMomentumSetups({
    today: TODAY,
    nowEtMinutes: RTH_NOW_ET_MINUTES,
    excludeTickers: new Set(),
    deps,
  });
  // The real default universe has 10 real underlyings (SPXW collapsed into SPX) -- every one
  // gets a minute-bar fetch, and with every ticker wired to the SAME confirmed coil+breakout
  // fixture, every one should qualify and produce a setup.
  assert.equal(outcome.status, "ok");
  assert.equal(calls.fetchMinuteBars, 10);
  assert.equal(outcome.setups.length, 10);
});
