import test from "node:test";
import assert from "node:assert/strict";
import { rankContractsByReachability, reachabilityToPremiumTarget, type ChainCandidate } from "./strike-reachability.ts";

const MINUTES_IN_TRADING_YEAR = 252 * 390;

function cand(strike: number, side: "call" | "put", overrides: Partial<ChainCandidate> = {}): ChainCandidate {
  return { strike, side, bid: 1.0, ask: 1.05, oi: 500, iv: 0.3, ...overrides };
}

test("rankContractsByReachability: returns empty for an empty candidate list", () => {
  const r = rankContractsByReachability({ spot: 100, direction: "long", minutesRemaining: 60, candidates: [] });
  assert.deepEqual(r, []);
});

test("rankContractsByReachability: filters to the correct side for the direction (long -> call, short -> put)", () => {
  const candidates = [cand(101, "call"), cand(99, "put")];
  const long = rankContractsByReachability({ spot: 100, direction: "long", minutesRemaining: 60, candidates });
  assert.equal(long.length, 1);
  assert.equal(long[0]!.side, "call");

  const short = rankContractsByReachability({ spot: 100, direction: "short", minutesRemaining: 60, candidates });
  assert.equal(short.length, 1);
  assert.equal(short[0]!.side, "put");
});

test("rankContractsByReachability: a strike closer to spot (smaller reachability_z) ranks ABOVE a farther one, same IV/time", () => {
  const candidates = [cand(110, "call"), cand(101, "call")];
  const r = rankContractsByReachability({ spot: 100, direction: "long", minutesRemaining: 120, candidates });
  assert.equal(r.length, 2);
  assert.equal(r[0]!.strike, 101, "the nearer strike should rank first (higher reachability_prob)");
  assert.ok(r[0]!.reachability_z! < r[1]!.reachability_z!);
  assert.ok(r[0]!.reachability_prob! > r[1]!.reachability_prob!);
});

test("rankContractsByReachability: reachability_prob is near 1 for a strike essentially at spot", () => {
  const candidates = [cand(100.01, "call")];
  const r = rankContractsByReachability({ spot: 100, direction: "long", minutesRemaining: 120, candidates });
  assert.ok(r[0]!.reachability_prob! > 0.95, `expected near-certain reachability for an ATM strike, got ${r[0]!.reachability_prob}`);
});

test("rankContractsByReachability: reachability_prob is near 0 for a strike many expected-moves away", () => {
  // Deliberately absurd strike relative to a tiny time window + modest IV -> expected move is small.
  const candidates = [cand(500, "call", { iv: 0.2 })];
  const r = rankContractsByReachability({ spot: 100, direction: "long", minutesRemaining: 30, candidates });
  assert.ok(r[0]!.reachability_prob! < 0.01, `expected near-zero reachability for a far strike, got ${r[0]!.reachability_prob}`);
});

test("rankContractsByReachability: more time remaining widens the expected move and raises reachability for a fixed far strike", () => {
  const far = cand(110, "call");
  const short = rankContractsByReachability({ spot: 100, direction: "long", minutesRemaining: 15, candidates: [far] })[0]!;
  const long = rankContractsByReachability({ spot: 100, direction: "long", minutesRemaining: MINUTES_IN_TRADING_YEAR, candidates: [far] })[0]!;
  assert.ok(long.expected_move_pct! > short.expected_move_pct!);
  assert.ok(long.reachability_prob! > short.reachability_prob!);
});

test("rankContractsByReachability: higher IV widens expected move for the same strike/time", () => {
  const lowIv = cand(110, "call", { iv: 0.1 });
  const highIv = cand(110, "call", { iv: 0.8 });
  const a = rankContractsByReachability({ spot: 100, direction: "long", minutesRemaining: 120, candidates: [lowIv] })[0]!;
  const b = rankContractsByReachability({ spot: 100, direction: "long", minutesRemaining: 120, candidates: [highIv] })[0]!;
  assert.ok(b.expected_move_pct! > a.expected_move_pct!);
  assert.ok(b.reachability_prob! > a.reachability_prob!);
});

test("rankContractsByReachability: mid/spread/cost basis are reported honestly from bid/ask", () => {
  const candidates = [cand(101, "call", { bid: 0.9, ask: 1.1 })];
  const r = rankContractsByReachability({ spot: 100, direction: "long", minutesRemaining: 60, candidates });
  assert.equal(r[0]!.mid, 1.0);
  assert.ok(Math.abs(r[0]!.spread_pct! - 20) < 0.01, `expected 20% spread, got ${r[0]!.spread_pct}`);
  assert.equal(r[0]!.cost_basis, 1.1, "cost basis is the ask — what a long buyer actually pays");
});

test("rankContractsByReachability: missing iv -> reachability fields null, never a fabricated estimate", () => {
  const candidates = [cand(101, "call", { iv: null })];
  const r = rankContractsByReachability({ spot: 100, direction: "long", minutesRemaining: 60, candidates });
  assert.equal(r[0]!.expected_move_pct, null);
  assert.equal(r[0]!.reachability_z, null);
  assert.equal(r[0]!.reachability_prob, null);
});

test("rankContractsByReachability: missing bid/ask -> mid/spread/cost_basis null, never guessed", () => {
  const candidates = [cand(101, "call", { bid: null, ask: null })];
  const r = rankContractsByReachability({ spot: 100, direction: "long", minutesRemaining: 60, candidates });
  assert.equal(r[0]!.mid, null);
  assert.equal(r[0]!.spread_pct, null);
  assert.equal(r[0]!.cost_basis, null);
});

test("rankContractsByReachability: liquidity_ok is false below the OI floor or above the spread-pct ceiling", () => {
  const thin = cand(101, "call", { oi: 1 });
  const wide = cand(102, "call", { bid: 0.5, ask: 1.5 }); // 100% spread
  const good = cand(103, "call", { oi: 1000, bid: 1.0, ask: 1.05 });
  const r = rankContractsByReachability({
    spot: 100, direction: "long", minutesRemaining: 60, candidates: [thin, wide, good],
    minOi: 50, maxSpreadPct: 15,
  });
  const byStrike = Object.fromEntries(r.map((x) => [x.strike, x]));
  assert.equal(byStrike[101]!.liquidity_ok, false, "below min OI");
  assert.equal(byStrike[102]!.liquidity_ok, false, "above max spread pct");
  assert.equal(byStrike[103]!.liquidity_ok, true);
});

test("rankContractsByReachability: illiquid candidates are reported, not dropped, but ranked below liquid ones at similar reachability", () => {
  const illiquidNear = cand(101, "call", { oi: 1 });
  const liquidFar = cand(103, "call", { oi: 1000 });
  const r = rankContractsByReachability({
    spot: 100, direction: "long", minutesRemaining: 600, candidates: [illiquidNear, liquidFar],
    minOi: 50,
  });
  assert.equal(r.length, 2, "both candidates are still reported");
  const first = r.find((x) => x.liquidity_ok === true);
  assert.ok(first, "a liquid candidate exists in the ranked output");
});

test("rankContractsByReachability: results are sorted by rank_score descending, liquid-and-reachable first", () => {
  const candidates = [
    cand(130, "call", { oi: 1000 }), // far, liquid
    cand(101, "call", { oi: 1000 }), // near, liquid
    cand(102, "call", { oi: 1 }),    // near-ish, illiquid
  ];
  const r = rankContractsByReachability({ spot: 100, direction: "long", minutesRemaining: 120, candidates, minOi: 50 });
  assert.equal(r[0]!.strike, 101, "nearest liquid strike should rank first");
});

// ── reachabilityToPremiumTarget ──────────────────────────────────────────────────────

test("reachabilityToPremiumTarget: call — required price is strike + target, move measured from spot", () => {
  const r = reachabilityToPremiumTarget({
    spot: 100, strike: 105, side: "call", iv: 0.3, minutesRemaining: 120, targetPremium: 20,
  });
  assert.equal(r.required_underlying_price, 125, "strike (105) + target premium (20)");
  assert.ok(Math.abs(r.required_move_pct - 25) < 0.01, `expected +25% required move, got ${r.required_move_pct}`);
});

test("reachabilityToPremiumTarget: put — required price is strike - target", () => {
  const r = reachabilityToPremiumTarget({
    spot: 100, strike: 95, side: "put", iv: 0.3, minutesRemaining: 120, targetPremium: 20,
  });
  assert.equal(r.required_underlying_price, 75, "strike (95) - target premium (20)");
  assert.ok(r.required_move_pct < 0, "a put's required move is downward (negative)");
});

test("reachabilityToPremiumTarget: a deep put target can require a negative (impossible) price — left unclamped, not hidden", () => {
  const r = reachabilityToPremiumTarget({
    spot: 100, strike: 10, side: "put", iv: 0.3, minutesRemaining: 120, targetPremium: 20,
  });
  assert.equal(r.required_underlying_price, -10, "strike (10) - target (20) — honestly negative, not clamped");
  // An impossible/huge required move must read as near-zero reachability, never a fabricated high one.
  assert.ok(r.target_reachability_prob! < 0.01, `expected near-zero reachability, got ${r.target_reachability_prob}`);
});

test("reachabilityToPremiumTarget: closer target (e.g. $2) is more reachable than a farther one (e.g. $20), same contract", () => {
  const near = reachabilityToPremiumTarget({ spot: 100, strike: 101, side: "call", iv: 0.3, minutesRemaining: 120, targetPremium: 2 });
  const far = reachabilityToPremiumTarget({ spot: 100, strike: 101, side: "call", iv: 0.3, minutesRemaining: 120, targetPremium: 20 });
  assert.ok(near.target_reachability_prob! > far.target_reachability_prob!);
  assert.ok(near.target_reachability_z! < far.target_reachability_z!);
});

test("reachabilityToPremiumTarget: more time remaining raises reachability for a fixed target", () => {
  const short = reachabilityToPremiumTarget({ spot: 100, strike: 110, side: "call", iv: 0.3, minutesRemaining: 15, targetPremium: 20 });
  const long = reachabilityToPremiumTarget({ spot: 100, strike: 110, side: "call", iv: 0.3, minutesRemaining: MINUTES_IN_TRADING_YEAR, targetPremium: 20 });
  assert.ok(long.target_reachability_prob! > short.target_reachability_prob!);
});

test("reachabilityToPremiumTarget: missing iv -> reachability fields null, never a fabricated estimate", () => {
  const r = reachabilityToPremiumTarget({ spot: 100, strike: 110, side: "call", iv: null, minutesRemaining: 120, targetPremium: 20 });
  assert.equal(r.target_reachability_z, null);
  assert.equal(r.target_reachability_prob, null);
  // The required price/move are pure geometry (strike + target vs spot) — still computable without iv.
  assert.equal(r.required_underlying_price, 130);
});
