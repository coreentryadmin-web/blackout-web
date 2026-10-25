import test from "node:test";
import assert from "node:assert/strict";
import { buildEarlyEntryAlert } from "./early-entry-alert.ts";
import type { SetupClassification } from "./early-entry-state.ts";
import type { EarlyEntryCandidate, EarlyEntryRejection } from "./early-entry-contract-select.ts";

function classification(overrides: Partial<SetupClassification> = {}): SetupClassification {
  return {
    state: "WATCH",
    direction: "long",
    level: 110,
    invalidation_level: 108,
    trigger_price: 110.11,
    watch_detected_at_ms: 1_000,
    watch_expires_at_ms: 1_000 + 45 * 60_000,
    entry_triggered_at_ms: null,
    invalidated_at_ms: null,
    pressure: {
      developing: true,
      compression: { recent_range_pct: 1, baseline_range_pct: 10, ratio: 0.1, compressed: true },
      rvol_ratio: 2.1,
      rvol_confirmed: true,
      level: 110,
      level_tests: 3,
      distance_to_level_pct: 0.5,
      order_flow_bias: 0.3,
    },
    ...overrides,
  };
}

function candidate(overrides: Partial<EarlyEntryCandidate> = {}): EarlyEntryCandidate {
  return {
    strike: 112, side: "call", ask: 1.8, bid: 1.7, mid: 1.75, spread_pct: 5.7, oi: 400, iv: 0.35,
    distance_pct: 1.8, expected_move_pct: 2.5, reachability_prob: 0.4, captured_fraction: 0.1,
    rank_score: 0.35, ...overrides,
  };
}

test("buildEarlyEntryAlert: NO_SETUP classification -> NO_TRADE with an honest reason", () => {
  const r = buildEarlyEntryAlert({
    ticker: "AAPL", classification: classification({ state: "NO_SETUP", level: null, invalidation_level: null, trigger_price: null, watch_detected_at_ms: null, watch_expires_at_ms: null, pressure: null }),
    candidates: [], rejections: [], spotNow: 100, minutesRemaining: 120,
  });
  assert.equal(r.state, "NO_TRADE");
  assert.equal((r as any).reason, "no_developing_setup");
});

test("buildEarlyEntryAlert: INVALIDATED classification -> NO_TRADE, reason setup_invalidated", () => {
  const r = buildEarlyEntryAlert({
    ticker: "AAPL", classification: classification({ state: "INVALIDATED", invalidated_at_ms: 5_000 }),
    candidates: [], rejections: [], spotNow: 100, minutesRemaining: 120,
  });
  assert.equal(r.state, "NO_TRADE");
  assert.equal((r as any).reason, "setup_invalidated");
});

test("buildEarlyEntryAlert: EXPIRED classification -> NO_TRADE, reason setup_expired", () => {
  const r = buildEarlyEntryAlert({
    ticker: "AAPL", classification: classification({ state: "EXPIRED" }),
    candidates: [], rejections: [], spotNow: 100, minutesRemaining: 120,
  });
  assert.equal(r.state, "NO_TRADE");
  assert.equal((r as any).reason, "setup_expired");
});

test("buildEarlyEntryAlert: WATCH classification -> a WATCH alert with invalidation/trigger and a developing narrative", () => {
  const r = buildEarlyEntryAlert({
    ticker: "AAPL", classification: classification({ state: "WATCH" }),
    candidates: [], rejections: [], spotNow: 109.5, minutesRemaining: 120,
  });
  assert.equal(r.state, "WATCH");
  if (r.state !== "WATCH") throw new Error("unreachable");
  assert.equal(r.level, 110);
  assert.equal(r.invalidation_level, 108);
  assert.ok(r.why_developing.includes("110"));
  assert.ok(r.why_developing.length > 0);
});

test("buildEarlyEntryAlert: ENTRY classification with zero surviving candidates -> NO_TRADE, reason no_qualifying_contract", () => {
  const r = buildEarlyEntryAlert({
    ticker: "AAPL",
    classification: classification({ state: "ENTRY", entry_triggered_at_ms: 9_000 }),
    candidates: [], rejections: [{ strike: 112, side: "call", reject_reason: "ask_outside_price_band" }],
    spotNow: 110.5, minutesRemaining: 120,
  });
  assert.equal(r.state, "NO_TRADE");
  assert.equal((r as any).reason, "no_qualifying_contract");
});

test("buildEarlyEntryAlert: ENTRY classification with a surviving candidate -> a full ENTRY alert", () => {
  const r = buildEarlyEntryAlert({
    ticker: "AAPL",
    classification: classification({ state: "ENTRY", entry_triggered_at_ms: 9_000 }),
    candidates: [candidate()],
    rejections: [{ strike: 115, side: "call", reject_reason: "illiquid" }],
    spotNow: 110.5, minutesRemaining: 120,
    quoteAsOfMsByContract: () => 8_900,
  });
  assert.equal(r.state, "ENTRY");
  if (r.state !== "ENTRY") throw new Error("unreachable");
  assert.equal(r.ticker, "AAPL");
  assert.equal(r.contract.strike, 112);
  assert.equal(r.contract.ask, 1.8);
  assert.equal(r.contract.bid, 1.7);
  assert.equal(r.contract.quote_as_of_ms, 8_900);
  assert.equal(r.contract.iv, 0.35);
  assert.equal(r.entry_triggered_at_ms, 9_000);
  assert.equal(r.level, 110);
  assert.equal(r.invalidation_level, 108);
  assert.ok(r.underlying_targets.length >= 1);
  assert.ok(r.underlying_targets.some((t) => t.label.includes("expected move")));
  assert.deepEqual(r.rejected_alternatives, [{ strike: 115, side: "call", reject_reason: "illiquid" }]);
  assert.ok(r.why_now.length > 0);
  assert.ok(r.why_now.includes("110"));
  assert.ok(r.value_scenarios != null, "a real iv was supplied -- the value-scenario grid must be real, not null");
});

test("buildEarlyEntryAlert: the top-ranked candidate (index 0) is the one selected, not just any candidate", () => {
  const worse = candidate({ strike: 120, rank_score: 0.1 });
  const better = candidate({ strike: 112, rank_score: 0.5 });
  const r = buildEarlyEntryAlert({
    ticker: "AAPL", classification: classification({ state: "ENTRY", entry_triggered_at_ms: 9_000 }),
    candidates: [better, worse], // caller is responsible for pre-sorting -- this just takes [0]
    rejections: [], spotNow: 110.5, minutesRemaining: 120,
  });
  assert.equal(r.state, "ENTRY");
  if (r.state !== "ENTRY") throw new Error("unreachable");
  assert.equal(r.contract.strike, 112);
});

test("buildEarlyEntryAlert: a missing iv on the selected candidate -> value_scenarios is null, never fabricated", () => {
  const r = buildEarlyEntryAlert({
    ticker: "AAPL", classification: classification({ state: "ENTRY", entry_triggered_at_ms: 9_000 }),
    candidates: [candidate({ iv: null, reachability_prob: null, expected_move_pct: null })],
    rejections: [], spotNow: 110.5, minutesRemaining: 120,
  });
  assert.equal(r.state, "ENTRY");
  if (r.state !== "ENTRY") throw new Error("unreachable");
  assert.equal(r.value_scenarios, null);
  assert.equal(r.contract.iv, null);
});

test("buildEarlyEntryAlert: no quoteAsOfMsByContract supplied -> quote_as_of_ms is null, never guessed", () => {
  const r = buildEarlyEntryAlert({
    ticker: "AAPL", classification: classification({ state: "ENTRY", entry_triggered_at_ms: 9_000 }),
    candidates: [candidate()], rejections: [], spotNow: 110.5, minutesRemaining: 120,
  });
  assert.equal(r.state, "ENTRY");
  if (r.state !== "ENTRY") throw new Error("unreachable");
  assert.equal(r.contract.quote_as_of_ms, null);
});
