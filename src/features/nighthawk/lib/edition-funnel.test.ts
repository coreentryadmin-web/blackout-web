import assert from "node:assert/strict";
import test from "node:test";
import {
  formatEditionFunnelSummary,
  funnelFromMeta,
  publishGateBlockedRecapReason,
  recapReasonAtPublishExit,
  synthesisEmptyRecapReason,
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
