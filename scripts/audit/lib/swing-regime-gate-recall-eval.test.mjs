import { test } from "node:test";
import assert from "node:assert/strict";
import {
  signAlignedMovePctBullBear,
  classifyForwardOutcome,
  summarizeGroup,
  compareRegimeGateGroups,
} from "./swing-regime-gate-recall-eval.mjs";

test("signAlignedMovePctBullBear: bull move is raw sign", () => {
  const pct = signAlignedMovePctBullBear({ fromPrice: 100, toPrice: 105, direction: "bull" });
  assert.ok(Math.abs(pct - 5) < 1e-9);
});

test("signAlignedMovePctBullBear: bear move is sign-flipped", () => {
  const pct = signAlignedMovePctBullBear({ fromPrice: 100, toPrice: 95, direction: "bear" });
  assert.ok(Math.abs(pct - 5) < 1e-9);
});

test("signAlignedMovePctBullBear: bear move against the position is negative", () => {
  const pct = signAlignedMovePctBullBear({ fromPrice: 100, toPrice: 105, direction: "bear" });
  assert.ok(Math.abs(pct - -5) < 1e-9);
});

test("signAlignedMovePctBullBear: null on missing/invalid prices", () => {
  assert.equal(signAlignedMovePctBullBear({ fromPrice: null, toPrice: 105, direction: "bull" }), null);
  assert.equal(signAlignedMovePctBullBear({ fromPrice: 100, toPrice: null, direction: "bull" }), null);
  assert.equal(signAlignedMovePctBullBear({ fromPrice: 0, toPrice: 105, direction: "bull" }), null);
  assert.equal(signAlignedMovePctBullBear({ fromPrice: 100, toPrice: -5, direction: "bull" }), null);
  assert.equal(signAlignedMovePctBullBear({ fromPrice: NaN, toPrice: 105, direction: "bull" }), null);
});

test("classifyForwardOutcome: favorable when move clears threshold", () => {
  assert.equal(classifyForwardOutcome({ movePct: 2.0, favThresholdPct: 1.5 }), "favorable");
});

test("classifyForwardOutcome: unfavorable when move is below threshold (incl. negative)", () => {
  assert.equal(classifyForwardOutcome({ movePct: 1.0, favThresholdPct: 1.5 }), "unfavorable");
  assert.equal(classifyForwardOutcome({ movePct: -3.0, favThresholdPct: 1.5 }), "unfavorable");
});

test("classifyForwardOutcome: exactly-at-threshold counts as favorable", () => {
  assert.equal(classifyForwardOutcome({ movePct: 1.5, favThresholdPct: 1.5 }), "favorable");
});

test("classifyForwardOutcome: null passthrough on non-numeric movePct", () => {
  assert.equal(classifyForwardOutcome({ movePct: null, favThresholdPct: 1.5 }), null);
  assert.equal(classifyForwardOutcome({ movePct: NaN, favThresholdPct: 1.5 }), null);
});

test("summarizeGroup: computes n/favorableCount/favorablePct/meanMovePct", () => {
  const rows = [
    { movePct: 5, outcome: "favorable" },
    { movePct: -2, outcome: "unfavorable" },
    { movePct: 3, outcome: "favorable" },
  ];
  const s = summarizeGroup(rows);
  assert.equal(s.n, 3);
  assert.equal(s.favorableCount, 2);
  assert.ok(Math.abs(s.favorablePct - (200 / 3)) < 1e-9);
  assert.ok(Math.abs(s.meanMovePct - 2) < 1e-9);
});

test("summarizeGroup: excludes null/NaN movePct rows from n", () => {
  const rows = [
    { movePct: 5, outcome: "favorable" },
    { movePct: null, outcome: null },
    { movePct: NaN, outcome: null },
  ];
  const s = summarizeGroup(rows);
  assert.equal(s.n, 1);
  assert.equal(s.meanMovePct, 5);
});

test("summarizeGroup: empty/all-unusable input reports honest nulls, not fabricated zeros", () => {
  const s = summarizeGroup([{ movePct: null, outcome: null }]);
  assert.equal(s.n, 0);
  assert.equal(s.favorablePct, null);
  assert.equal(s.meanMovePct, null);
});

test("compareRegimeGateGroups: splits by gatePass and reports deltas", () => {
  const rows = [
    { gatePass: false, movePct: -5, outcome: "unfavorable" },
    { gatePass: false, movePct: -3, outcome: "unfavorable" },
    { gatePass: true, movePct: 4, outcome: "favorable" },
    { gatePass: true, movePct: 6, outcome: "favorable" },
  ];
  const cmp = compareRegimeGateGroups(rows);
  assert.equal(cmp.blocked.n, 2);
  assert.equal(cmp.clear.n, 2);
  assert.equal(cmp.blocked.favorablePct, 0);
  assert.equal(cmp.clear.favorablePct, 100);
  assert.ok(cmp.deltaFavorablePp < 0, "blocked should show a lower favorable rate in this fixture");
  assert.ok(cmp.deltaMeanMovePct < 0, "blocked should show a lower mean move in this fixture");
});

test("compareRegimeGateGroups: a gate that separates an ARBITRARY half shows ~0 delta", () => {
  const rows = [
    { gatePass: false, movePct: 3, outcome: "favorable" },
    { gatePass: false, movePct: -3, outcome: "unfavorable" },
    { gatePass: true, movePct: 3, outcome: "favorable" },
    { gatePass: true, movePct: -3, outcome: "unfavorable" },
  ];
  const cmp = compareRegimeGateGroups(rows);
  assert.equal(cmp.blocked.meanMovePct, 0);
  assert.equal(cmp.clear.meanMovePct, 0);
  assert.equal(cmp.deltaMeanMovePct, 0);
  assert.equal(cmp.deltaFavorablePp, 0);
});

test("compareRegimeGateGroups: null deltas when one side is empty (never fabricated)", () => {
  const rows = [{ gatePass: true, movePct: 5, outcome: "favorable" }];
  const cmp = compareRegimeGateGroups(rows);
  assert.equal(cmp.blocked.n, 0);
  assert.equal(cmp.deltaFavorablePp, null);
  assert.equal(cmp.deltaMeanMovePct, null);
});
