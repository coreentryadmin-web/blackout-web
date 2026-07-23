import { test } from "node:test";
import assert from "node:assert/strict";
import {
  NIGHTHAWK_VIEWS,
  DEFAULT_NIGHTHAWK_VIEW,
  parseNightHawkView,
  horizonForView,
  viewForHorizon,
  isNightHawkView,
  NIGHTHAWK_VIEW_META,
} from "./nighthawk-view.ts";

test("the toggle has exactly four views in fast→slow→legacy order", () => {
  assert.deepEqual([...NIGHTHAWK_VIEWS], ["ZERO_DTE", "SWING", "LEAPS", "LEGACY"]);
});

test("parseNightHawkView resolves aliases case-insensitively, else the default", () => {
  assert.equal(parseNightHawkView("0dte"), "ZERO_DTE");
  assert.equal(parseNightHawkView("ZeroDte"), "ZERO_DTE");
  assert.equal(parseNightHawkView("swings"), "SWING");
  assert.equal(parseNightHawkView("leap"), "LEAPS");
  assert.equal(parseNightHawkView("playbook"), "LEGACY");
  assert.equal(parseNightHawkView("tonight"), "LEGACY");
  assert.equal(parseNightHawkView("nonsense"), DEFAULT_NIGHTHAWK_VIEW);
  assert.equal(parseNightHawkView(null), DEFAULT_NIGHTHAWK_VIEW);
});

test("horizonForView maps the three horizon views and null for legacy", () => {
  assert.equal(horizonForView("ZERO_DTE"), "ZERO_DTE");
  assert.equal(horizonForView("SWING"), "SWING");
  assert.equal(horizonForView("LEAPS"), "LEAPS");
  assert.equal(horizonForView("LEGACY"), null);
});

test("viewForHorizon round-trips the three horizon lanes", () => {
  assert.equal(viewForHorizon("ZERO_DTE"), "ZERO_DTE");
  assert.equal(viewForHorizon("SWING"), "SWING");
  assert.equal(viewForHorizon("LEAPS"), "LEAPS");
});

test("isNightHawkView guards the union", () => {
  assert.ok(isNightHawkView("SWING"));
  assert.ok(!isNightHawkView("swing")); // exact union member only
  assert.ok(!isNightHawkView(42));
});

test("every view has renderable meta (label/tag/blurb)", () => {
  for (const v of NIGHTHAWK_VIEWS) {
    const m = NIGHTHAWK_VIEW_META[v];
    assert.ok(m.label && m.tag && m.blurb, `${v} needs full meta`);
  }
  assert.equal(NIGHTHAWK_VIEW_META.LEGACY.label, "Legacy");
  assert.equal(NIGHTHAWK_VIEW_META.SWING.label, "Swings");
});
