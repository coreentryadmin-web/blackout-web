import test from "node:test";
import assert from "node:assert/strict";
import { computeVectorNearMisses } from "./vector-near-miss";

test("computeVectorNearMisses: winner blocked by cortex surfaces first", () => {
  const misses = computeVectorNearMisses(
    [
      {
        ticker: "NVDA",
        gate: { verdict: "BLOCKED", blocks: [{ code: "cortex_gex_walls", reason: "wall oppose" }] },
      },
      {
        ticker: "TSLA",
        gate: { verdict: "BLOCKED", blocks: [{ code: "score_floor", reason: "low score" }] },
      },
    ],
    {
      NVDA: { premium_pct: 80, peak_premium_pct: 90, action_status: "caution", is_winner: true, is_runner: false },
      TSLA: { premium_pct: 20, peak_premium_pct: 25, action_status: "still_buy", is_winner: false, is_runner: true },
    },
    (c) => c
  );
  assert.equal(misses.length, 2);
  assert.equal(misses[0]!.ticker, "NVDA");
  assert.equal(misses[0]!.vector_band, "winner");
});

test("computeVectorNearMisses: skips COMMIT setups and weak vector tracking", () => {
  const misses = computeVectorNearMisses(
    [
      { ticker: "AMD", gate: { verdict: "COMMIT", blocks: [] } },
      { ticker: "XYZ", gate: { verdict: "BLOCKED", blocks: [{ code: "tape_alignment", reason: "x" }] } },
    ],
    {
      XYZ: { premium_pct: 5, peak_premium_pct: 8, action_status: "still_buy", is_winner: false, is_runner: false },
    },
    (c) => c
  );
  assert.equal(misses.length, 0);
});
