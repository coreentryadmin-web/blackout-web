import test from "node:test";
import assert from "node:assert/strict";
import { computeZeroDteSessionBoardStats, tallySetupGateLanes } from "./session-board-stats";

test("tallySetupGateLanes: commit vs blocked", () => {
  const { commit_ready, gate_blocked, blockCodeCounts } = tallySetupGateLanes([
    { gate: { verdict: "COMMIT", blocks: [] } },
    { gate: { verdict: "BLOCKED", blocks: [{ code: "score_floor" }] } },
    { gate: { verdict: "BLOCKED", blocks: [{ code: "score_floor" }, { code: "tape_alignment" }] } },
  ]);
  assert.equal(commit_ready, 1);
  assert.equal(gate_blocked, 2);
  assert.equal(blockCodeCounts.get("score_floor"), 2);
});

test("computeZeroDteSessionBoardStats: ledger + funnel top block", () => {
  const stats = computeZeroDteSessionBoardStats(
    [
      { gate: { verdict: "COMMIT", blocks: [] } },
      { gate: { verdict: "BLOCKED", blocks: [{ code: "cortex_gex_walls" }] } },
    ],
    [{ status: "OPEN" }, { status: "CLOSED" }],
    "score_floor"
  );
  assert.equal(stats.scanned, 2);
  assert.equal(stats.commit_ready, 1);
  assert.equal(stats.gate_blocked, 1);
  assert.equal(stats.committed_open, 1);
  assert.equal(stats.committed_closed, 1);
  assert.equal(stats.top_block_code, "score_floor");
});
