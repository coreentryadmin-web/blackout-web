import { test } from "node:test";
import assert from "node:assert/strict";
import {
  computeRiskReward,
  entryHalfWidth,
  buildDirectionalStockLevels,
  parsePlayLevels,
} from "./play-levels";

// ── entryHalfWidth ──────────────────────────────────────────────────────

test("entryHalfWidth returns floor (0.5%) when no ATR", () => {
  assert.equal(entryHalfWidth(100), 0.005);
  assert.equal(entryHalfWidth(100, null), 0.005);
  assert.equal(entryHalfWidth(100, 0), 0.005);
});

test("entryHalfWidth scales with ATR", () => {
  // ATR = $4 on a $100 stock → 4% ATR → 4%*0.4 = 1.6% half-width
  const hw = entryHalfWidth(100, 4);
  assert.ok(hw > 0.005, "should exceed the floor");
  assert.ok(Math.abs(hw - 0.016) < 0.001, `expected ~0.016, got ${hw}`);
});

test("entryHalfWidth is capped at 2.5%", () => {
  // ATR = $20 on a $100 stock → 20% ATR → would be 8% but capped at 2.5%
  assert.equal(entryHalfWidth(100, 20), 0.025);
});

test("entryHalfWidth floor applies for low-vol stocks", () => {
  // ATR = $0.50 on a $100 stock → 0.5% → 0.2% half → below 0.5% floor
  assert.equal(entryHalfWidth(100, 0.5), 0.005);
});

// ── buildDirectionalStockLevels: ATR-scaled bands ───────────────────────

test("LONG entry band is ATR-scaled, not fixed ±0.5%", () => {
  const result = buildDirectionalStockLevels({
    direction: "long",
    support: 95,
    resistance: 110,
    spot: 100,
    atr: 4, // 4% ATR → 1.6% half-width
  });
  const parsed = parsePlayLevels({ entry_range: result.entry_range } as any);
  assert.ok(parsed.entry_range_low != null);
  assert.ok(parsed.entry_range_high != null);

  const bandWidth = parsed.entry_range_high! - parsed.entry_range_low!;
  // 1.6% half * 2 = 3.2% total on $100 = $3.20 band
  assert.ok(bandWidth > 2.5, `band should be wider than fixed ±0.5% ($1); got $${bandWidth.toFixed(2)}`);
  assert.ok(bandWidth < 6, `band should not be unreasonably wide; got $${bandWidth.toFixed(2)}`);
});

test("SHORT entry band is also ATR-scaled", () => {
  const result = buildDirectionalStockLevels({
    direction: "short",
    support: 90,
    resistance: 105,
    spot: 100,
    atr: 3, // 3% ATR → 1.2% half-width
  });
  const parsed = parsePlayLevels({ entry_range: result.entry_range } as any);
  const bandWidth = parsed.entry_range_high! - parsed.entry_range_low!;
  assert.ok(bandWidth > 1.5, `SHORT band should exceed fixed ±0.5%; got $${bandWidth.toFixed(2)}`);
});

test("low-vol stock still gets minimum ±0.5% band", () => {
  const result = buildDirectionalStockLevels({
    direction: "long",
    support: 95,
    resistance: 110,
    spot: 100,
    atr: 0.3, // 0.3% ATR → 0.12% half → below floor
  });
  const parsed = parsePlayLevels({ entry_range: result.entry_range } as any);
  const bandWidth = parsed.entry_range_high! - parsed.entry_range_low!;
  // Floor = 0.5% half × 2 = 1% total on $100 = $1.00
  assert.ok(Math.abs(bandWidth - 1.0) < 0.05, `floor band should be ~$1.00; got $${bandWidth.toFixed(2)}`);
});

test("no ATR → minimum ±0.5% band (backward compat)", () => {
  const result = buildDirectionalStockLevels({
    direction: "long",
    support: 95,
    resistance: 110,
    spot: 100,
  });
  const parsed = parsePlayLevels({ entry_range: result.entry_range } as any);
  const bandWidth = parsed.entry_range_high! - parsed.entry_range_low!;
  assert.ok(Math.abs(bandWidth - 1.0) < 0.05, `no-ATR band should be ~$1.00; got $${bandWidth.toFixed(2)}`);
});

// ── computeRiskReward: the FILL-EDGE basis ──────────────────────────────

test("computeRiskReward measures from the FILL EDGE, not the band mid (the floor-push class)", () => {
  // The real shipped shape — NVDA 2026-08-06: spot 219.22, ATR14 8.01, target pushed to
  // the 1.5×ATR floor (219.22 + 1.5×8.01 = 231.24), stop set by MIN_RR_RATIO
  // (219.22 − 12.02/0.75 = 203.20), band = spot ± 0.4×ATR.
  //   mid basis  : 12.02 / 16.02 = 0.75  ← what this used to report
  //   edge basis : (231.24 − 222.42) / (222.42 − 203.20) = 8.82 / 19.22 = 0.46
  const rr = computeRiskReward({
    direction: "LONG",
    entry_range: "$216.02-$222.42",
    target: "231.24",
    stop: "203.20",
  });
  assert.equal(rr, 0.46, "must be the fill-edge R:R the member actually gets, not 0.75");
});

test("computeRiskReward: SHORT fills at the band BOTTOM", () => {
  // Mirror image. Band 98-102, target 90, stop 110.
  //   mid basis  : (100 − 90) / (110 − 100) = 10 / 10 = 1.00
  //   edge basis : (98 − 90)  / (110 − 98)  =  8 / 12 = 0.67
  const rr = computeRiskReward({
    direction: "SHORT",
    entry_range: "$98.00-$102.00",
    target: "90.00",
    stop: "110.00",
  });
  assert.equal(rr, 0.67);
});

test("computeRiskReward: the edge basis never flatters the mid basis", () => {
  // 20 of 48 published plays in the 2026-07-06..08-06 window sit below 1.0 on this basis
  // while reading at or above it on the mid basis. This asserts the SIGN of that gap:
  // for a LONG the edge basis is always the more conservative of the two.
  const args = {
    direction: "LONG" as const,
    entry_range: "$100.00-$104.00",
    target: "112.00",
    stop: "92.00",
  };
  const edge = computeRiskReward(args)!; // (112−104)/(104−92) = 8/12 = 0.67
  assert.equal(edge, 0.67);
  const parsed = parsePlayLevels({ entry_range: args.entry_range } as any);
  const mid = (parsed.entry_range_low! + parsed.entry_range_high!) / 2;
  const midBasis = Number(((112 - mid) / (mid - 92)).toFixed(2)); // 10/10 = 1.00
  assert.equal(midBasis, 1.0);
  assert.ok(edge < midBasis, "the edge basis must never flatter the mid basis for a LONG");
});

test("computeRiskReward: degenerate inputs stay null (guards unchanged)", () => {
  // Single-price band collapses to its own edge — (110−100)/(100−95) = 2.0.
  assert.equal(
    computeRiskReward({ direction: "LONG", entry_range: "$100.00", target: "110.00", stop: "95.00" }),
    2.0
  );
  // Stop AT the fill edge → no risk leg.
  assert.equal(
    computeRiskReward({ direction: "LONG", entry_range: "$100.00-$104.00", target: "110.00", stop: "104.00" }),
    null
  );
  // Target below the fill edge for a LONG → negative reward, not a ratio.
  assert.equal(
    computeRiskReward({ direction: "LONG", entry_range: "$100.00-$104.00", target: "103.00", stop: "95.00" }),
    null
  );
  assert.equal(computeRiskReward({ direction: "LONG", entry_range: null, target: "110", stop: "95" }), null);
  assert.equal(
    computeRiskReward({ direction: "LONG", entry_range: "$100.00-$104.00", target: null, stop: "95" }),
    null
  );
});
