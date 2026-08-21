import test from "node:test";
import assert from "node:assert/strict";
import { isDecline, gradeAvailability } from "./availability-verdict.mjs";

test("isDecline catches every pipeline give-up shape, plus empty", () => {
  assert.equal(isDecline("I couldn't pull enough live data to answer that — try naming a ticker or asking about SPX structure."), true);
  assert.equal(isDecline("I hit an internal error before I could finish this answer."), true);
  assert.equal(isDecline("The desk tools did not complete cleanly this turn."), true);
  assert.equal(isDecline(""), true);
  assert.equal(isDecline("   "), true);
  assert.equal(isDecline("**Verdict** SPY dealers are net short gamma, net GEX -$5.1B."), false);
});

test("DECLINED_WITH_DATA — the defect: data present, Largo declined", () => {
  const r = gradeAvailability({
    id: "spy-gamma",
    question: "posture?",
    dataPresent: true,
    proofValue: "short",
    answer: "I couldn't pull enough live data to answer that — try naming a ticker or asking about SPX structure.",
    tools: ["live_feed_capture", "platform_vitals_prefetch"],
  });
  assert.equal(r.verdict, "DECLINED_WITH_DATA");
  assert.equal(r.declined, true);
  assert.equal(r.dataPresent, true);
});

test("ANSWERED_OK — data present and Largo answered", () => {
  const r = gradeAvailability({
    id: "spy-gamma",
    question: "posture?",
    dataPresent: true,
    proofValue: "short",
    answer: "**Verdict** SPY is net short gamma; net GEX -$5.1B.",
    tools: ["get_positioning"],
  });
  assert.equal(r.verdict, "ANSWERED_OK");
  assert.equal(r.declined, false);
});

test("INDETERMINATE — a decline is NOT a defect when the data was not independently confirmed", () => {
  // Absence of evidence is not a defect: if get_positioning itself had no data, a decline is honest.
  const r = gradeAvailability({
    id: "obscure",
    question: "GNS gamma?",
    dataPresent: false,
    proofValue: null,
    answer: "I couldn't pull enough live data to answer that — try naming a ticker or asking about SPX structure.",
    tools: [],
  });
  assert.equal(r.verdict, "INDETERMINATE");
});

test("tools defaults to an array even when omitted", () => {
  const r = gradeAvailability({ id: "x", question: "q", dataPresent: true, answer: "ok" });
  assert.deepEqual(r.tools, []);
});
