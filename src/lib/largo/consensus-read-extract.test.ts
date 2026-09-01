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
  // (Uses HELIX flow, not THERMAL, for the bullish side — see the THERMAL tests below for why
  // dealer gamma can no longer be one of the two real votes in this scenario.)
  const toolResults = {
    get_flow_tape: { call_volume: 90, put_volume: 10 }, // bullish
    get_vector_full_state: { bias: "short" }, // bearish
  };
  const { agreement } = extractConsensusFromTools(toolResults);
  assert.equal(agreement.bullish, 1);
  assert.equal(agreement.bearish, 1);
  assert.equal(agreement.verdict, "conflicted");
  assert.equal(agreement.direction, null);
});

test("extractConsensusFromTools: THERMAL never casts a bullish/bearish vote off dealer gamma posture", () => {
  // Regression pin for a real bug: dealer gamma is not a directional measurement (short gamma
  // amplifies a move in EITHER direction, long gamma dampens a move in EITHER direction), and
  // this module used to assign "bullish" to a "positive"/long-gamma-ish posture and "bearish" to
  // a "negative"/short-gamma-ish posture off the WRONG field entirely (`gamma_flip`, a numeric
  // price level — the real posture field is `gamma_posture: "long"|"short"|null`). That fabricated
  // vote fed straight into `agreement.bullish/bearish`, the split/verdict logic, and — via
  // `adaptive-response-orchestrator.ts` — the PLAY/WAIT/NO_TRADE gate. Long gamma must read
  // "neutral" (mean-reverting) and short gamma must read "mixed" (amplifies both ways), matching
  // the established convention in `helix-thermal-compare.ts::thermalReadFromPosture`.
  const long = extractConsensusFromTools({ get_positioning: { gamma_posture: "long" } });
  assert.equal(long.reads[0]?.system, "THERMAL");
  assert.equal(long.reads[0]?.direction, "neutral");
  assert.equal(long.agreement.bullish, 0);
  assert.equal(long.agreement.bearish, 0);

  const short = extractConsensusFromTools({ get_positioning: { gamma_posture: "short" } });
  assert.equal(short.reads[0]?.direction, "mixed");
  assert.equal(short.agreement.bullish, 0);
  assert.equal(short.agreement.bearish, 0);

  // A wrong-shaped payload using the OLD (bogus) field must not accidentally revive the bug.
  const stale = extractConsensusFromTools({ get_positioning: { gamma_flip: "positive" } });
  assert.equal(stale.reads[0]?.direction, "neutral");
  assert.equal(stale.agreement.bullish, 0);
});
