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
    get_helix_tape_analytics: {},
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
  const { agreement } = extractConsensusFromTools({ get_helix_tape_analytics: {} });
  assert.equal(agreement.voting, 1);
  assert.equal(agreement.verdict, "neutral");
  assert.equal(agreement.direction, "neutral");
});

test("extractConsensusFromTools: a genuine near-even bull/bear split still reads conflicted", () => {
  // One real bullish vote against one real bearish vote is an actual conflict and must stay
  // "conflicted" — the fix must not suppress true disagreement, only the false all-neutral case.
  // (Uses HELIX tape, not THERMAL, for the bullish side — see the THERMAL tests below for why
  // dealer gamma can no longer be one of the two real votes in this scenario.)
  const toolResults = {
    get_helix_tape_analytics: { session: { direction: "bullish", call_pct: 90, alert_count: 12 } }, // bullish
    get_vector_full_state: { play: { bias: "short" } }, // bearish
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

// 2026-09-04 audit finding — regression pin, same class of bug as the THERMAL one above.
// extractHelixRead used to read invented field names (call_volume/calls_premium/call_prints/
// put_prints) that exist on NEITHER real HELIX tool payload, so every real call silently fell
// through to the hardcoded {strength:0,"No flow detected"} default regardless of real flow.
test("extractConsensusFromTools: HELIX reads the real get_helix_tape_analytics shape, never the invented one", () => {
  // Real shape: session.direction (aggressor-aware), NOT call_volume/calls_premium.
  const bullish = extractConsensusFromTools({
    get_helix_tape_analytics: {
      session: { direction: "bullish", call_pct: 78, alert_count: 40, direction_readable_pct: 90 },
    },
  });
  assert.equal(bullish.reads[0]?.system, "HELIX");
  assert.equal(bullish.reads[0]?.direction, "bullish");
  assert.ok(bullish.reads[0]!.strength > 0);

  // The exact live incident this fix guards against: CG was 100% call premium (call_pct=100)
  // but every call was SOLD — measurably bearish. call_pct alone must NEVER decide direction
  // when session.direction is present; direction wins even though call_pct disagrees with it.
  const soldCalls = extractConsensusFromTools({
    get_helix_tape_analytics: {
      session: { direction: "bearish", call_pct: 100, alert_count: 8 },
    },
  });
  assert.equal(
    soldCalls.reads[0]?.direction,
    "bearish",
    "session.direction must win over call_pct even when call_pct alone would suggest the opposite"
  );

  // "undetermined" is a real refusal, not an invitation to fall back to call_pct.
  const undetermined = extractConsensusFromTools({
    get_helix_tape_analytics: { session: { direction: "undetermined", call_pct: 80 } },
  });
  assert.equal(undetermined.reads[0]?.direction, "neutral");

  // A payload with the OLD invented fields (and no `session` at all) must not silently pass —
  // it degrades to the honest "no measurable direction" neutral, never a fabricated read from
  // fields that were never real.
  const stale = extractConsensusFromTools({
    get_helix_tape_analytics: { call_volume: 90, put_volume: 10, call_prints: 20, put_prints: 2 },
  });
  assert.equal(stale.reads[0]?.direction, "neutral");
  assert.match(stale.reads[0]!.basis, /no measurable/i);

  // A genuine read failure casts no vote at all (excluded, not defaulted to neutral).
  const failed = extractConsensusFromTools({
    get_helix_tape_analytics: { available: false, unavailable: { reason: "helix_tape_analytics_failed" } },
  });
  assert.equal(failed.agreement.voting, 0);

  // get_flow_tape / get_helix_derived are NO LONGER fed through this extractor at all — even a
  // payload shaped to look bullish on the old (removed) reading must contribute ZERO votes.
  const oldToolsIgnored = extractConsensusFromTools({
    get_flow_tape: { call_volume: 999, put_volume: 1 },
    get_helix_derived: { stacked_hits: [{ side: "call" }] },
  });
  assert.equal(oldToolsIgnored.agreement.voting, 0);
});

// 2026-09-04 audit finding — regression pin. extractVectorRead used to read result.structure/
// result.bias at the TOP level (neither exists — the real field is result.play.bias) and treated
// magnet as a raw number (it is a GammaMagnet OBJECT), so every real call silently fell through
// to the hardcoded {strength:5,"neutral","Structure neutral"} default regardless of the real play.
test("extractConsensusFromTools: VECTOR reads the real play.bias/magnet.pull shape, never the invented one", () => {
  const long = extractConsensusFromTools({
    get_vector_full_state: { play: { bias: "long" }, magnet: { strike: 610, pull: "up", posture: "long" } },
  });
  assert.equal(long.reads[0]?.system, "VECTOR");
  assert.equal(long.reads[0]?.direction, "bullish");

  const short = extractConsensusFromTools({
    get_vector_full_state: { play: { bias: "short" }, magnet: { strike: 590, pull: "down", posture: "short" } },
  });
  assert.equal(short.reads[0]?.direction, "bearish");

  // Dealer gamma posture (regime.posture) must NEVER be read as direction — the identical
  // anti-pattern already fixed for THERMAL. A long-gamma regime with no play must stay neutral,
  // not be promoted to "bullish" because "long" sounds bullish.
  const regimeOnly = extractConsensusFromTools({
    get_vector_full_state: { regime: { posture: "long" }, spot: 600 },
  });
  assert.equal(regimeOnly.reads[0]?.direction, "neutral");

  // A wrong-shaped payload using the OLD (bogus) top-level fields, including magnet as a raw
  // number, must not accidentally revive the bug — no top-level structure/bias exists on the
  // real payload, and magnet-as-number must never be compared against spot again.
  const stale = extractConsensusFromTools({
    get_vector_full_state: { structure: "HH", bias: "bullish", magnet: 615, spot: 600 },
  });
  assert.equal(stale.reads[0]?.direction, "neutral", "top-level structure/bias must not be read");

  // Honest UNAVAILABLE envelope casts no vote at all.
  const unavailable = extractConsensusFromTools({
    get_vector_full_state: { available: false, reason: "no_live_vector_state" },
  });
  assert.equal(unavailable.agreement.voting, 0);

  // get_vector_pulse is NO LONGER fed through this extractor — a differential-signals payload
  // shaped to look bullish under the old reading must contribute ZERO votes.
  const pulseIgnored = extractConsensusFromTools({
    get_vector_pulse: { structure: "HH", bias: "bullish" },
  });
  assert.equal(pulseIgnored.agreement.voting, 0);
});
