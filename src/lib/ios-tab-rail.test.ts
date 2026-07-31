import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  IOS_TAB_RAIL,
  getIosTabRailIndex,
  isIosIntelligenceHubPath,
  isIosTabRailActive,
} from "@/lib/ios-tab-rail";

describe("IOS_TAB_RAIL", () => {
  it("defines five primary tabs with intelligence hub grouping", () => {
    assert.equal(IOS_TAB_RAIL.length, 5);
    assert.deepEqual(
      IOS_TAB_RAIL.map((t) => t.code),
      ["SPX", "INT", "VEC", "HWK", "LRG"]
    );
    assert.equal(IOS_TAB_RAIL.find((t) => t.intelligenceHub)?.href, "/flows");
  });

  it("keeps Intel tab active on flows and heatmap routes", () => {
    const intel = IOS_TAB_RAIL.find((t) => t.intelligenceHub)!;
    assert.equal(isIosTabRailActive(intel, "/flows"), true);
    assert.equal(isIosTabRailActive(intel, "/heatmap"), true);
    assert.equal(isIosTabRailActive(intel, "/vector"), false);
  });

  it("resolves tab index for transitions", () => {
    assert.equal(getIosTabRailIndex("/dashboard"), 0);
    assert.equal(getIosTabRailIndex("/heatmap"), 1);
    assert.equal(getIosTabRailIndex("/vector"), 2);
    assert.equal(getIosTabRailIndex("/nighthawk"), 3);
    assert.equal(getIosTabRailIndex("/terminal"), 4);
  });

  it("detects intelligence hub paths", () => {
    assert.equal(isIosIntelligenceHubPath("/flows"), true);
    assert.equal(isIosIntelligenceHubPath("/heatmap"), true);
    assert.equal(isIosIntelligenceHubPath("/dashboard"), false);
  });
});
