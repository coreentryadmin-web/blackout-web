import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { formatDepthBlock, largoDepthConfig } from "./largo-depth";

/**
 * Concrete mode has to WIN against the section contract, or it does nothing at all.
 *
 * The system prompt carries no notion of answer mode and states, unconditionally, that "Verdict and
 * Data are required on every answer, however short", on top of an eight-section contract. The
 * Concrete block used to say only "no section headers" — a small quiet instruction against a large
 * emphatic one, with nothing declaring which wins. The model followed the system prompt, which is
 * the correct thing to do with two conflicting instructions and no stated precedence.
 *
 * Measured on prod across 44 scenarios (2026-08-20):
 *
 *     Concrete  median 5,650 chars   max 6,883
 *     Deep dive median 4,960 chars   max 8,186
 *
 * Concrete answers were LONGER than Deep dive ones. The mode shipped inert, and every reply came
 * back with **Verdict:** / **Facts:** / **Interpretation:** / **Bottom line:** headings — the exact
 * shape Concrete exists to remove.
 *
 * These tests pin the two properties that made it inert: the block must claim precedence, and it
 * must name the headings it suppresses. A block that merely says "be brief" is what was already
 * there and is not enough.
 */

const CONCRETE = formatDepthBlock("concrete");
const DEEP = formatDepthBlock("deep");

/** The eight sections the system prompt mandates. */
const SECTIONS = [
  "Verdict",
  "Facts",
  "Interpretation",
  "Confidence",
  "Conflicts",
  "Risk",
  "Data",
  "Bottom line",
];

test("REGRESSION: the Concrete block declares that it overrides the section contract", () => {
  // Without an explicit precedence claim the model has no basis to prefer this over the longer,
  // more emphatic system-prompt contract — which is exactly what happened in production.
  assert.match(
    CONCRETE,
    /overrides?\b[\s\S]{0,80}section contract|section contract[\s\S]{0,80}does NOT apply/i,
    "Concrete must say, in words, that it supersedes the section contract"
  );
});

test("REGRESSION: the Concrete block names the headings it suppresses", () => {
  // "No section headers" is what shipped and was ignored. Naming them is the difference between a
  // vague style note and an instruction the model can act on.
  const named = SECTIONS.filter((s) => CONCRETE.includes(s));
  assert.ok(
    named.length >= 6,
    `Concrete should name the sections it suppresses; it names only: ${named.join(", ") || "(none)"}`
  );
});

test("Concrete states a measurable length target, not just 'tight'", () => {
  // The failure was a mode with no number in it. "Tight" is unfalsifiable; a ceiling is not.
  assert.match(CONCRETE, /\d{3,4}\s*characters?|\d{1,2},\d{3}/, "Concrete must state a character target/ceiling");
});

test("Concrete keeps the data-honesty guarantee, and only drops its heading", () => {
  // The system prompt is right that a silent omission is undetectable by the member. Concrete is
  // allowed to remove the HEADING; it must not remove the disclosure.
  assert.match(
    CONCRETE,
    /\b(stale|missing|unavailable)\b/i,
    "Concrete must still require disclosing stale/missing/unavailable reads"
  );
  // Whitespace-tolerant: the prompt is a wrapped template literal, so "Never omit it" and
  // "silently" can land on different lines. A literal-space regex fails on formatting, not on
  // meaning — which is a test that breaks when someone re-wraps a paragraph.
  assert.match(
    CONCRETE,
    /never\s+omit\s+it\s+silently/i,
    "the non-omission rule must survive the collapse"
  );
});

test("Deep dive is unchanged in kind — it still asks for a structured breakdown", () => {
  assert.match(DEEP, /Deep dive/);
  assert.match(DEEP, /verdict|structure|flow|conflicts|invalidation/i);
  // Deep must NOT claim to override the contract; it is the mode the contract was written for.
  assert.doesNotMatch(DEEP, /does NOT apply/i);
});

test("the two modes remain distinguishable in model and loop budget", () => {
  const c = largoDepthConfig("concrete");
  const d = largoDepthConfig("deep");
  assert.match(c.model, /haiku/i, "Concrete runs the fast model");
  assert.notEqual(c.model, d.model, "the modes must not collapse onto one model");
  assert.ok(c.maxRounds < d.maxRounds, "Concrete must run a tighter tool loop than Deep dive");
  assert.ok(c.maxTokens <= d.maxTokens, "Concrete must not be allowed a larger output budget than Deep dive");
});

test("the system prompt still carries the honesty rule Concrete defers to", () => {
  // If this ever moves, the Concrete block's inline-disclosure wording needs to move with it —
  // this test exists so that coupling is visible rather than discovered in production.
  const sys = readFileSync(join(process.cwd(), "src/lib/largo/system-prompt.ts"), "utf8");
  assert.match(sys, /silent omission/i, "system prompt should still state the non-omission guarantee");
});
