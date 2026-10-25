import { test } from "node:test";
import assert from "node:assert/strict";

import {
  discoverMomentumSetups,
  momentumScanUniverse,
  todayExpiryChainRows,
  type MomentumDiscoveryDeps,
} from "./momentum-signal-discovery.ts";
import type { RelativeVolumeShadowRead } from "./relative-volume-source.ts";

const RTH_NOW_ET_MINUTES = 11 * 60; // 11:00 ET — inside the [9:30, 15:30) commit window.
const TODAY = "2026-07-06"; // 2026-07-06 is EDT: 13:30 UTC = 9:30 ET.
const OPEN_MS = Date.parse("2026-07-06T13:30:00Z");
const M = 60_000;

function bar(minAfterOpen: number, px: number): { t: number; o: number; h: number; l: number; c: number; v: number } {
  return { t: OPEN_MS + minAfterOpen * M, o: px, h: px + 0.5, l: px - 0.5, c: px, v: 1000 };
}

/** OR flat ~100 for 30 min, flat ~100 for another 50, then a genuine 5m acceleration up through
 *  100.8 — same shape as momentum-signal.test.ts's own UP_BARS, built as real ET-anchored bars. */
function confirmedUpBars() {
  const bars = [];
  for (let i = 0; i < 80; i++) bars.push(bar(i, 100));
  bars.push(bar(80, 100.01), bar(81, 100.02), bar(82, 100.03), bar(83, 100.04), bar(84, 100.04));
  bars.push(bar(85, 100.1), bar(86, 100.2), bar(87, 100.4), bar(88, 100.6), bar(89, 100.8));
  return bars;
}

/** Flat all the way through — never accelerates, never confirms. */
function flatBars() {
  return Array.from({ length: 90 }, (_, i) => bar(i, 100));
}

function highRvol(ratio = 2.0): RelativeVolumeShadowRead {
  return {
    baseline: { ratio, classification: "very_high", session_fraction_elapsed: 0.3, expected_fraction_source: "flat_proration" },
    candidate: { ratio, classification: "very_high", session_fraction_elapsed: 0.3, expected_fraction_source: "flat_proration" },
    avg_daily_volume: 10_000_000,
    profile_days_used: null,
  };
}

function lowRvol(ratio = 1.0): RelativeVolumeShadowRead {
  return {
    baseline: { ratio, classification: "normal", session_fraction_elapsed: 0.3, expected_fraction_source: "flat_proration" },
    candidate: { ratio, classification: "normal", session_fraction_elapsed: 0.3, expected_fraction_source: "flat_proration" },
    avg_daily_volume: 10_000_000,
    profile_days_used: null,
  };
}

function cheapTodayRow() {
  return {
    expiry: TODAY,
    strike: 101,
    call_bid: 0.5,
    call_ask: 0.6,
    call_oi: 500,
    call_iv: 0.4,
    put_bid: 0.5,
    put_ask: 0.6,
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
      return confirmedUpBars();
    }) as MomentumDiscoveryDeps["fetchMinuteBars"],
    resolveChain: (async () => {
      calls.resolveChain++;
      return { spot: 100.8, rows: [cheapTodayRow()] };
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
  assert.ok(rows.every((r) => r.strike === 101));
  assert.deepEqual(new Set(rows.map((r) => r.side)), new Set(["call", "put"]));
});

test("todayExpiryChainRows: a ticker with no same-day listing returns an empty array, never fabricated", () => {
  const rows = todayExpiryChainRows([{ ...cheapTodayRow(), expiry: "2026-07-10" }], TODAY);
  assert.deepEqual(rows, []);
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

test("discoverMomentumSetups: a confirmed momentum+RVOL ticker with a cheap same-day contract produces a MOMENTUM setup", async () => {
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
});

test("discoverMomentumSetups: low RVOL never reaches a chain fetch (cheap pre-check saves the budget)", async () => {
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
  assert.equal(calls.resolveChain, 0, "the chain fetch must never run for a ticker that failed the detection pre-check");
});

test("discoverMomentumSetups: flat bars (no accelerating move) never reach a chain fetch", async () => {
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
    resolveChain: (async () => ({ spot: 100.8, rows: [{ ...cheapTodayRow(), expiry: "2026-07-10" }] })) as MomentumDiscoveryDeps["resolveChain"],
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

test("discoverMomentumSetups: an ask at/above the $1.00 band is hard-rejected, never committed", async () => {
  const { deps } = makeDeps({
    resolveChain: (async () => ({
      spot: 100.8,
      rows: [{ ...cheapTodayRow(), call_ask: 1.5, call_bid: 1.4 }],
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
  // gets a minute-bar fetch, and with every ticker wired to the SAME confirmed-up fixture, every
  // one should qualify and produce a setup.
  assert.equal(outcome.status, "ok");
  assert.equal(calls.fetchMinuteBars, 10);
  assert.equal(outcome.setups.length, 10);
});
