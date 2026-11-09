import { before, test, mock } from "node:test";
import assert from "node:assert/strict";

import type { GexHeatmap } from "@/lib/providers/polygon-options-gex";

// pin-discovery.ts transitively imports "server-only" (via @/lib/providers/gex-positioning), which
// throws unconditionally outside Next's "react-server" module-resolution condition — same gotcha
// gex-positioning.test.ts already documents and works around. Stub it BEFORE the dynamic import
// below so plain `tsx --test` (no Next.js runtime) doesn't crash at module-load time.
mock.module("server-only", { namedExports: {} });

let discoverPinSetups: typeof import("./pin-discovery").discoverPinSetups;
let PIN_FETCH_FAILURE_RATE_THRESHOLD: typeof import("./pin-discovery").PIN_FETCH_FAILURE_RATE_THRESHOLD;

before(async () => {
  ({ discoverPinSetups, PIN_FETCH_FAILURE_RATE_THRESHOLD } = await import("./pin-discovery"));
});

// RTH, well inside the PIN directional window [9:30, 15:30) ET.
const RTH_NOW_ET_MINUTES = 11 * 60;

/**
 * FETCH-FAILURE-VS-GENUINE-EMPTY (found 2026-11-09, live production audit — the PIN half of the
 * gap breakout-discovery.ts's `skip_fetch_failed` fixed for BREAKOUT the same day, #7786).
 *
 * `discoverPinSetups` used to wrap both its per-ticker IO calls (`fetchGexHeatmap`,
 * `resolveTickerChainRows`) in a bare `.catch(() => null)`, which collapsed a THROWN upstream
 * error onto the IDENTICAL "no clean pin here" outcome a genuinely quiet, fully-fetched ticker
 * produces. These tests are the RED→GREEN proof that a near-universal fetch failure across the
 * evaluated universe is now reported as `skip_fetch_failed`, distinct from a genuine empty `ok`,
 * while a LONE flaky ticker among many (ordinary per-name flakiness) never trips it.
 */

/** Minimal GexHeatmap with a clean long-gamma pin bracketing `spot` between `putWall`/`callWall`,
 *  strong enough to clear evaluatePinRegime's dominance/band/offset floors (pin-source.ts:
 *  PIN_WALL_MIN_DOM_PCT=4, PIN_BAND_MIN/MAX_PCT=[0.4,6], PIN_MIN/MAX_OFFSET=[0.25,0.9]). Only the
 *  fields gexPositioningFromHeatmap/computeGexWalls actually read are populated — same minimal-
 *  fixture convention as gex-positioning.test.ts's own `makeHeatmap`. */
function cleanPinHeatmap(spot = 99): GexHeatmap {
  const putWall = 98;
  const callWall = 102;
  const strikeTotals: Record<string, number> = {
    [String(putWall)]: -1_000_000_000, // negative below spot -> put wall
    [String(callWall)]: 1_000_000_000, // positive above spot -> call wall
  };
  return {
    underlying: "TEST",
    spot,
    change_pct: 0,
    asof: new Date().toISOString(),
    expiries: ["2026-07-24"],
    strikes: [callWall, putWall],
    max_pain: null,
    gex: {
      cells: {},
      strike_totals: strikeTotals,
      call_wall: callWall,
      put_wall: putWall,
      total: 0,
      flip: null,
      regime: { flip: null, posture: "long", read: "" },
    },
    vex: {
      cells: {},
      strike_totals: {},
      pos_wall: null,
      neg_wall: null,
      total: 0,
      flip: null,
      regime: { posture: null, read: "" },
    },
    shift: { available: false, status: "collecting" },
    source: "polygon",
    data_delay: "test",
  } as unknown as GexHeatmap;
}

function chainRow(strike: number, expiry = "2026-07-24") {
  return {
    expiry,
    strike,
    call_bid: 1,
    call_ask: 1.1,
    call_delta: 0.5,
    call_oi: 500,
    put_bid: 1,
    put_ask: 1.1,
    put_delta: -0.5,
    put_oi: 500,
  };
}

// ── Scenario 1: ALL evaluated heatmap fetches THROW → skip_fetch_failed, never ok ───────────────

test("discoverPinSetups: every evaluated ticker's GEX heatmap fetch THROWS -> skip_fetch_failed, never ok", async () => {
  const universe = new Set(["SPY", "QQQ", "AAPL"]);
  const out = await discoverPinSetups({
    today: "2026-07-24",
    nowEtMinutes: RTH_NOW_ET_MINUTES,
    excludeTickers: new Set(),
    includeTickers: universe,
    deps: {
      fetchHeatmap: async () => {
        throw new Error("GET /api/market/gex-heatmap -> 403 (entitlement)");
      },
    },
  });
  assert.equal(out.status, "skip_fetch_failed");
  assert.notEqual(out.status, "ok"); // the exact conflation this fix removes
  assert.equal(out.setups.length, 0);
  assert.match(String(out.reason), /403/);
});

test("discoverPinSetups: a non-Error heatmap rejection still produces skip_fetch_failed (never throws out of the function)", async () => {
  const universe = new Set(["SPY", "QQQ", "AAPL"]);
  const out = await discoverPinSetups({
    today: "2026-07-24",
    nowEtMinutes: RTH_NOW_ET_MINUTES,
    excludeTickers: new Set(),
    includeTickers: universe,
    deps: {
      fetchHeatmap: async () => {
        // eslint-disable-next-line @typescript-eslint/only-throw-error
        throw "rate limited";
      },
    },
  });
  assert.equal(out.status, "skip_fetch_failed");
  assert.equal(out.reason, "rate limited");
});

// ── Scenario 2: fetches RESOLVE (no throw) with no usable heatmap → ok + empty, not fetch_failed ──

test("discoverPinSetups: heatmap resolves with no usable data (no throw) across the universe -> ok + empty, never skip_fetch_failed", async () => {
  const universe = new Set(["SPY", "QQQ", "AAPL"]);
  const out = await discoverPinSetups({
    today: "2026-07-24",
    nowEtMinutes: RTH_NOW_ET_MINUTES,
    excludeTickers: new Set(),
    includeTickers: universe,
    deps: {
      fetchHeatmap: async () => null, // resolved, not thrown -- a genuinely cold/unbuilt matrix
    },
  });
  assert.equal(out.status, "ok"); // NOT skip_fetch_failed -- nothing threw, the market was just quiet
  assert.equal(out.reason, undefined);
  assert.equal(out.setups.length, 0);
});

// ── Scenario 3: a LONE flaky ticker among many never trips skip_fetch_failed ──────────────────────

test("discoverPinSetups: a lone flaky ticker among a ten-name universe does not trip skip_fetch_failed", async () => {
  const universe = new Set(["SPX", "NDX", "SPY", "QQQ", "IWM", "DIA", "AAPL", "MSFT", "NVDA", "AMZN"]);
  let calls = 0;
  const out = await discoverPinSetups({
    today: "2026-07-24",
    nowEtMinutes: RTH_NOW_ET_MINUTES,
    excludeTickers: new Set(),
    includeTickers: universe,
    deps: {
      fetchHeatmap: async () => {
        calls++;
        if (calls === 1) throw new Error("one flaky read");
        return null; // every other name resolves cleanly -- just finds nothing
      },
    },
  });
  assert.equal(calls, 10, "sanity: all ten universe names were evaluated");
  assert.equal(out.status, "ok", "1/10 (10%) is well under the 90% threshold -- must not cry wolf");
  assert.equal(out.setups.length, 0);
});

test("PIN_FETCH_FAILURE_RATE_THRESHOLD is 0.9 (a HIGH bar -- a lone flaky name must never trip it)", () => {
  assert.equal(PIN_FETCH_FAILURE_RATE_THRESHOLD, 0.9);
});

// ── Scenario 4: heatmap succeeds with a clean pin, but the CHAIN fetch THROWS -> skip_fetch_failed ─
// Exercises the second catch site named in the finding (resolveTickerChainRows) independently of
// the heatmap one above -- same mechanism, different IO call.

test("discoverPinSetups: heatmap succeeds (clean pin) but the chain fetch THROWS for every evaluated name -> skip_fetch_failed", async () => {
  const universe = new Set(["AAPL", "MSFT", "NVDA"]); // non-index, non-condor-eligible names
  const out = await discoverPinSetups({
    today: "2026-07-24",
    nowEtMinutes: RTH_NOW_ET_MINUTES,
    excludeTickers: new Set(),
    includeTickers: universe,
    deps: {
      fetchHeatmap: async () => cleanPinHeatmap(),
      resolveChain: async () => {
        throw new Error("chain fetch 503");
      },
    },
  });
  assert.equal(out.status, "skip_fetch_failed");
  assert.equal(out.setups.length, 0);
  assert.match(String(out.reason), /503/);
});

// ── Scenario 5: full IO success (clean pin + chain) but no usable fade contract -> genuine ok ─────

test("discoverPinSetups: heatmap + chain both succeed but the chain carries no rows -> ok + empty, never fetch_failed", async () => {
  const universe = new Set(["AAPL", "MSFT", "NVDA"]);
  const out = await discoverPinSetups({
    today: "2026-07-24",
    nowEtMinutes: RTH_NOW_ET_MINUTES,
    excludeTickers: new Set(),
    includeTickers: universe,
    deps: {
      fetchHeatmap: async () => cleanPinHeatmap(),
      resolveChain: async () => ({ spot: 99, rows: [] }), // resolved cleanly, genuinely nothing listed
    },
  });
  assert.equal(out.status, "ok");
  assert.equal(out.setups.length, 0);
});

test("discoverPinSetups: full IO success end-to-end builds a real PIN fade setup", async () => {
  const universe = new Set(["AAPL"]);
  const out = await discoverPinSetups({
    today: "2026-07-24",
    nowEtMinutes: RTH_NOW_ET_MINUTES,
    excludeTickers: new Set(),
    includeTickers: universe,
    deps: {
      fetchHeatmap: async () => cleanPinHeatmap(),
      resolveChain: async () => ({ spot: 99, rows: [chainRow(98), chainRow(99), chainRow(102)] }),
    },
  });
  assert.equal(out.status, "ok");
  assert.equal(out.setups.length, 1, `expected one PIN setup, got: ${JSON.stringify(out.setups)}`);
  assert.deepEqual(out.setups[0]!.discovery_origin, ["PIN"]);
  assert.equal(out.setups[0]!.ticker, "AAPL");
});

// ── Off-hours / window skips never count as fetch failures (unchanged pre-fix behavior) ───────────

test("discoverPinSetups: before RTH open -> ok + empty, no IO attempted", async () => {
  let calls = 0;
  const out = await discoverPinSetups({
    today: "2026-07-24",
    nowEtMinutes: 8 * 60, // 8:00 ET -- before the 9:30 open
    excludeTickers: new Set(),
    includeTickers: new Set(["AAPL"]),
    deps: {
      fetchHeatmap: async () => {
        calls++;
        return cleanPinHeatmap();
      },
    },
  });
  assert.equal(out.status, "ok");
  assert.deepEqual(out.setups, []);
  assert.equal(calls, 0, "before-open skip must never reach the fetch at all");
});
