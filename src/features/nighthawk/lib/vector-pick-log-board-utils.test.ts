import assert from "node:assert/strict";
import { test } from "node:test";
import {
  filterVectorRunnerLeaders,
} from "./vector-pick-log-board-utils";

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
