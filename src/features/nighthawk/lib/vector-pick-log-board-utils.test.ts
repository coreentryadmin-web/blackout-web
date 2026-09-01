import assert from "node:assert/strict";
import { test } from "node:test";
import {
  filterVectorRunnerLeaders,
  preferredVectorBoardSection,
} from "./vector-pick-log-board-utils";

test("preferredVectorBoardSection prefers winners when any exist", () => {
  assert.equal(preferredVectorBoardSection(2, 5, 10), "winners");
});

test("preferredVectorBoardSection opens Runners when winners empty but +15% names exist", () => {
  assert.equal(preferredVectorBoardSection(0, 3, 77), "runners");
});

test("preferredVectorBoardSection opens Live when only sub-15% leaders remain", () => {
  assert.equal(preferredVectorBoardSection(0, 0, 77), "leaders");
});

test("preferredVectorBoardSection stays on winners when all empty", () => {
  assert.equal(preferredVectorBoardSection(0, 0, 0), "winners");
});

test("filterVectorRunnerLeaders keeps +15%…+49% non-winners", () => {
  const rows = filterVectorRunnerLeaders([
    {
      premium_pct_from_entry: 30,
      peak_premium_pct: 35,
      action_status: "caution",
      is_winner: false,
    },
    {
      premium_pct_from_entry: 55,
      peak_premium_pct: 55,
      action_status: "caution",
      is_winner: true,
    },
    {
      premium_pct_from_entry: 5,
      peak_premium_pct: 5,
      action_status: "still_buy",
      is_winner: false,
    },
  ]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.premium_pct_from_entry, 30);
});
