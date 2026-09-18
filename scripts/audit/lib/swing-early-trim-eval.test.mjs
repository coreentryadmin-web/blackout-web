import test from "node:test";
import assert from "node:assert/strict";
import { blendedPnlUnderPolicy, comparePolicies, reachRate } from "./swing-early-trim-eval.mjs";

const CURRENT = [{ triggerPct: 100, fraction: 0.5 }];

test("blendedPnlUnderPolicy: rung never reached — full position rides to the recorded exit unchanged", () => {
  // peak +20% never reaches the +100% rung — current policy must reproduce the raw exit exactly.
  const row = { entryPremium: 10, peakPremium: 12, exitPnlPct: -40 };
  assert.equal(blendedPnlUnderPolicy(row, CURRENT), -40);
});

test("blendedPnlUnderPolicy: rung reached — half banked at the trigger level, half rides to the recorded exit", () => {
  const row = { entryPremium: 10, peakPremium: 25, exitPnlPct: -50 }; // peak +150%, clears +100%
  // 0.5 * 100 (banked at +100%) + 0.5 * -50 (runner rides to the real final exit) = 25
  assert.equal(blendedPnlUnderPolicy(row, CURRENT), 25);
});

test("blendedPnlUnderPolicy: no re-priceable basis returns null, never a guess", () => {
  assert.equal(blendedPnlUnderPolicy({ entryPremium: null, peakPremium: 10, exitPnlPct: 5 }, CURRENT), null);
  assert.equal(blendedPnlUnderPolicy({ entryPremium: 10, peakPremium: null, exitPnlPct: 5 }, CURRENT), null);
  assert.equal(blendedPnlUnderPolicy({ entryPremium: 10, peakPremium: 12, exitPnlPct: null }, CURRENT), null);
});

test("blendedPnlUnderPolicy: multi-rung policy stacks correctly in trigger order regardless of input order", () => {
  const twoRung = [{ triggerPct: 80, fraction: 0.5 }, { triggerPct: 40, fraction: 0.25 }]; // deliberately unordered
  const row = { entryPremium: 10, peakPremium: 20, exitPnlPct: -60 }; // peak +100%, clears both 40 and 80
  // 0.25*40 + 0.5*80 + 0.25*-60 = 10 + 40 - 15 = 35
  assert.equal(blendedPnlUnderPolicy(row, twoRung), 35);
});

test("comparePolicies: candidate with an earlier rung separates as better when real MFE round-trips consistently", () => {
  const CANDIDATE = [{ triggerPct: 40, fraction: 0.5 }];
  // Five rows, all with real MFE past +40% that fully reversed to a steep loss (the AMZN/TSM pattern).
  const rows = [
    { ticker: "A", entryPremium: 10, peakPremium: 14.2, exitPnlPct: -53 },
    { ticker: "B", entryPremium: 10, peakPremium: 14.5, exitPnlPct: -62 },
    { ticker: "C", entryPremium: 10, peakPremium: 12.6, exitPnlPct: -41 },
    { ticker: "D", entryPremium: 10, peakPremium: 12.0, exitPnlPct: -35 },
    { ticker: "E", entryPremium: 10, peakPremium: 14.1, exitPnlPct: -60 },
  ];
  const result = comparePolicies(rows, CURRENT, CANDIDATE);
  assert.equal(result.n, 5);
  assert.equal(result.meanCurrent, result.paired.reduce((a, p) => a + p.current, 0) / 5);
  assert.ok(result.meanDelta > 0, "candidate should show a positive mean improvement on this fixture");
  assert.equal(result.verdict, "CANDIDATE SEPARATED (better)");
});

test("comparePolicies: identical current/candidate policy yields zero delta and INCONCLUSIVE (not falsely separated)", () => {
  const rows = [
    { ticker: "A", entryPremium: 10, peakPremium: 11, exitPnlPct: 5 },
    { ticker: "B", entryPremium: 10, peakPremium: 9, exitPnlPct: -20 },
  ];
  const result = comparePolicies(rows, CURRENT, CURRENT);
  assert.equal(result.meanDelta, 0);
  assert.notEqual(result.verdict, "CANDIDATE SEPARATED (better)");
  assert.notEqual(result.verdict, "CURRENT SEPARATED (better)");
});

test("comparePolicies: rows lacking a basis are dropped, never fabricated into the n", () => {
  const rows = [
    { ticker: "A", entryPremium: 10, peakPremium: 11, exitPnlPct: 5 },
    { ticker: "B", entryPremium: null, peakPremium: 11, exitPnlPct: 5 },
  ];
  const result = comparePolicies(rows, CURRENT, CURRENT);
  assert.equal(result.n, 1);
});

test("reachRate: counts only rows that actually cross the trigger, never estimates", () => {
  const rows = [
    { entryPremium: 10, peakPremium: 14 }, // +40%, reaches a 40 trigger, not a 100 trigger
    { entryPremium: 10, peakPremium: 10.2 }, // +2%, reaches neither
    { entryPremium: 10, peakPremium: 25 }, // +150%, reaches both
  ];
  assert.deepEqual(reachRate(rows, 40), { n: 3, reached: 2, pct: 66.7 });
  assert.deepEqual(reachRate(rows, 100), { n: 3, reached: 1, pct: 33.3 });
});
