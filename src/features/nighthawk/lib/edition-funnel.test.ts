import assert from "node:assert/strict";
import test from "node:test";
import {
  engineStalledRecapReason,
  formatEditionFunnelSummary,
  funnelFromMeta,
  publishGateBlockedRecapReason,
  recapReasonAtPublishExit,
  synthesisEmptyRecapReason,
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
