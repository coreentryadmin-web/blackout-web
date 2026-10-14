import test from "node:test";
import assert from "node:assert/strict";
import { formatDealerDollars, formatFixedNonZero } from "./format-nonzero";

test("formatFixedNonZero: behaves exactly like toFixed when the value survives rounding", () => {
  assert.equal(formatFixedNonZero(12.34, 1), "12.3");
  assert.equal(formatFixedNonZero(-5.678, 2), "-5.68");
});

test("formatFixedNonZero: exact zero stays '0.0', never widened", () => {
  assert.equal(formatFixedNonZero(0, 1), "0.0");
});

test("formatFixedNonZero: a real nonzero value that would round to a false zero widens precision", () => {
  // 0.04 rounds to "0.0" at 1dp but is a real, nonzero value.
  assert.equal(formatFixedNonZero(0.04, 1), "0.04");
  assert.equal(formatFixedNonZero(-0.04, 1), "-0.04");
});

test("formatFixedNonZero: widens up to (decimals + 4) places for a value the cap can still resolve", () => {
  // 1dp cap reaches 5dp; 0.00003 is resolvable there without a false zero.
  assert.equal(formatFixedNonZero(0.00003, 1), "0.00003");
});

test("formatFixedNonZero: a value beyond the widening cap falls back to the original fixed string, never grows unbounded", () => {
  const widened = formatFixedNonZero(0.0000001, 1);
  assert.equal(widened, "0.0");
});

// BUG FIX (Ask Largo standing mandate, 2026-10-14): live GOOGL/TSLA/AAPL/SPY dealer-exposure reads
// via GET /api/market/gex-positioning showed net CHARM routinely 10-1000x the magnitude of net GEX
// at the same instant (a structural property of how charm is computed, not a per-ticker anomaly)
// — large enough that a plain "/1e6 then suffix M" format produced e.g. "-217513.8M" (GOOGL) and
// would read "-3211296.7M" for SPY: six-plus significant digits in front of the decimal, which
// reads as a data glitch, not a dealer-exposure figure. formatDealerDollars must pick M/B/T by
// magnitude so these stay legible.
test("formatDealerDollars: stays in M for anything under $1B, unchanged from the old fixed format", () => {
  assert.equal(formatDealerDollars(2_000_000), "2.0M");
  assert.equal(formatDealerDollars(-1_500_000), "-1.5M");
  assert.equal(formatDealerDollars(800_000), "0.8M");
  assert.equal(formatDealerDollars(0), "0.0M");
});

test("formatDealerDollars: a small nonzero value still widens precision rather than collapsing to a false '0.0M' (inherits formatFixedNonZero)", () => {
  assert.equal(formatDealerDollars(40_000), "0.04M");
  assert.equal(formatDealerDollars(-40_000), "-0.04M");
});

test("formatDealerDollars: switches to B at $1B and above, instead of an unreadable 4-5-digit M figure", () => {
  // live GOOGL net_charm (2026-10-14): -217,513,840,849.16 raw.
  assert.equal(formatDealerDollars(-217_513_840_849.16), "-217.5B");
  // live AAPL net_dex (2026-10-14): -31,444,395,505.11 raw.
  assert.equal(formatDealerDollars(-31_444_395_505.11), "-31.4B");
  assert.equal(formatDealerDollars(1_000_000_000), "1.0B");
});

test("formatDealerDollars: switches to T at $1T and above", () => {
  // live SPY net_charm (2026-10-14): -3,211,296,657,497.84 raw — this is the exact case that
  // would otherwise render "-3211296.7M".
  assert.equal(formatDealerDollars(-3_211_296_657_497.84), "-3.2T");
  assert.equal(formatDealerDollars(1_000_000_000_000), "1.0T");
});
