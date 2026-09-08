import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  HELIX_FILTER_PRESETS,
  applyHelixFilterPreset,
  helixPresetMatches,
  HELIX_DEFAULT_TAPE_FILTERS,
} from "./helix-filter-presets.ts";

describe("helix filter presets", () => {
  test("applyHelixFilterPreset resets unspecified fields to defaults", () => {
    const whale = applyHelixFilterPreset(
      HELIX_FILTER_PRESETS.find((p) => p.id === "whale-hunt")!
    );
    assert.equal(whale.minPremium, 1_000_000);
    assert.equal(whale.whalesOnly, true);
    assert.equal(whale.dteFilter, "all");
    assert.equal(whale.directionFilter, "all");
  });

  test("helixPresetMatches detects active preset slice", () => {
    const bull = applyHelixFilterPreset(
      HELIX_FILTER_PRESETS.find((p) => p.id === "bull-flow")!
    );
    assert.equal(
      helixPresetMatches(HELIX_FILTER_PRESETS.find((p) => p.id === "bull-flow")!, bull),
      true
    );
    assert.equal(helixPresetMatches(HELIX_FILTER_PRESETS.find((p) => p.id === "bear-flow")!, bull), false);
    assert.equal(helixPresetMatches(HELIX_FILTER_PRESETS.find((p) => p.id === "bull-flow")!, HELIX_DEFAULT_TAPE_FILTERS), false);
  });
});
