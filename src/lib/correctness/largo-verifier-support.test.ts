import { test } from "node:test";
import assert from "node:assert/strict";

import { largoGroundingSweepOutcome } from "@/lib/correctness/largo-verifier-support";

// BUG FIX (round 490, 2026-11-09): verifyLargo's clean-sweep branch used to compute its outcome as
// `skippedNoContext > 0 && totalAnswers === skippedNoContext ? "consistency-only" : "pass"` — i.e.
// "pass" whenever at least one sampled answer had usable tool-result context and none were
// flagged, even when EVERY answer had context (skippedNoContext === 0). Largo's numeric-grounding
// check has no second independent source (it checks a claim against the SAME tool_results the
// answer itself was generated from), so per this verifier family's own contract (types.ts:
// "pass" = a second independent source confirmed it) that "pass" was never earned — it was the
// only "pass" outcome in src/lib/correctness/** with no `independentlyConfirmed` set alongside
// it, and it rendered a misleading "[pass]" line in renderScorecardMarkdown's per-check dump.

test("largoGroundingSweepOutcome: a clean sweep with full context is consistency-only, never pass", () => {
  // This is the exact previously-buggy case: nothing flagged, nothing skipped for missing
  // context — every answer was fully checkable. The old inline ternary returned "pass" here.
  const outcome = largoGroundingSweepOutcome(0, 0, 50);
  assert.equal(outcome, "consistency-only");
  assert.notEqual(outcome, "pass");
});

test("largoGroundingSweepOutcome: a clean sweep with PARTIAL context is consistency-only, never pass", () => {
  // Also previously buggy: some answers lacked context but at least one was checked and passed.
  const outcome = largoGroundingSweepOutcome(0, 12, 50);
  assert.equal(outcome, "consistency-only");
  assert.notEqual(outcome, "pass");
});

test("largoGroundingSweepOutcome: every answer lacking context is consistency-only (unchanged behavior)", () => {
  const outcome = largoGroundingSweepOutcome(0, 50, 50);
  assert.equal(outcome, "consistency-only");
});

test("largoGroundingSweepOutcome: any flagged answer is a flag, regardless of context counts", () => {
  assert.equal(largoGroundingSweepOutcome(1, 0, 50), "flag");
  assert.equal(largoGroundingSweepOutcome(3, 10, 50), "flag");
  assert.equal(largoGroundingSweepOutcome(50, 50, 50), "flag");
});

test("largoGroundingSweepOutcome: never returns 'pass' — no independent oracle exists for this metric", () => {
  // Exhaustive-ish sweep over plausible inputs: this check has no second source today, so "pass"
  // (which per types.ts means an independent source confirmed it) must never be returned.
  for (let flagged = 0; flagged <= 2; flagged++) {
    for (let skipped = 0; skipped <= 50; skipped += 10) {
      for (const total of [0, 1, 25, 50]) {
        if (skipped > total) continue;
        assert.notEqual(largoGroundingSweepOutcome(flagged, skipped, total), "pass");
      }
    }
  }
});
