import assert from "node:assert/strict";
import { test } from "node:test";
import { preferredVectorBoardSection } from "./vector-pick-log-board-utils";

test("preferredVectorBoardSection prefers winners when any exist", () => {
  assert.equal(preferredVectorBoardSection(2, 10), "winners");
});

test("preferredVectorBoardSection opens Live when winners empty but leaders exist", () => {
  assert.equal(preferredVectorBoardSection(0, 77), "leaders");
});

test("preferredVectorBoardSection stays on winners when both empty", () => {
  assert.equal(preferredVectorBoardSection(0, 0), "winners");
});
