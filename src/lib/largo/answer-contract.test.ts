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
