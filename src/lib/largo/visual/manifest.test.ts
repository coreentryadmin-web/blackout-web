import test from "node:test";
import assert from "node:assert/strict";
import { createRecorder, buildManifest, unsourcedValues } from "./manifest";
import type { VisualBundle } from "./types";

const bundle: VisualBundle = {
  systemsQueried: ["THERMAL", "HELIX"],
  asOf: "2026-08-10T14:38:22Z",
};

test("the recorder logs what was DRAWN, not what was available", () => {
  const r = createRecorder();
  r.value("Spot", "7,757.58", "THERMAL", "2026-08-10T14:38:22Z");
  r.value("Put wall", "7,725", "THERMAL");
  assert.equal(r.values.length, 2);
  assert.equal(r.values[0]!.asOf, "2026-08-10T14:38:22Z");
});

test("a null value is an OMISSION, never a blank claim in the audit trail", () => {
  const r = createRecorder();
  r.value("Max pain", null, "THERMAL");
  r.value("Flip", undefined, "THERMAL");
  r.value("Empty", "", "THERMAL");
  assert.deepEqual(r.values, [], "nothing absent may appear as a rendered value");
});

test("omissions are recorded by name and deduped", () => {
  const r = createRecorder();
  r.omit("gex shifts");
  r.omit("timeline");
  r.omit("gex shifts");
  assert.deepEqual(r.omissions, ["gex shifts", "timeline"]);
});

test("the manifest dates the SNAPSHOT, separately from the encode", () => {
  const r = createRecorder();
  r.value("Spot", "7,757.58", "THERMAL");
  const renderedAtMs = Date.parse("2026-08-10T15:10:00Z");
  const m = buildManifest({ template: "MARKET_MOVE", size: "x_landscape", bundle, recorder: r, renderedAtMs, question: "why did SPX dump?" });

  // These MUST differ — conflating them would date a card to when someone pressed a button
  // rather than to the market instant it describes.
  assert.equal(m.dataAsOf, "2026-08-10T14:38:22Z");
  assert.equal(m.renderedAt, "2026-08-10T15:10:00.000Z");
  assert.notEqual(m.dataAsOf, m.renderedAt);

  assert.equal(m.template, "MARKET_MOVE");
  assert.deepEqual(m.dimensions, { width: 1200, height: 630 });
  assert.deepEqual(m.systemsQueried, ["THERMAL", "HELIX"]);
  assert.equal(m.question, "why did SPX dump?");
  assert.equal(m.version, 1);
});

test("the asset id is derived from the snapshot, so it is matchable to an asset found later", () => {
  const r = createRecorder();
  const m = buildManifest({ template: "LEVEL_ANALYSIS", size: "square", bundle, recorder: r, renderedAtMs: 0 });
  assert.match(m.assetId, /^level_analysis-square-20260810143822-\d{3}$/);
});

test("EVERY rendered value must trace to a known system — the hardcoded-literal check", () => {
  // The bundle's omission rule cannot catch a number a template hardcoded into its layout,
  // because such a value never passes through the bundle at all. This is that backstop.
  const r = createRecorder();
  r.value("Spot", "7,757.58", "THERMAL");
  r.value("Made up", "42", "MARKETING" as never);
  const m = buildManifest({ template: "MARKET_MOVE", size: "x_landscape", bundle, recorder: r, renderedAtMs: 0 });
  assert.deepEqual(unsourcedValues(m), ["Made up"]);

  const clean = createRecorder();
  clean.value("Spot", "7,757.58", "THERMAL");
  assert.deepEqual(
    unsourcedValues(buildManifest({ template: "MARKET_MOVE", size: "x_landscape", bundle, recorder: clean, renderedAtMs: 0 })),
    []
  );
});

test("a replayed turn is marked as one", () => {
  const r = createRecorder();
  const m = buildManifest({ template: "MARKET_MOVE", size: "story", bundle, recorder: r, renderedAtMs: 0, replayOfTurn: "turn_abc" });
  assert.equal(m.replayOfTurn, "turn_abc");
  // A live render says so by carrying null rather than omitting the field.
  const live = buildManifest({ template: "MARKET_MOVE", size: "story", bundle, recorder: r, renderedAtMs: 0 });
  assert.equal(live.replayOfTurn, null);
});
