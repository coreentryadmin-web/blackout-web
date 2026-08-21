import assert from "node:assert/strict";
import test from "node:test";

import { resolveToolSelection } from "./tool-selection.mjs";

const TOOLS = [
  ["get_quote", { ticker: "SPX" }],
  ["get_gex", { ticker: "SPX" }],
  ["get_zerodte_record", { days: 30 }],
];
const KNOWN = new Set(["get_quote", "get_gex", "get_zerodte_record", "get_market_context"]);

test("no selection scans the full curated list", () => {
  const r = resolveToolSelection([], TOOLS, KNOWN);
  assert.equal(r.filtered, false);
  assert.equal(r.selected.length, 3);
  assert.deepEqual(r.unknown, []);
  assert.deepEqual(r.uncurated, []);
});

// The whole defect in one test: before the fix, this returned all 3.
test("a selection actually narrows the scan", () => {
  const r = resolveToolSelection(["get_zerodte_record"], TOOLS, KNOWN);
  assert.equal(r.filtered, true);
  assert.deepEqual(r.selected.map(([n]) => n), ["get_zerodte_record"]);
});

test("a typo is reported as unknown, never as an empty or clean scan", () => {
  const r = resolveToolSelection(["get_zerodte_recordz"], TOOLS, KNOWN);
  assert.deepEqual(r.unknown, ["get_zerodte_recordz"]);
  assert.deepEqual(r.uncurated, []);
});

test("a real-but-uncurated tool is a COVERAGE GAP, kept distinct from a typo", () => {
  const r = resolveToolSelection(["get_market_context"], TOOLS, KNOWN);
  assert.deepEqual(r.unknown, [], "it is a real tool — calling it a typo sends the operator to the wrong fix");
  assert.deepEqual(r.uncurated, ["get_market_context"]);
});

test("both failure kinds surface together rather than one masking the other", () => {
  const r = resolveToolSelection(["nope", "get_market_context", "get_gex"], TOOLS, KNOWN);
  assert.deepEqual(r.unknown, ["nope"]);
  assert.deepEqual(r.uncurated, ["get_market_context"]);
  assert.deepEqual(r.selected.map(([n]) => n), ["get_gex"]);
});

test("selection preserves CURATED order, not the order typed, so runs are diffable", () => {
  const r = resolveToolSelection(["get_zerodte_record", "get_quote"], TOOLS, KNOWN);
  assert.deepEqual(r.selected.map(([n]) => n), ["get_quote", "get_zerodte_record"]);
});

test("whitespace and empty entries are tolerated, not turned into phantom names", () => {
  const r = resolveToolSelection([" get_gex ", "", "  "], TOOLS, KNOWN);
  assert.deepEqual(r.selected.map(([n]) => n), ["get_gex"]);
  assert.deepEqual(r.unknown, []);
});

test("a duplicated name does not duplicate the scan", () => {
  const r = resolveToolSelection(["get_gex", "get_gex"], TOOLS, KNOWN);
  assert.equal(r.selected.length, 1);
});
