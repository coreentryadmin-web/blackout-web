// Pure decision helper extracted from largo-verifier.ts, which imports "server-only" transitively
// (via @/lib/correctness/types's value imports) and so cannot be imported directly in a test — see
// CLAUDE.md's "server-only" testing note. This file has NO runtime import of types.ts (the
// `CheckOutcome` reference below is `import type`, which TypeScript erases entirely, so loading
// this module never executes types.ts's `import "server-only"`), so it is safe to unit test.
import type { CheckOutcome } from "@/lib/correctness/types";

/**
 * Outcome for the Largo answer-grounding sweep check (verifyLargo's "shadow-recompute" /
 * "answer_grounding" check).
 *
 * BUG FIX (round 490, 2026-11-09): the inline logic this replaces was
 * `skippedNoContext > 0 && totalAnswers === skippedNoContext ? "consistency-only" : "pass"` —
 * i.e. it returned `"pass"` whenever at least one sampled answer had real tool-result context and
 * none were flagged, even on a run where EVERY answer had context (`skippedNoContext === 0`).
 *
 * That is the wrong outcome. Per this verifier family's own documented contract
 * (`types.ts`: `"pass"` = "every applicable check held AND a second independent source confirmed
 * it"), `"pass"` is reserved for a metric a second independent oracle actually confirmed.
 * Largo's numeric-grounding check has no such oracle: `auditLargoAnswerGrounding` checks a claim
 * in the answer against the SAME `tool_results` row the answer itself was generated from — a
 * self-consistency check, not a second source. Every sibling verifier in this directory that
 * emits `"pass"` pairs it with `independentlyConfirmed: true` keyed off a REAL second source
 * (nighthawk-verifier.ts's live-chain confirmation, the UW GEX cross-provider oracle, a 2nd
 * Polygon index snapshot in market-context-verifier.ts, ...) — this was the only `"pass"` outcome
 * in `src/lib/correctness/**` with no `independentlyConfirmed` set alongside it.
 *
 * Because `rollUpMetricStatus` (types.ts) only reads `independentlyConfirmed` (never the raw
 * per-check `outcome` string) when it decides the METRIC-level status, the final scorecard status
 * for this metric was never wrong — it was already demoted to "consistency-only" at that layer.
 * But `renderScorecardMarkdown` (run-correctness.ts) prints every individual `CheckResult`'s raw
 * `outcome` verbatim in its per-check detail list ("`- \`layer\` **metric** [outcome] — detail`"),
 * so a reader of the markdown report saw a literal `[pass]` line claiming an independent
 * confirmation that never happened — the exact "false green" this module's own header comment in
 * largo-verifier.ts (and types.ts's HONESTY PRINCIPLE) says must never occur.
 */
export function largoGroundingSweepOutcome(
  flaggedCount: number,
  skippedNoContext: number,
  totalAnswers: number
): CheckOutcome {
  if (flaggedCount > 0) return "flag";
  if (skippedNoContext > 0 && totalAnswers === skippedNoContext) {
    // Every sampled answer lacked numeric tool context — nothing was checkable either way.
    return "consistency-only";
  }
  // No second independent source exists for Largo numeric grounding (see doc comment above) —
  // a clean sweep is consistency-only, never "pass".
  return "consistency-only";
}
