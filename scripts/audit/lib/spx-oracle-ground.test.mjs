import test from "node:test";
import assert from "node:assert/strict";
import { inRthOpenWindow } from "../../gha-et-window.mjs";

test("inRthOpenWindow: 16:02 ET is still audit RTH (post-close grace through 16:15)", () => {
  const nov4_1602_et = new Date("2026-11-04T21:02:00.000Z");
  assert.equal(inRthOpenWindow(nov4_1602_et), true);
});

test("inRthOpenWindow: 16:20 ET is outside audit RTH", () => {
  const nov4_1620_et = new Date("2026-11-04T21:20:00.000Z");
  assert.equal(inRthOpenWindow(nov4_1620_et), false);
});
