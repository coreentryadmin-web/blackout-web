import { test } from "node:test";
import assert from "node:assert/strict";

import { fmtNotional } from "./helix-contract-notional-format";

test("fmtNotional: null/non-finite/non-positive render the placeholder", () => {
  assert.equal(fmtNotional(null), "—");
  assert.equal(fmtNotional(Number.NaN), "—");
  assert.equal(fmtNotional(0), "—");
  assert.equal(fmtNotional(-500), "—");
});

test("fmtNotional: plain sub-$1K values render as whole dollars", () => {
  assert.equal(fmtNotional(500), "$500");
  assert.equal(fmtNotional(999), "$999");
});

test("fmtNotional: ordinary K values render with no decimal", () => {
  assert.equal(fmtNotional(1_000), "$1K");
  assert.equal(fmtNotional(430_000), "$430K");
});

test("fmtNotional: ordinary M values render with one decimal", () => {
  assert.equal(fmtNotional(1_500_000), "$1.5M");
  assert.equal(fmtNotional(6_000_000), "$6.0M");
});

test("fmtNotional: ordinary B values render with one decimal", () => {
  assert.equal(fmtNotional(2_300_000_000), "$2.3B");
});

test("fmtNotional: a K-unit quotient that rounds up to 1000 promotes to M instead of rendering $1000K", () => {
  // 999,600 < 1,000,000 so the raw-magnitude check takes the K branch, but
  // (999600 / 1000).toFixed(0) === "1000" -- the quotient itself crosses the
  // unit boundary on rounding. Must promote to the M tier (rendered at M's own
  // one-decimal precision, "$1.0M"), never render the literal "$1000K".
  assert.equal(fmtNotional(999_600), "$1.0M");
});

test("fmtNotional: an M-unit quotient that rounds up to 1000 promotes to B instead of rendering $1000.0M", () => {
  // 999,950,000 < 1,000,000,000 so the raw-magnitude check takes the M branch, but
  // (999950000 / 1_000_000).toFixed(1) === "1000.0" -- same boundary-crossing-on-round
  // defect one tier up. Must promote to "$1.0B", never render "$1000.0M".
  assert.equal(fmtNotional(999_950_000), "$1.0B");
});

test("fmtNotional: values just below the rounding boundary do NOT spuriously promote", () => {
  // 999,499 rounds down to 999K -- must stay in the K tier.
  assert.equal(fmtNotional(999_499), "$999K");
  // 999,449,999 rounds down to 999.4M -- must stay in the M tier.
  assert.equal(fmtNotional(999_449_999), "$999.4M");
});
