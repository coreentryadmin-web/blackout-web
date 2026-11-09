import assert from "node:assert/strict";
import test from "node:test";
import {
  anyDiscoveryLaneFetchFailed,
  engineStalledRecapReason,
  failedDiscoveryLaneNames,
  formatEditionFunnelSummary,
  funnelFromMeta,
  publishGateBlockedRecapReason,
  recapReasonAtPublishExit,
  synthesisEmptyRecapReason,
  zeroCandidatesRecapReason,
  type DiscoveryLaneFetchFailures,
  type ZeroDteScanHeartbeatLike,
} from "./edition-funnel";

test("synthesisEmptyRecapReason names synthesis, not gates, when blocked list is empty", () => {
  const reason = synthesisEmptyRecapReason({
    candidates: 12,
    ranked: 8,
    dossiers: 6,
    synthesized: 0,
    critic_passed: 0,
    published: 0,
  });
  assert.match(reason, /Synthesis produced zero plays before publish gates/);
  assert.match(reason, /synthesized=0/);
  assert.doesNotMatch(reason, /Publish gates blocked all 0 play/);
});

test("recapReasonAtPublishExit uses gate wording when plays were blocked", () => {
  const reason = recapReasonAtPublishExit(
    [{ ticker: "FIVN", result: { blocks: [{ code: "target_unreachable" }] } }],
    { candidates: 10, ranked: 5, dossiers: 5, synthesized: 5, critic_passed: 5, published: 0 }
  );
  assert.match(reason, /Publish gates blocked all 1 play/);
  assert.match(reason, /FIVN: target_unreachable/);
});

test("recapReasonAtPublishExit uses synthesis wording when blocked is empty", () => {
  const reason = recapReasonAtPublishExit([], {
    candidates: 10,
    ranked: 5,
    dossiers: 5,
    synthesized: 0,
    critic_passed: 0,
    published: 0,
  });
  assert.match(reason, /Synthesis produced zero plays before publish gates/);
});

test("funnelFromMeta reads meta.funnel for member API", () => {
  const f = funnelFromMeta({
    funnel: {
      candidates: 12,
      ranked: 8,
      dossiers: 6,
      synthesized: 0,
      critic_passed: 0,
      published: 0,
      grounded: 0,
      dropped_ungrounded: 0,
    },
  });
  assert.equal(f?.candidates, 12);
  assert.equal(f?.synthesized, 0);
});

test("formatEditionFunnelSummary uses ? for missing counts", () => {
  assert.match(formatEditionFunnelSummary({ candidates: 1 }), /grounded=\?/);
});

// --- NH-R10: engine_stalled recap classification -----------------------------

const FRESH_HEARTBEAT: ZeroDteScanHeartbeatLike = {
  stale: false,
  critical_stale: false,
  age_ms: 30_000,
};

const STALE_HEARTBEAT: ZeroDteScanHeartbeatLike = {
  stale: true,
  critical_stale: false,
  age_ms: 6 * 60_000,
};

const CRITICAL_STALE_HEARTBEAT: ZeroDteScanHeartbeatLike = {
  stale: true,
  critical_stale: true,
  age_ms: 11 * 60_000,
};

test("engineStalledRecapReason names the stalled scan and its age", () => {
  const reason = engineStalledRecapReason(STALE_HEARTBEAT);
  assert.match(reason, /0DTE scan heartbeat is stale/);
  assert.match(reason, /360s ago/);
});

test("engineStalledRecapReason escalates wording when critical_stale", () => {
  const reason = engineStalledRecapReason(CRITICAL_STALE_HEARTBEAT);
  assert.match(reason, /CRITICAL/);
});

test("recapReasonAtPublishExit prefers engine_stalled over synthesis-empty when heartbeat is stale + board empty", () => {
  const reason = recapReasonAtPublishExit(
    [],
    { candidates: 0, ranked: 0, dossiers: 0, synthesized: 0, critic_passed: 0, published: 0 },
    STALE_HEARTBEAT
  );
  assert.match(reason, /0DTE scan heartbeat is stale/);
  assert.doesNotMatch(reason, /Synthesis produced zero plays/);
});

test("recapReasonAtPublishExit prefers engine_stalled over gate-blocked when heartbeat is critical_stale", () => {
  const reason = recapReasonAtPublishExit(
    [{ ticker: "FIVN", result: { blocks: [{ code: "target_unreachable" }] } }],
    { candidates: 10, ranked: 5, dossiers: 5, synthesized: 5, critic_passed: 5, published: 0 },
    CRITICAL_STALE_HEARTBEAT
  );
  assert.match(reason, /CRITICAL/);
  assert.doesNotMatch(reason, /Publish gates blocked all/);
});

test("recapReasonAtPublishExit does NOT trigger engine_stalled when heartbeat is fresh + board legitimately empty", () => {
  const reason = recapReasonAtPublishExit(
    [],
    { candidates: 12, ranked: 8, dossiers: 6, synthesized: 0, critic_passed: 0, published: 0 },
    FRESH_HEARTBEAT
  );
  assert.match(reason, /Synthesis produced zero plays before publish gates/);
  assert.doesNotMatch(reason, /0DTE scan heartbeat/);
});

test("recapReasonAtPublishExit is unchanged when heartbeat is omitted (existing callers)", () => {
  const reason = recapReasonAtPublishExit([], {
    candidates: 12,
    ranked: 8,
    dossiers: 6,
    synthesized: 0,
    critic_passed: 0,
    published: 0,
  });
  assert.match(reason, /Synthesis produced zero plays before publish gates/);
});

test("recapReasonAtPublishExit is unchanged when heartbeat read failed (null)", () => {
  const reason = recapReasonAtPublishExit(
    [{ ticker: "FIVN", result: { blocks: [{ code: "target_unreachable" }] } }],
    { candidates: 10, ranked: 5, dossiers: 5, synthesized: 5, critic_passed: 5, published: 0 },
    null
  );
  assert.match(reason, /Publish gates blocked all 1 play/);
});

// --- Audit finding (2026-11-09): 6-of-7-discovery-lanes-unmonitored recap-only gap -----------
//
// `alertRecapOnlyIfAnomalous` (edition-builder.ts) previously went `benign` (no ops alert) on a
// zero-candidate night as long as the FLOW lane's own fetch hadn't thrown — even when one of the
// other 6 lanes (oi_change, unusual_trades, catalyst, predictions, movers, breakout) had a real
// provider outage. These tests cover the pure decision logic the fix now runs on.

const ALL_LANES_OK: DiscoveryLaneFetchFailures = {
  flow_fetch_failed: false,
  oi_change_fetch_failed: false,
  unusual_trades_fetch_failed: false,
  catalyst_fetch_failed: false,
  predictions_fetch_failed: false,
  movers_fetch_failed: false,
  breakout_fetch_failed: false,
};

test("anyDiscoveryLaneFetchFailed is false when every lane's fetch genuinely succeeded (honest quiet night)", () => {
  assert.equal(anyDiscoveryLaneFetchFailed(ALL_LANES_OK), false);
  assert.equal(anyDiscoveryLaneFetchFailed(undefined), false);
  assert.equal(anyDiscoveryLaneFetchFailed(null), false);
  assert.equal(anyDiscoveryLaneFetchFailed({}), false);
});

test("anyDiscoveryLaneFetchFailed is true when the flow lane's fetch failed (pre-existing behavior preserved)", () => {
  assert.equal(anyDiscoveryLaneFetchFailed({ ...ALL_LANES_OK, flow_fetch_failed: true }), true);
});

// This is the core regression: each of the 6 PREVIOUSLY-unmonitored lanes, failing ALONE with
// flow succeeding, must now flip the verdict to non-benign (an ops alert fires).
for (const lane of [
  "oi_change_fetch_failed",
  "unusual_trades_fetch_failed",
  "catalyst_fetch_failed",
  "predictions_fetch_failed",
  "movers_fetch_failed",
  "breakout_fetch_failed",
] as const) {
  test(`anyDiscoveryLaneFetchFailed is true when ONLY ${lane} fails (flow itself succeeding)`, () => {
    const flags: DiscoveryLaneFetchFailures = { ...ALL_LANES_OK, [lane]: true };
    assert.equal(
      anyDiscoveryLaneFetchFailed(flags),
      true,
      `${lane} failing alone must make a zero-candidate night non-benign`
    );
  });
}

test("failedDiscoveryLaneNames names every failed lane and omits healthy ones", () => {
  const flags: DiscoveryLaneFetchFailures = {
    ...ALL_LANES_OK,
    catalyst_fetch_failed: true,
    movers_fetch_failed: true,
  };
  assert.deepEqual(failedDiscoveryLaneNames(flags), ["catalyst", "movers"]);
});

test("failedDiscoveryLaneNames is empty when nothing failed or flags are absent", () => {
  assert.deepEqual(failedDiscoveryLaneNames(ALL_LANES_OK), []);
  assert.deepEqual(failedDiscoveryLaneNames(undefined), []);
});

test("zeroCandidatesRecapReason names all 7 discovery lanes' counts, not just 4", () => {
  const reason = zeroCandidatesRecapReason({
    flows: 0,
    oi: 0,
    unusual: 0,
    catalyst: 3,
    predictions: 2,
    movers: 0,
    breakout: 1,
  });
  assert.match(reason, /flows 0/);
  assert.match(reason, /OI 0/);
  assert.match(reason, /unusual 0/);
  assert.match(reason, /catalyst 3/);
  assert.match(reason, /predictions 2/);
  assert.match(reason, /movers 0/);
  assert.match(reason, /breakout 1/);
});

// --- Audit finding (2026-11-09, narrower follow-up to #7745): reason text never disclosed a
// lane's own fetch failure, even though #7745 already computed and alerted ops on exactly those
// flags. These cover `zeroCandidatesRecapReason`'s new optional `failures` parameter — the
// MEMBER/LARGO-FACING string, not the internal ops alert #7745 already fixed.

const ZERO_COUNTS = {
  flows: 0,
  oi: 0,
  unusual: 0,
  catalyst: 0,
  predictions: 0,
  movers: 0,
  breakout: 0,
};

test("zeroCandidatesRecapReason is byte-identical to the no-failures case when every lane genuinely returned zero", () => {
  const withoutFailuresArg = zeroCandidatesRecapReason(ZERO_COUNTS);
  const withAllFalseFlags = zeroCandidatesRecapReason(ZERO_COUNTS, ALL_LANES_OK);
  const withNullFlags = zeroCandidatesRecapReason(ZERO_COUNTS, null);
  assert.equal(
    withoutFailuresArg,
    "No candidates from any source (flows 0, OI 0, unusual 0, catalyst 0, predictions 0, movers 0, breakout 0)."
  );
  assert.equal(withAllFalseFlags, withoutFailuresArg);
  assert.equal(withNullFlags, withoutFailuresArg);
  assert.doesNotMatch(withoutFailuresArg, /could not be fetched/);
});

test("zeroCandidatesRecapReason appends a disclosure clause naming the one lane that failed", () => {
  const reason = zeroCandidatesRecapReason(
    { ...ZERO_COUNTS, movers: 0 },
    { ...ALL_LANES_OK, movers_fetch_failed: true }
  );
  assert.match(reason, /^No candidates from any source \(flows 0, OI 0, unusual 0, catalyst 0, predictions 0, movers 0, breakout 0\)\./);
  assert.match(reason, /Note: movers data could not be fetched \(upstream provider error\)/);
  assert.match(reason, /this count reflects a fetch failure, not a confirmed absence\./);
  // Singular wording only — must not also carry the plural "these counts"/"absences" phrasing.
  assert.doesNotMatch(reason, /these counts reflect fetch failures/);
  assert.doesNotMatch(reason, /absences/);
});

test("zeroCandidatesRecapReason names every failed lane when multiple fail, with plural wording", () => {
  const reason = zeroCandidatesRecapReason(ZERO_COUNTS, {
    ...ALL_LANES_OK,
    catalyst_fetch_failed: true,
    movers_fetch_failed: true,
  });
  assert.match(reason, /Note: catalyst, movers data could not be fetched \(upstream provider error\)/);
  assert.match(reason, /these counts reflect fetch failures, not confirmed absences\./);
});

test("zeroCandidatesRecapReason uses the OI/unusual display names, not the raw oi_change/unusual_trades flag names", () => {
  const reason = zeroCandidatesRecapReason(ZERO_COUNTS, {
    ...ALL_LANES_OK,
    oi_change_fetch_failed: true,
    unusual_trades_fetch_failed: true,
  });
  assert.match(reason, /Note: OI, unusual data could not be fetched/);
  assert.doesNotMatch(reason, /oi_change/);
  assert.doesNotMatch(reason, /unusual_trades/);
});
