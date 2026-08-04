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

test("the toggle has exactly four views in fast→slow→banger→legacy order", () => {
  assert.deepEqual([...NIGHTHAWK_VIEWS], ["ZERO_DTE", "SWING", "BANGER", "LEGACY"]);
});

test("parseNightHawkView resolves aliases case-insensitively, else the default", () => {
  assert.equal(parseNightHawkView("0dte"), "ZERO_DTE");
  assert.equal(parseNightHawkView("ZeroDte"), "ZERO_DTE");
  assert.equal(parseNightHawkView("swings"), "SWING");
  assert.equal(parseNightHawkView("banger"), "BANGER");
  assert.equal(parseNightHawkView("bangers"), "BANGER");
  assert.equal(parseNightHawkView("weekly"), "BANGER");
  assert.equal(parseNightHawkView("playbook"), "LEGACY");
  assert.equal(parseNightHawkView("tonight"), "LEGACY");
  assert.equal(parseNightHawkView("nonsense"), DEFAULT_NIGHTHAWK_VIEW);
  assert.equal(parseNightHawkView(null), DEFAULT_NIGHTHAWK_VIEW);
  // LEAPS was removed from the visible toggle (2026-08-04) — a stale/shared ?view=leaps link falls
  // back to the default rather than erroring (the horizon-ledger LEAPS id itself is untouched).
  assert.equal(parseNightHawkView("leaps"), DEFAULT_NIGHTHAWK_VIEW);
  assert.equal(parseNightHawkView("leap"), DEFAULT_NIGHTHAWK_VIEW);
});

test("horizonForView maps the two horizon views, and null for legacy/banger", () => {
  assert.equal(horizonForView("ZERO_DTE"), "ZERO_DTE");
  assert.equal(horizonForView("SWING"), "SWING");
  assert.equal(horizonForView("BANGER"), null);
  assert.equal(horizonForView("LEGACY"), null);
});

test("viewForHorizon round-trips the live views, and returns null for the delisted LEAPS horizon", () => {
  assert.equal(viewForHorizon("ZERO_DTE"), "ZERO_DTE");
  assert.equal(viewForHorizon("SWING"), "SWING");
  assert.equal(viewForHorizon("LEAPS"), null);
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
