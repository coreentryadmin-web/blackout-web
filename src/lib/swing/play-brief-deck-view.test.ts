import test from "node:test";
import assert from "node:assert/strict";
import { makeEnvelope } from "@/lib/bie/answer-envelope";
import { envelopeForSwingDeckBrief } from "./play-brief-deck-view";

test("envelopeForSwingDeckBrief: drops verdict chrome and duplicate open sections", () => {
  const env = makeEnvelope({
    headline: "HOLD — CG 50P 12DTE",
    bias: "bearish",
    confidence: { level: "high", why: "Deterministic synthesis — no LLM." },
    sections: [
      { title: "Verdict", body: "Grade C · score 3" },
      { title: "Management", body: "Recommended: HOLD" },
      { title: "Thesis health", body: "46%" },
      { title: "Position", body: "Entry $1.00" },
      { title: "Trade manager read", body: "• Hold the line" },
    ],
  });
  const out = envelopeForSwingDeckBrief(env);
  assert.equal(out.headline, "");
  assert.equal(out.confidence, undefined);
  assert.deepEqual(out.sections.map((s) => s.title), ["Trade manager read"]);
});
