import { test } from "node:test";
import assert from "node:assert/strict";
import { assembleSwingDataFusion, isCorroboratedTierZero } from "./data-fusion";

test("isCorroboratedTierZero requires FLOW and STRUCTURE", () => {
  assert.equal(isCorroboratedTierZero(["FLOW"]), false);
  assert.equal(isCorroboratedTierZero(["FLOW", "STRUCTURE"]), true);
});

test("assembleSwingDataFusion signs direction from accumulation", () => {
  const bundle = assembleSwingDataFusion({
    ticker: "nvda",
    paths: ["FLOW"],
    accumulation: {
      ticker: "NVDA",
      direction: "bull",
      strength: 0.8,
      netSignedPremium: 500_000,
      magnet: null,
      top: [],
    },
    mover: null,
    spyCloses: [100, 101, 102],
    asOf: "2026-09-04T20:00:00.000Z",
    sessionDay: "2026-09-04",
    intendedDte: 14,
  });
  assert.equal(bundle.direction, "LONG");
  assert.equal(bundle.positioning, null);
});
