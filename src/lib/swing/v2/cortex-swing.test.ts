import { test } from "node:test";
import assert from "node:assert/strict";
import { baseInputs } from "@/lib/nighthawk/cortex/test-helpers";
import { composeCortexEvidence } from "@/lib/nighthawk/cortex";
import {
  evaluateSwingCortexForCommit,
  swingCortexBlockedByFromAssessment,
} from "./cortex-swing";

test("swingCortexBlockedByFromAssessment: PASS yields no blocks", () => {
  const r = swingCortexBlockedByFromAssessment({
    decision: "PASS",
    abstained: false,
    verdict: composeCortexEvidence(baseInputs({ ticker: "NVDA", direction: "long" })),
  });
  assert.equal(r.blocked, false);
  assert.deepEqual(r.blockedBy, []);
});

test("swingCortexBlockedByFromAssessment: VETO maps to G-S14 tokens", () => {
  const r = swingCortexBlockedByFromAssessment({
    decision: "VETO",
    abstained: false,
    verdict: {
      ...composeCortexEvidence(baseInputs({ ticker: "NVDA", direction: "long" })),
      score: -2,
      supports: [],
      opposes: [],
      vetoes: [{ source: "gex-walls", detail: "call wall overhead", weight: 1, kind: "veto" }],
      absent: [],
    },
  });
  assert.equal(r.blocked, true);
  assert.deepEqual(r.blockedBy, ["gate:G-S14:cortex_veto:gex-walls"]);
});

test("evaluateSwingCortexForCommit: injected evaluate path", async () => {
  const r = await evaluateSwingCortexForCommit("NVDA", "LONG", Date.parse("2026-09-05T12:00:00Z"), {
    evaluate: async () => ({
      decision: "VETO_BLIND",
      abstained: false,
      verdict: composeCortexEvidence(baseInputs({ ticker: "NVDA", direction: "long" })),
      reason: "blind",
    }),
  });
  assert.equal(r.blocked, true);
  assert.ok(r.blockedBy[0]?.startsWith("gate:G-S14:"));
});
