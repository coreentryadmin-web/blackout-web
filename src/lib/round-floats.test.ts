import { test } from "node:test";
import assert from "node:assert/strict";
import { roundFloats, reconcileStrikeTotal } from "./round-floats";

test("rounds spurious float noise to 2dp by default", () => {
  assert.equal(roundFloats(7499.360000000001), 7499.36);
  assert.equal(roundFloats(-12701691969.618551), -12701691969.62);
});

test("leaves integers untouched (timestamps, counts, IDs)", () => {
  assert.equal(roundFloats(1751000000000), 1751000000000);
  assert.equal(roundFloats(0), 0);
  assert.equal(roundFloats(-42), -42);
});

test("leaves NaN/Infinity untouched rather than producing garbage", () => {
  assert.equal(roundFloats(NaN), NaN);
  assert.equal(roundFloats(Infinity), Infinity);
  assert.equal(roundFloats(-Infinity), -Infinity);
});

test("walks nested objects and arrays", () => {
  const input = {
    price: 7529.650000000001,
    meta: { vwap: 7514.418974358975, count: 12 },
    rows: [{ entry: 7430.900000000001, id: 9007199254740 }, { entry: null }],
  };
  assert.deepEqual(roundFloats(input), {
    price: 7529.65,
    meta: { vwap: 7514.42, count: 12 },
    rows: [{ entry: 7430.9, id: 9007199254740 }, { entry: null }],
  });
});

test("supports a custom decimal-place count", () => {
  assert.equal(roundFloats(1.23456, 4), 1.2346);
});

test("passes through non-numeric leaves unchanged", () => {
  assert.deepEqual(roundFloats({ a: "text", b: true, c: null, d: undefined }), {
    a: "text",
    b: true,
    c: null,
    d: undefined,
  });
});

// ── reconcileStrikeTotal — live-caught P0: NVDA GEX Σstrike_totals != total ────────

test("reconcileStrikeTotal: reproduces the live NVDA bug — independently-rounded total drifts from the sum of rounded strike_totals, and gets fixed", () => {
  // Same shape as production: total rounded on its own (-3032.31), strike_totals
  // rounded on their own and summing to -3032.30 — a $0.01 drift from rounding
  // composition, not a wrong number (both derive from the same raw accumulation).
  const block = { total: -3032.31, strike_totals: { "100": -1000.1, "105": -2032.2 } };
  const fixed = reconcileStrikeTotal(block)!;
  assert.equal(fixed.total, -3032.3);
  const sum = Object.values(fixed.strike_totals!).reduce((a, b) => a + b, 0);
  assert.equal(fixed.total, Math.round(sum * 100) / 100);
});

test("reconcileStrikeTotal: total exactly equals the sum whenever they already agree", () => {
  const block = { total: 100, strike_totals: { "50": 40, "55": 60 } };
  assert.equal(reconcileStrikeTotal(block)!.total, 100);
});

test("reconcileStrikeTotal: passes through blocks without strike_totals (e.g. undefined dex/charm) unchanged", () => {
  assert.equal(reconcileStrikeTotal(undefined), undefined);
  const noStrikes = { total: 5 };
  assert.equal(reconcileStrikeTotal(noStrikes), noStrikes);
});

test("reconcileStrikeTotal: an empty strike_totals map reconciles to a zero total", () => {
  const block = { total: 999, strike_totals: {} };
  assert.equal(reconcileStrikeTotal(block)!.total, 0);
});

test("reconcileStrikeTotal: ignores non-finite strike values rather than propagating NaN", () => {
  const block = { total: 5, strike_totals: { "1": 10, "2": NaN } };
  assert.equal(reconcileStrikeTotal(block)!.total, 10);
});
