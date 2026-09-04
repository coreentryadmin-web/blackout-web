import test from "node:test";
import assert from "node:assert/strict";
import { volumeProfileLabelX } from "./vector-volume-profile-primitive";
import { volumeProfileGutter } from "./vector-volume-profile-layout";

test("volumeProfileLabelX: anchors POC/VAH/VAL left of profile bars, not at price axis", () => {
  const gutter = volumeProfileGutter(1200, 1100)!;
  const labelX = volumeProfileLabelX(gutter.gutterLeft);
  assert.ok(labelX < gutter.rightX - 20, "labels must sit well left of axis badges");
  assert.equal(labelX, gutter.gutterLeft + 4);
});
