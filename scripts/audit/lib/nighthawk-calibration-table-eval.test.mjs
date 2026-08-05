import { test } from "node:test";
import assert from "node:assert/strict";

import {
  displayVerdict,
  contestedGateVerdict,
  dealerFamilySupportSum,
  familyCapBucket,
} from "./nighthawk-calibration-table-eval.mjs";

test("displayVerdict maps calibration.ts verdicts to the GRADUATED/HOLD/INSUFFICIENT_DATA labels", () => {
  assert.deepEqual(displayVerdict("enforce"), { label: "GRADUATED", graduated: true });
  assert.deepEqual(displayVerdict("keep_calibrating"), { label: "HOLD", graduated: false });
  assert.deepEqual(displayVerdict("insufficient_data"), { label: "INSUFFICIENT_DATA", graduated: false });
});

test("contestedGateVerdict: insufficient_data below min_block_n", () => {
  const r = contestedGateVerdict({
    blockedLine: { n: 4, would_have_won_rate_pct: 20 },
    baseline: { n: 100, win_rate_pct: 55 },
    lowNThreshold: 5,
    minBlockN: 10,
    minDeltaPts: 15,
  });
  assert.equal(r.verdict, "insufficient_data");
  assert.match(r.reason, /n>=10/);
});

test("contestedGateVerdict: insufficient_data when baseline is low_n", () => {
  const r = contestedGateVerdict({
    blockedLine: { n: 12, would_have_won_rate_pct: 20 },
    baseline: { n: 3, win_rate_pct: 50 },
    lowNThreshold: 5,
    minBlockN: 10,
    minDeltaPts: 15,
  });
  assert.equal(r.verdict, "insufficient_data");
});

test("contestedGateVerdict: enforce when delta clears the bar", () => {
  const r = contestedGateVerdict({
    blockedLine: { n: 12, would_have_won_rate_pct: 20 },
    baseline: { n: 40, win_rate_pct: 55 },
    lowNThreshold: 5,
    minBlockN: 10,
    minDeltaPts: 15,
  });
  assert.equal(r.verdict, "enforce");
});

test("contestedGateVerdict: keep_calibrating when delta is under the bar", () => {
  const r = contestedGateVerdict({
    blockedLine: { n: 12, would_have_won_rate_pct: 45 },
    baseline: { n: 40, win_rate_pct: 50 },
    lowNThreshold: 5,
    minBlockN: 10,
    minDeltaPts: 15,
  });
  assert.equal(r.verdict, "keep_calibrating");
});

test("contestedGateVerdict: exact-15 boundary (float-dust epsilon) still enforces", () => {
  const r = contestedGateVerdict({
    blockedLine: { n: 10, would_have_won_rate_pct: 40 },
    baseline: { n: 10, win_rate_pct: 54.99999999999999 }, // IEEE754 dust on an exact 55
    lowNThreshold: 5,
    minBlockN: 10,
    minDeltaPts: 15,
  });
  assert.equal(r.verdict, "enforce");
});

const FAMILY_MAP = {
  "gex-walls": "dealer-positioning",
  "wall-trend": "dealer-positioning",
  "vex-charm": "dealer-positioning",
  "darkpool-confluence": "dealer-positioning",
  "flow-quality": "order-flow",
  "sector-heat": "context",
};

test("dealerFamilySupportSum: null on abstained/missing cortex context", () => {
  assert.equal(dealerFamilySupportSum(null, FAMILY_MAP), null);
  assert.equal(dealerFamilySupportSum({ abstained: true, reason: "x" }, FAMILY_MAP), null);
});

test("dealerFamilySupportSum: sums only dealer-positioning family supports", () => {
  const cortex = {
    abstained: false,
    supports: [
      { source: "gex-walls", weight: 1.0 },
      { source: "wall-trend", weight: 1.25 },
      { source: "flow-quality", weight: 0.9 }, // different family — excluded
    ],
  };
  assert.equal(dealerFamilySupportSum(cortex, FAMILY_MAP), 2.25);
});

test("dealerFamilySupportSum: 0 (not null) when cortex read but no dealer-family supports present", () => {
  const cortex = { abstained: false, supports: [{ source: "flow-quality", weight: 0.5 }] };
  assert.equal(dealerFamilySupportSum(cortex, FAMILY_MAP), 0);
});

test("familyCapBucket: saturated/unsaturated/no_read", () => {
  assert.equal(familyCapBucket(null, 2.75), "no_read");
  assert.equal(familyCapBucket(1.5, 2.75), "unsaturated");
  assert.equal(familyCapBucket(2.75, 2.75), "saturated");
  assert.equal(familyCapBucket(2.7500000001, 2.75), "saturated"); // float dust forgiven
});
