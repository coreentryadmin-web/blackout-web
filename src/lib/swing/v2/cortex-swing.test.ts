import { test } from "node:test";
import assert from "node:assert/strict";
import { baseInputs } from "@/lib/nighthawk/cortex/test-helpers";
import { composeCortexEvidence } from "@/lib/nighthawk/cortex";
import {
  evaluateSwingCortexForCommit,
  swingCortexBlockedByFromAssessment,
  swingCortexUnavailableResult,
  SWING_CORTEX_UNAVAILABLE_TOKEN,
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

test("evaluateSwingCortexForCommit: thrown error fails closed with cortex_unavailable", async () => {
  const r = await evaluateSwingCortexForCommit("NVDA", "LONG", Date.parse("2026-09-05T12:00:00Z"), {
    evaluate: async () => {
      throw new Error("vector timeout");
    },
  });
  assert.equal(r.blocked, true);
  assert.deepEqual(r.blockedBy, [SWING_CORTEX_UNAVAILABLE_TOKEN]);
  assert.match(r.reason, /vector timeout/);
});

test("evaluateSwingCortexForCommit: thrown error is logged, not silently swallowed", async () => {
  // Regression: the catch block previously returned a fail-closed block with zero
  // console trace. A production throw (upstream timeout, malformed response, etc.)
  // must be observable in CloudWatch — matching the sibling catch in
  // v2/tier0-origin-fetch.ts, which already console.warns on the same failure class.
  const warnCalls: unknown[][] = [];
  const originalWarn = console.warn;
  console.warn = (...args: unknown[]) => {
    warnCalls.push(args);
  };
  try {
    await evaluateSwingCortexForCommit("NVDA", "LONG", Date.parse("2026-09-05T12:00:00Z"), {
      evaluate: async () => {
        throw new Error("vector timeout");
      },
    });
  } finally {
    console.warn = originalWarn;
  }
  assert.equal(warnCalls.length, 1, "expected exactly one console.warn on thrown preflight error");
  const [message, loggedErr] = warnCalls[0]!;
  assert.match(String(message), /swing-cortex/i);
  assert.match(String(message), /NVDA/);
  assert.ok(loggedErr instanceof Error && loggedErr.message === "vector timeout");
});

test("swingCortexUnavailableResult: maps to G-S14 unavailable token", () => {
  const r = swingCortexUnavailableResult("provider down");
  assert.equal(r.blocked, true);
  assert.deepEqual(r.blockedBy, [SWING_CORTEX_UNAVAILABLE_TOKEN]);
});
