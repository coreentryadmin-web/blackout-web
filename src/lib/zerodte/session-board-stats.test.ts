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

test("computeZeroDteSessionBoardStats: live setups' own block wins over the stale session-cumulative funnel tally", () => {
  // funnelTopCode ("score_floor") is discovery_funnel.top_gate, a running tally since market
  // open — it must NOT override what THIS pass's setups[] actually show blocking right now
  // ("cortex_gex_walls"). Regression for the 2026-09-17 finding: top_block_code used to prefer
  // the stale cumulative code whenever it was non-empty, which is almost always.
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
  assert.equal(stats.top_block_code, "cortex_gex_walls");
});

test("computeZeroDteSessionBoardStats: falls back to the cumulative funnel code when this pass has no block data of its own", () => {
  // Every setup this pass is COMMIT-ready (or setups[] is empty) — no live block distribution to
  // report, so the session-cumulative funnel figure is the only signal available and is used.
  const stats = computeZeroDteSessionBoardStats(
    [{ gate: { verdict: "COMMIT", blocks: [] } }],
    [],
    "score_floor"
  );
  assert.equal(stats.gate_blocked, 0);
  assert.equal(stats.top_block_code, "score_floor");
});

test("computeZeroDteSessionBoardStats: null when neither this pass nor the funnel has a block code — never fabricated", () => {
  const stats = computeZeroDteSessionBoardStats([], [], null);
  assert.equal(stats.top_block_code, null);
  assert.equal(stats.top_block_label, null);
});
