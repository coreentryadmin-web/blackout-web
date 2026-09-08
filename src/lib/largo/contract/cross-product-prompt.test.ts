import { test } from "node:test";
import assert from "node:assert/strict";

import { LARGO_SYSTEM_PROMPT } from "@/lib/largo/system-prompt";

/**
 * Pins the cross-product routing rule in the system prompt.
 *
 * WHY PIN A PROMPT. Two defects tonight came from prompt rules that could not fire: one was filed
 * under a heading that scoped it away, and one was overridden by a later instruction. A registered
 * tool the model is never told to reach for is the same failure in a different place — the
 * integration would be complete in code and absent in behaviour, which is the hardest kind of gap
 * to notice because nothing errors.
 */

const PROMPT = String(LARGO_SYSTEM_PROMPT);

test("the prompt names the cross-product tool, so a registered tool is actually reachable", () => {
  assert.ok(PROMPT.includes("get_cross_product_read"), "the tool must be named in the prompt");
});

test("it is a non-negotiable, not a formatting note", () => {
  // A rule filed under '### Formatting' never applied to anything — that is a real defect this
  // repo shipped. Scope is carried by the heading, so the heading is load-bearing.
  const heading = PROMPT.split("\n").find((l) => l.includes("Cross-product questions"));
  assert.ok(heading, "the rule must have its own heading");
  assert.match(String(heading), /^## /, "must be a top-level section, not nested under another");
  assert.match(String(heading), /non-negotiable/i);
});

test("the three verdicts each carry their instruction", () => {
  for (const verdict of ["split", "aligned", "insufficient"]) {
    assert.ok(PROMPT.includes(verdict), `verdict '${verdict}' must be named`);
  }
  // The single most important behaviour: a split is REPORTED, never resolved.
  assert.match(PROMPT, /NEVER resolve a split|Do not resolve it/);
  assert.match(PROMPT, /do not pick a side/i);
  // Majority must not be presented as the answer — the lone dissenter is often the finding.
  assert.match(PROMPT, /larger camp/i);
});

test("agreement must be stated with its coverage", () => {
  assert.match(PROMPT, /Two products agree.*six products\s*\n?\s*agree|coverage/is);
  assert.ok(PROMPT.includes("coverage"), "the model must be told to use the coverage field");
});

test("a deliberate abstention must not be reported as an outage", () => {
  // Thermal casts no directional vote by design (dealer gamma is not directional). Without this
  // line the model reads its absence from `camps` as missing data and reports a fault that is
  // not one.
  assert.match(PROMPT, /Thermal deliberately casts no\s*\n?\s*directional vote/i);
  assert.match(PROMPT, /never report a deliberate abstention as an outage/i);
});

test("the model is told NOT to hand-assemble a cross-product answer", () => {
  // The failure this prevents: calling five tools and reconciling them in prose is exactly where a
  // disagreement gets smoothed away without anyone deciding to smooth it.
  assert.match(PROMPT, /Do not assemble a\s*\n?\s*cross-product answer/i);
});
