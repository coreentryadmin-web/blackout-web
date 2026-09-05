import { test } from "node:test";
import assert from "node:assert/strict";
import {
  evaluateSwingCortexForCommit,
  swingCortexBlockedByFromAssessment,
} from "./cortex-swing";

test("swingCortexBlockedByFromAssessment: PASS yields no blocks", () => {
  const r = swingCortexBlockedByFromAssessment({ decision: "PASS", abstained: false, reason: "ok" });
  assert.equal(r.blocked, false);
  assert.deepEqual(r.blockedBy, []);
});

test("swingCortexBlockedByFromAssessment: VETO maps to G-S14 tokens", () => {
  const r = swingCortexBlockedByFromAssessment({
    decision: "VETO",
    abstained: false,
    verdict: {
      score: -2,
      supports: [],
      opposes: [],
      vetoes: [{ source: "gex-walls", detail: "call wall overhead" }],
      absent: [],
      thin: false,
    },
    reason: "veto",
  });
  assert.equal(r.blocked, true);
  assert.deepEqual(r.blockedBy, ["gate:G-S14:cortex_veto:gex-walls"]);
});

test("evaluateSwingCortexForCommit: injected evaluate path", async () => {
  const r = await evaluateSwingCortexForCommit("NVDA", "LONG", Date.parse("2026-09-05T12:00:00Z"), {
    evaluate: async () => ({
      decision: "VETO_BLIND",
      abstained: false,
      verdict: { score: 0, supports: [], opposes: [], vetoes: [], absent: ["gex-walls", "flow-quality"], thin: true },
      reason: "blind",
    }),
  });
  assert.equal(r.blocked, true);
  assert.ok(r.blockedBy[0]?.startsWith("gate:G-S14:"));
});
