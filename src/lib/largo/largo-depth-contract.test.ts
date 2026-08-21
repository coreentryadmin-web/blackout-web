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

test("Concrete forbids bullets, tables and bold inline labels — not just headings", () => {
  // "No section headers" was satisfiable by emitting the same eight sections as **bold labels**,
  // which is what production actually returned. The ban has to name every form.
  assert.match(CONCRETE, /no bullet lists?/i, "bullets must be forbidden");
  assert.match(CONCRETE, /no tables?/i, "tables must be forbidden");
  assert.match(CONCRETE, /bold inline labels?/i, "bold inline labels must be forbidden too");
  assert.match(CONCRETE, /prose only/i, "must positively specify prose");
});

test("Concrete scopes the answer to the question asked", () => {
  // The competitor behaviour the mode is modelled on: a narrow question gets a narrow answer.
  // Without this, a "where are the walls" question came back with flip + flow + regime + play.
  assert.match(CONCRETE, /answer only what was asked/i, "must restrict scope to the question");
});

test("Concrete requires the FIRST SENTENCE to be the answer", () => {
  // A leading verdict word is what makes the reply scannable in one glance.
  assert.match(CONCRETE, /first sentence must BE the answer/i);
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

test("every number must carry the relation that makes it mean something", () => {
  // A bare figure is telemetry, not an answer: the member cannot tell whether 140 is near, far,
  // big or irrelevant. The competitor answers this was modelled on never print a naked number —
  // it is always strike + expiry + distance, or a share of the largest node.
  assert.match(CONCRETE, /no number without its relation/i);
  assert.match(CONCRETE, /% of king|share-of-the-biggest/i, "must show the ratio form");
  assert.match(CONCRETE, /below spot/i, "must show the distance form");
});

test("it must state the mechanism in plain English, not dump indicator names", () => {
  // The member's exact complaint: answers were "throwing random words" — `Tide bullish, NOPE
  // +0.50, TICK +265, TRIN 2.0` is a symbol dump that leaves them to decode it.
  assert.match(CONCRETE, /say what it means, not what it is called/i);
  assert.match(CONCRETE, /symbol dump/i);
  assert.match(CONCRETE, /plain English/i);
});

test("inline source tags are banned — the rails already carry provenance", () => {
  // `(SPX desk · live)` after every clause is what made the old answers unreadable as prose.
  // This bans the CLUTTER, not the disclosure: the stale/missing rule above is untouched.
  assert.match(CONCRETE, /do not attach source tags/i);
  assert.match(CONCRETE, /SPX desk · live/, "must name the exact form it rejects");
});

test("brevity is achieved by OFFERING the rest, not by omitting it", () => {
  // The mechanism that lets a 600-char answer be complete: adjacent reads live in the follow-up
  // chips. Without this the model resolves "be short" against "be thorough" by padding.
  assert.match(CONCRETE, /follow-up chips/i);
  assert.match(CONCRETE, /trust them to ask/i);
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
