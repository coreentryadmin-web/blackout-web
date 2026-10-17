import assert from "node:assert/strict";
import test from "node:test";
import {
  parseAnswerEnvelope,
  fallbackAnswerEnvelope,
  validateAnswerContract,
} from "./answer-contract.ts";

const SAMPLE = `
**Verdict** — SPX is pinned below the call wall, neutral-bearish.

**Facts**
SPX spot 7748.2 (+0.1%) (index snapshot · live)
Put wall 8000 with heavy dealer gamma above spot.

**Data**
All reads live and complete.
`.trim();

test("parseAnswerEnvelope builds envelope from prose Facts lines (no bullet prefix)", () => {
  const env = parseAnswerEnvelope(SAMPLE);
  assert.ok(env, "expected envelope");
  assert.match(env!.headline ?? "", /SPX/i);
  assert.ok((env!.evidence?.length ?? 0) >= 1);
});

test("fallbackAnswerEnvelope wraps unstructured markdown", () => {
  const env = fallbackAnswerEnvelope("**Verdict** — Quick read.\n\n**Data**\nLive.");
  assert.ok(env);
  assert.ok((env!.sections?.length ?? 0) >= 1);
});

test("validateAnswerContract accepts Bottom line as satisfying the Verdict requirement, matching parseAnswerEnvelope's own promotion", () => {
  // Live 2026-10-17: a refusal/off-topic answer ("write my tax return") that Largo correctly wrote
  // with only a **Bottom line** heading (no **Verdict**) built a working envelope via
  // parseAnswerEnvelope's own `if (!verdict) verdict = get("Bottom line")` promotion — the member
  // saw a normal answer. The separate validateAnswerContract pass has no such promotion, so it
  // logged a false "[largo] answer-contract miss — missing: Verdict,Data" on an answer that was
  // never actually missing a verdict — corrupting the exact drift telemetry this contract exists to
  // produce (see the file's own "measured from evidence, not guesswork" rationale).
  const md = `
**Bottom line** — That's outside what this desk can help with; try a licensed tax preparer.

**Data**
No market data applies to this question.
`.trim();
  const report = validateAnswerContract(md);
  assert.ok(!report.missing.includes("Verdict"), `expected Verdict not to be reported missing, got: ${report.missing.join(",")}`);
  // Sanity: fallbackAnswerEnvelope already promotes Bottom line to the verdict today (its own
  // `sections.get("verdict") ?? sections.get("bottom line")`) — the one other place in this module
  // that already treats the two as equivalent. The fix brings the validator in line with that
  // existing precedent rather than inventing a new rule.
  const env = fallbackAnswerEnvelope(md);
  assert.ok(env, "expected fallbackAnswerEnvelope to still build an envelope from Bottom line alone");
  assert.match(env!.headline ?? "", /outside what this desk can help/i);
});

test("parseAnswerEnvelope accepts **Verdict:** colon-inside-bold headings", () => {
  const md = `
**Verdict:** SPX is range-bound below the flip.

**Facts**
- [fact] SPX spot 7748.5 (index snapshot · live)

**Data**
All reads live and complete.
`.trim();
  const env = parseAnswerEnvelope(md);
  assert.ok(env);
  assert.match(env!.headline ?? "", /range-bound/i);
});
