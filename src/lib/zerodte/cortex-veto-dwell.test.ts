import { test } from "node:test";
import assert from "node:assert/strict";
import { baseInputs } from "@/lib/nighthawk/cortex/test-helpers";
import { composeCortexEvidence } from "@/lib/nighthawk/cortex";
import { applyCortexVetoDwellPure } from "./cortex-veto-dwell";
import { assessCortexVerdict } from "./cortex-gate";

test("applyCortexVetoDwellPure latches veto then holds for clearPasses", () => {
  const inputs = baseInputs({ ticker: "QQQ", direction: "short", now: "2026-07-13T14:20:00.000Z" });
  const verdict = composeCortexEvidence(inputs);
  const veto = assessCortexVerdict({
    ...verdict,
    vetoes: [
      {
        source: "flow-quality",
        detail: "opposing whales",
        weight: 1,
        kind: "veto",
      },
    ],
    supports: [],
    opposes: [],
    score: -1,
  });
  assert.equal(veto.decision, "VETO");

  const passVerdict = composeCortexEvidence(inputs);
  const pass = assessCortexVerdict({
    ...passVerdict,
    supports: [{ source: "gex-walls", detail: "supports", weight: 1.2, kind: "support" }],
    opposes: [],
    score: 1.2,
    absent: [],
  });
  assert.equal(pass.decision, "PASS");

  const first = applyCortexVetoDwellPure(veto, null, 3);
  assert.equal(first.assessment.decision, "VETO");
  assert.equal(first.next?.latched, true);

  const second = applyCortexVetoDwellPure(pass, first.next, 3);
  assert.equal(second.assessment.decision, "VETO");
  assert.equal(second.next?.passes_since_clear, 1);

  const third = applyCortexVetoDwellPure(pass, second.next, 3);
  assert.equal(third.assessment.decision, "VETO");
  assert.equal(third.next?.passes_since_clear, 2);

  const fourth = applyCortexVetoDwellPure(pass, third.next, 3);
  assert.equal(fourth.assessment.decision, "PASS");
  assert.equal(fourth.next?.latched, false);
});

test("applyCortexVetoDwellPure no-op when clearPasses is 0", () => {
  const pass = { decision: "PASS" as const, abstained: false, verdict: composeCortexEvidence(baseInputs({ ticker: "SPY", direction: "long" })) };
  const out = applyCortexVetoDwellPure(pass, null, 0);
  assert.equal(out.assessment.decision, "PASS");
});
