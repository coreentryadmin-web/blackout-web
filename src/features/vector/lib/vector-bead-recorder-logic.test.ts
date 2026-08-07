import { test } from "node:test";
import assert from "node:assert/strict";
import { trackTickerFailures } from "./vector-bead-recorder-logic";

// ─────────────────────────────────────────────────────────────────────────────
// P1 2026-08-07: ASTS lost ~10 min of rail inside RTH and left ZERO log trace.
// ─────────────────────────────────────────────────────────────────────────────

const UNIVERSE = ["SPX", "SPY", "QQQ", "NVDA", "ASTS", "AMD"];

test("REGRESSION: one ticker going dark is DETECTED — the whole-pass warning never fired for it", () => {
  // The old leader only warned when recorded === 0. ASTS failing while 121 others succeeded gave
  // recorded=121, failed=1 and logged nothing at all.
  const state = new Map<string, number>();
  // Two failed passes: below threshold, still silent (a single flaky fetch must not page).
  assert.deepEqual(trackTickerFailures(state, UNIVERSE, ["ASTS"]), []);
  assert.deepEqual(trackTickerFailures(state, UNIVERSE, ["ASTS"]), []);
  // Third consecutive failure crosses TICKER_DARK_THRESHOLD → named, once.
  assert.deepEqual(trackTickerFailures(state, UNIVERSE, ["ASTS"]), [
    { ticker: "ASTS", kind: "dark", consecutive: 3 },
  ]);
});

test("a 10-minute outage costs TWO log lines, not one per 5s tick", () => {
  // 10 min at the 5s universe cadence = 120 passes. Logging each would bury the incident in the
  // logs it is supposed to illuminate.
  const state = new Map<string, number>();
  let events = 0;
  for (let pass = 0; pass < 120; pass++) events += trackTickerFailures(state, UNIVERSE, ["ASTS"]).length;
  assert.equal(events, 1, "exactly one DARK edge across 120 failing passes");
  const recovered = trackTickerFailures(state, UNIVERSE, []);
  assert.deepEqual(recovered, [{ ticker: "ASTS", kind: "recovered", consecutive: 120 }]);
  assert.equal(events + recovered.length, 2, "one outage → two lines total");
});

test("recovery reports the REAL streak length, so the log shows how long it was dark", () => {
  const state = new Map<string, number>();
  for (let i = 0; i < 7; i++) trackTickerFailures(state, UNIVERSE, ["ASTS"]);
  const [ev] = trackTickerFailures(state, UNIVERSE, []);
  assert.equal(ev?.consecutive, 7, "~35s dark must be recoverable from the log alone");
});

test("a blip BELOW the threshold never announces dark OR recovered", () => {
  // Otherwise every transient upstream hiccup across ~122 tickers becomes noise.
  const state = new Map<string, number>();
  trackTickerFailures(state, UNIVERSE, ["NVDA"]);
  trackTickerFailures(state, UNIVERSE, ["NVDA"]);
  assert.deepEqual(trackTickerFailures(state, UNIVERSE, []), [], "no recovery for a never-announced ticker");
  assert.equal(state.size, 0, "and the streak is cleared");
});

test("streaks must be CONSECUTIVE — an intervening success resets the counter", () => {
  const state = new Map<string, number>();
  trackTickerFailures(state, UNIVERSE, ["ASTS"]);
  trackTickerFailures(state, UNIVERSE, ["ASTS"]);
  trackTickerFailures(state, UNIVERSE, []);          // recovered before crossing
  assert.deepEqual(trackTickerFailures(state, UNIVERSE, ["ASTS"]), [], "counter restarted at 1");
  trackTickerFailures(state, UNIVERSE, ["ASTS"]);
  assert.deepEqual(trackTickerFailures(state, UNIVERSE, ["ASTS"]), [
    { ticker: "ASTS", kind: "dark", consecutive: 3 },
  ]);
});

test("state stays bounded by CURRENTLY-failing tickers, not universe size", () => {
  // This map lives for the process lifetime on a 5s loop — an unbounded one is a slow leak.
  const state = new Map<string, number>();
  for (let i = 0; i < 50; i++) trackTickerFailures(state, UNIVERSE, ["ASTS", "AMD"]);
  assert.equal(state.size, 2);
  trackTickerFailures(state, UNIVERSE, []);
  assert.equal(state.size, 0, "all successes are evicted");
});

test("a ticker NOT attempted this pass keeps its streak — absence is not recovery", () => {
  // The universe is dynamic; a name dropping out of the roster must not be logged as "recovered".
  const state = new Map<string, number>();
  for (let i = 0; i < 4; i++) trackTickerFailures(state, UNIVERSE, ["ASTS"]);
  const events = trackTickerFailures(state, ["SPX", "SPY"], []); // ASTS not in this roster
  assert.deepEqual(events, []);
  assert.equal(state.get("ASTS"), 4, "streak preserved");
});
