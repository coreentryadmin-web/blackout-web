import test from "node:test";
import assert from "node:assert/strict";
import { inRthOpenWindow } from "./gha-et-window.mjs";

test("inRthOpenWindow includes 4:30 PM ET post-close audit slot (EST)", () => {
  assert.equal(inRthOpenWindow(new Date("2026-11-09T21:30:00.000Z")), true);
});

test("inRthOpenWindow excludes 6 PM ET after-hours", () => {
  assert.equal(inRthOpenWindow(new Date("2026-11-09T23:11:00.000Z")), false);
});
