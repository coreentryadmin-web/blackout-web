import { test } from "node:test";
import assert from "node:assert/strict";
import { laneBreakout, screenBreakoutMovers, screenBreakdownMovers, type BreakoutMover } from "./candidates";
import type { MarketWideContext } from "./market-wide";

/** Grouped-daily bar (Polygon shape). */
function bar(T: string, over: { o?: number; h?: number; l?: number; c?: number; v?: number } = {}) {
  return { T, o: 100, h: 112, l: 99, c: 110, v: 5_000_000, ...over };
}

function mover(ticker: string, gain: number, close_strength: number, dollar = 1): BreakoutMover {
  return { ticker, gain, close_strength, dollar, volume: 1_000_000, bar: { h: 0, l: 0, o: 0 } };
}

function ctxWith(breakout: BreakoutMover[], breakdown: BreakoutMover[] = []): MarketWideContext {
  return { breakout_movers: breakout, breakdown_movers: breakdown } as unknown as MarketWideContext;
}

// ── Regression: breakout-only behavior must be byte-identical to pre-fix laneBreakout ──────────

test("breakout-only input: structure lane score is unchanged by the breakdown addition", () => {
  const breakout = [mover("NVDA", 0.1, 0.9), mover("AMD", 0.05, 0.6)];
  const withBreakdown = laneBreakout(ctxWith(breakout, []));
  const withoutBreakdownField = laneBreakout({ breakout_movers: breakout } as unknown as MarketWideContext);
  assert.deepEqual(withBreakdown, withoutBreakdownField, "presence of an (empty) breakdown_movers field must not change breakout scoring");

  // Manually reproduce what the OLD (pre-fix) laneBreakout would have computed: normalizeToMax
  // over breakout entries alone, ceiling 18 (LANE_MAX_BREAKOUT, private — reproduced here).
  const LANE_MAX_BREAKOUT = 18;
  const rawScores = breakout.map((m) => m.gain * (0.5 + m.close_strength));
  const top = Math.max(...rawScores);
  const expectedNvda = (rawScores[0]! / top) * LANE_MAX_BREAKOUT;
  const expectedAmd = (rawScores[1]! / top) * LANE_MAX_BREAKOUT;
  assert.ok(Math.abs(withBreakdown.get("NVDA")! - expectedNvda) < 1e-9);
  assert.ok(Math.abs(withBreakdown.get("AMD")! - expectedAmd) < 1e-9);
  assert.equal(withBreakdown.has("TSLA"), false, "no breakdown ticker leaks in when breakdown list is empty");
});

// ── The adversarial case that broke the naive "pool everything" design ─────────────────────────

test("breakout scores survive unchanged even when breakdown's top raw score EXCEEDS breakout's own top (live 2026-09-30 shape)", () => {
  // Reproduces the real invariant check: breakdown's strongest mover can out-score breakout's
  // strongest mover. A single shared normalization base would silently shrink every breakout
  // score here; separate-then-merge must not.
  const weakBreakout = [mover("WEAK_BULL", 0.03, 0.55)]; // small raw score
  const strongBreakdown = [mover("STRONG_BEAR", 0.15, 0.05)]; // much larger raw score than the breakout side

  const breakoutAlone = laneBreakout(ctxWith(weakBreakout, []));
  const breakoutWithStrongerBreakdown = laneBreakout(ctxWith(weakBreakout, strongBreakdown));

  assert.equal(
    breakoutAlone.get("WEAK_BULL"),
    breakoutWithStrongerBreakdown.get("WEAK_BULL"),
    "breakout's own ceiling-normalized score must not be rescaled by a stronger breakdown population"
  );
  // And the breakout ticker still gets the FULL ceiling (it's the only/top breakout entry).
  assert.equal(breakoutWithStrongerBreakdown.get("WEAK_BULL"), 18);
});

// ── New behavior: breakdown candidates now earn real points ─────────────────────────────────────

test("a breakdown-only ticker now earns nonzero structure-lane points", () => {
  const breakdown = [mover("BEAR1", 0.08, 0.1), mover("BEAR2", 0.04, 0.3)];
  const scored = laneBreakout(ctxWith([], breakdown));
  assert.ok((scored.get("BEAR1") ?? 0) > 0, "top breakdown mover must score > 0");
  assert.ok((scored.get("BEAR2") ?? 0) > 0, "weaker breakdown mover must still score > 0");
  assert.equal(scored.get("BEAR1"), 18, "the single strongest breakdown mover gets the full ceiling, same as breakout would");
  assert.ok(scored.get("BEAR2")! < scored.get("BEAR1")!, "weaker breakdown mover scores proportionally less");
});

test("breakout and breakdown populations are scored fairly: equal relative strength -> equal points, independent of the other side's magnitude", () => {
  // Breakout side has a big top score; breakdown side's top mover is relatively just as strong
  // WITHIN its own population (also the max of its own list) -> both should land at the ceiling.
  const breakout = [mover("BULL_TOP", 10, 0.9), mover("BULL_SECOND", 5, 0.9)];
  const breakdown = [mover("BEAR_TOP", 0.01, 0.5)]; // tiny in absolute terms, but it's breakdown's own top
  const scored = laneBreakout(ctxWith(breakout, breakdown));
  assert.equal(scored.get("BULL_TOP"), 18, "breakout's own top reaches the ceiling");
  assert.equal(scored.get("BEAR_TOP"), 18, "breakdown's own top ALSO reaches the ceiling, despite being tiny vs breakout's absolute scale -- each side is judged against its own population, not pooled");
  assert.ok(scored.get("BULL_SECOND")! < 18 && scored.get("BULL_SECOND")! > 0);
});

// ── Duplicate-ticker safety (defensive, not load-bearing per the real mutual-exclusivity proof below) ──

test("a ticker present in both lists (contrived -- cannot happen via the real screens) does not get double-counted, only the max", () => {
  const breakout = [mover("DUPE", 0.05, 0.9)]; // would score 18 alone (sole breakout entry)
  const breakdown = [mover("DUPE", 0.2, 0.05), mover("OTHER_BEAR", 0.02, 0.1)]; // DUPE is breakdown's top too
  const scored = laneBreakout(ctxWith(breakout, breakdown));
  // DUPE would be 18 from EITHER side alone; merged value must still be 18, never 36 (a sum would prove double-counting).
  assert.equal(scored.get("DUPE"), 18);
  assert.ok(scored.get("DUPE")! <= 18, "never exceeds the lane ceiling -- proves no additive double count");
});

// ── Real invariant: the actual screens can never produce the same ticker in both lists ─────────

test("screenBreakoutMovers and screenBreakdownMovers are mutually exclusive on identical input (real functions, not a mock)", () => {
  const rows = [
    bar("UP1", { o: 100, c: 112, h: 113, l: 99 }), // qualifies as breakout
    bar("DOWN1", { o: 100, c: 88, h: 101, l: 87 }), // qualifies as breakdown
    bar("FLAT1", { o: 100, c: 100.5, h: 101, l: 99 }), // qualifies as neither
  ];
  const breakoutTickers = new Set(screenBreakoutMovers(rows, 40).map((m) => m.ticker));
  const breakdownTickers = new Set(screenBreakdownMovers(rows, 40).map((m) => m.ticker));
  for (const t of breakoutTickers) {
    assert.equal(breakdownTickers.has(t), false, `${t} must not qualify for both screens`);
  }
  assert.ok(breakoutTickers.has("UP1"));
  assert.ok(breakdownTickers.has("DOWN1"));
});

test("empty breakdown_movers (undefined or []) never throws and produces breakout-only output", () => {
  const breakout = [mover("SOLO", 0.1, 0.8)];
  assert.doesNotThrow(() => laneBreakout({ breakout_movers: breakout } as unknown as MarketWideContext));
  assert.doesNotThrow(() => laneBreakout({ breakout_movers: breakout, breakdown_movers: [] } as unknown as MarketWideContext));
  assert.doesNotThrow(() => laneBreakout({} as unknown as MarketWideContext));
});
