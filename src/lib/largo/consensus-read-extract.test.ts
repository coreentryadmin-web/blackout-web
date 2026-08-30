import test from "node:test";
import assert from "node:assert/strict";
import { extractConsensusFromTools } from "./consensus-read-extract";

test("extractConsensusFromTools: unanimous neutral reads must verdict neutral, not fabricate conflicted", () => {
  // Regression pin: bullishCount=0, bearishCount=0 satisfies the old tie-break guard
  // `abs(bullishCount - bearishCount) <= 1` (0 <= 1), which reported "conflicted"/direction:null
  // even though every system agreed on neutral — the exact fabricated disagreement this module's
  // own header says it must never invent ("Surfaces disagreements without reconciling them" cuts
  // both ways: it must not invent a conflict any more than it may erase a real one).
  const toolResults = {
    get_flow_tape: {},
    get_positioning: {},
    get_vector_full_state: {},
    get_spx_structure: {},
    get_meridian_timeline: {},
  };
  const { agreement } = extractConsensusFromTools(toolResults);
  assert.equal(agreement.voting, 5);
  assert.equal(agreement.bullish, 0);
  assert.equal(agreement.bearish, 0);
  assert.equal(agreement.neutral, 5);
  assert.equal(agreement.verdict, "neutral", "unanimous neutral must read as neutral, not conflicted");
  assert.equal(agreement.direction, "neutral");
});

test("extractConsensusFromTools: a single neutral system reads neutral, not conflicted", () => {
  const { agreement } = extractConsensusFromTools({ get_flow_tape: {} });
  assert.equal(agreement.voting, 1);
  assert.equal(agreement.verdict, "neutral");
  assert.equal(agreement.direction, "neutral");
});

test("extractConsensusFromTools: a genuine near-even bull/bear split still reads conflicted", () => {
  // One real bullish vote against one real bearish vote is an actual conflict and must stay
  // "conflicted" — the fix must not suppress true disagreement, only the false all-neutral case.
  const toolResults = {
    get_positioning: { gamma_flip: "positive" }, // bullish
    get_vector_full_state: { bias: "short" }, // bearish
  };
  const { agreement } = extractConsensusFromTools(toolResults);
  assert.equal(agreement.bullish, 1);
  assert.equal(agreement.bearish, 1);
  assert.equal(agreement.verdict, "conflicted");
  assert.equal(agreement.direction, null);
});
