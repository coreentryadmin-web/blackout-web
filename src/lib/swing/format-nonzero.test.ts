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

// BUG FIX (Ask Largo standing mandate, 2026-11-08): the unit (M/B/T) is picked off the UNROUNDED
// `raw` magnitude, then `formatFixedNonZero` rounds the quotient INSIDE that chosen unit — the
// same round-off-before-rounding boundary bug just fixed 10 times elsewhere this session
// (fmt-money.ts's fmtPremium, several Meridian/Thermal/Darkpool/Helix formatters, Vector's
// crosshair legend, GEX heatmap money formatting — see #7558/#7559/#7560 the same day). A raw
// value just under a unit threshold rounds UP to "1000" inside the lower unit and never promotes:
// 999,960,000 is < 1e9 so it takes the M branch, then (999_960_000/1e6).toFixed(1) rounds to
// "1000.0" — rendering "1000.0M" instead of promoting to the B tier it actually rounded into
// ("1.0B"). Same shape at the B→T boundary. Live call sites: every Net GEX/VEX/DEX/CHARM line in
// the swing play-brief (play-brief-intel.ts's gexPostureSection, play-brief.ts's
// tradeManagerNarrativeSection, play-brief-narrative.ts's dealerPostureLine).
test("formatDealerDollars: a value that ROUNDS to 1000M promotes to B instead of overflowing", () => {
  assert.equal(formatDealerDollars(999_960_000), "1.0B");
  assert.equal(formatDealerDollars(-999_960_000), "-1.0B");
  // Just under the rounding boundary: must NOT promote.
  assert.equal(formatDealerDollars(999_400_000), "999.4M");
});

test("formatDealerDollars: a value that ROUNDS to 1000B promotes to T instead of overflowing", () => {
  assert.equal(formatDealerDollars(999_960_000_000), "1.0T");
  assert.equal(formatDealerDollars(-999_960_000_000), "-1.0T");
  assert.equal(formatDealerDollars(999_400_000_000), "999.4B");
});

// BUG FIX (2026-11-08, same day — found while reviewing the fix above before merge, PR #7561
// comment). The promotion guard above shipped checking `Math.round(abs / 1e9) >= 1000` —
// rounding to the nearest INTEGER — but the rendered value is rounded to 1 DECIMAL place via
// `formatFixedNonZero(..., 1)`. Those disagree over the quotient range [999.5, 999.95): integer
// rounding sends 999.6 to 1000 (promotes), while 1dp rounding renders that same quotient as
// "999.6" (never reached 1000, must stay in the lower unit). Confirmed the shipped code rendered
// `formatDealerDollars(999_600_000)` as the wrong "1.0B" instead of "999.6M". Same shape at the
// B→T boundary. The already-correct sibling fix in `vector-crosshair-format.ts`'s `fmtGex`
// (#7559) rounds at the formatter's own precision before comparing — mirrored here.
test("formatDealerDollars: a quotient in [999.5, 999.95) must NOT promote — only a value that rounds to 1000.0 at 1dp precision promotes", () => {
  assert.equal(formatDealerDollars(999_500_000), "999.5M");
  assert.equal(formatDealerDollars(999_600_000), "999.6M");
  assert.equal(formatDealerDollars(999_940_000), "999.9M");
  // 999.95 is the real 1dp rounding boundary — this one correctly promotes.
  assert.equal(formatDealerDollars(999_950_000), "1.0B");
});

test("formatDealerDollars: the same [999.5, 999.95) non-promotion band at the B->T boundary", () => {
  assert.equal(formatDealerDollars(999_500_000_000), "999.5B");
  assert.equal(formatDealerDollars(999_600_000_000), "999.6B");
  assert.equal(formatDealerDollars(999_940_000_000), "999.9B");
  assert.equal(formatDealerDollars(999_950_000_000), "1.0T");
});
