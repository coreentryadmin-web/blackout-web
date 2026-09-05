import assert from "node:assert/strict";
import { test } from "node:test";
import {
  anyInternalsEstimated,
  formatInternalReading,
  internalEstimatedTip,
} from "./spx-internals-display.ts";

test("formatInternalReading appends est. when proxy-derived", () => {
  assert.equal(formatInternalReading(250, true, 0), "250 est.");
  assert.equal(formatInternalReading(0.82, true, 2), "0.82 est.");
  assert.equal(formatInternalReading(250, false, 0), "250");
});

test("formatInternalReading returns dash for null", () => {
  assert.equal(formatInternalReading(null, false), "—");
});

test("anyInternalsEstimated is true when any field is estimated", () => {
  assert.equal(anyInternalsEstimated({ internals_estimated: { tick: true, trin: false, add: false } }), true);
  assert.equal(anyInternalsEstimated({ internals_estimated: { tick: false, trin: false, add: false } }), false);
  assert.equal(anyInternalsEstimated(undefined), false);
});

test("internalEstimatedTip names the field", () => {
  assert.match(internalEstimatedTip("tick"), /NYSE TICK/);
  assert.match(internalEstimatedTip("trin"), /TRIN/);
});
