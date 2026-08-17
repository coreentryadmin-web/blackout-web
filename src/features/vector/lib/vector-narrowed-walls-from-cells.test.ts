import test from "node:test";
import assert from "node:assert/strict";
import { strikeTotalsForHorizonFromCells } from "./vector-narrowed-walls-from-cells";

// A narrowed horizon is a SUBSET OF EXPIRY COLUMNS of the matrix the sweep already fetched. These
// pin that reduction, because it is what makes 5s narrowed rails affordable (and therefore what
// closes the ~300s holes measured on un-viewed tickers on 2026-08-17).

const TODAY = "2026-08-17";
// 0dte = today; weekly reaches a few days; monthly reaches ~a month out.
const EXPIRIES = ["2026-08-17", "2026-08-21", "2026-09-18"];
const CELLS = {
  "100": { "2026-08-17": 10, "2026-08-21": 5, "2026-09-18": 1 },
  "105": { "2026-08-17": -4, "2026-08-21": 2, "2026-09-18": 8 },
  "110": { "2026-08-17": 0, "2026-08-21": 0, "2026-09-18": 3 },
};

test("0dte sums ONLY today's column", () => {
  const t = strikeTotalsForHorizonFromCells(CELLS, EXPIRIES, "0dte", TODAY);
  assert.ok(t);
  assert.equal(t.get(100), 10);
  assert.equal(t.get(105), -4);
  // 110 is flat today — it is not a wall in this horizon even though it carries weight in Sept.
  assert.equal(t.get(110), undefined);
});

test("'all' reproduces the blended totals exactly — every column summed", () => {
  // The blended rail must be derivable through the same path, or the narrowed rails would be
  // describing a different book than the one beside them.
  const t = strikeTotalsForHorizonFromCells(CELLS, EXPIRIES, "all", TODAY);
  assert.ok(t);
  assert.equal(t.get(100), 16); // 10 + 5 + 1
  assert.equal(t.get(105), 6); // -4 + 2 + 8
  assert.equal(t.get(110), 3); // 0 + 0 + 3
});

test("a wider horizon is a superset of a narrower one's expiries, so totals accumulate", () => {
  const near = strikeTotalsForHorizonFromCells(CELLS, EXPIRIES, "0dte", TODAY);
  const all = strikeTotalsForHorizonFromCells(CELLS, EXPIRIES, "all", TODAY);
  assert.ok(near && all);
  // 100 is positive in every column, so widening can only grow it.
  assert.ok((all.get(100) ?? 0) > (near.get(100) ?? 0));
});

test("zero-total strikes are dropped so the wall ranking stays honest", () => {
  const flat = { "200": { "2026-08-17": 0, "2026-08-21": 0, "2026-09-18": 0 } };
  assert.equal(strikeTotalsForHorizonFromCells(flat, EXPIRIES, "all", TODAY), null);
});

test("degraded inputs return null rather than an empty-but-truthy map", () => {
  // A null return lets the caller SKIP the write; an empty map would record a wall-less sample and
  // paint a gap that looks like the recorder died.
  assert.equal(strikeTotalsForHorizonFromCells(undefined, EXPIRIES, "0dte", TODAY), null);
  assert.equal(strikeTotalsForHorizonFromCells(CELLS, [], "0dte", TODAY), null);
  assert.equal(strikeTotalsForHorizonFromCells(CELLS, undefined, "0dte", TODAY), null);
});

test("non-numeric strike keys are ignored, not coerced to NaN buckets", () => {
  const dirty = { ...CELLS, junk: { "2026-08-17": 99 } };
  const t = strikeTotalsForHorizonFromCells(dirty, EXPIRIES, "0dte", TODAY);
  assert.ok(t);
  for (const k of t.keys()) assert.ok(Number.isFinite(k), `non-finite strike key ${k}`);
});

test("expiries absent from a strike's row contribute nothing (no undefined arithmetic)", () => {
  const sparse = { "100": { "2026-08-21": 7 } }; // no 0dte column at all
  assert.equal(strikeTotalsForHorizonFromCells(sparse, EXPIRIES, "0dte", TODAY), null);
  const wide = strikeTotalsForHorizonFromCells(sparse, EXPIRIES, "all", TODAY);
  assert.equal(wide?.get(100), 7);
});
