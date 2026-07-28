import { test } from "node:test";
import assert from "node:assert/strict";
import { entryHalfWidth, buildDirectionalStockLevels, parsePlayLevels } from "./play-levels";

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
