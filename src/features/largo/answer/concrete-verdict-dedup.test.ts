import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Every Concrete answer printed its opening sentence TWICE.
 *
 * `envelope.headline` is derived FROM the answer's opening sentence, and `body` is the whole
 * answer. `LargoConcreteAnswer` rendered the verdict `<p>` and then the untouched body, so the same
 * sentence appeared back to back.
 *
 * MEASURED ON PROD 2026-08-20 at 1024x1366, "Where are the SPX gamma walls?":
 *
 *     Call wall 7900, put wall 7640.                              <- verdict <p>
 *     Call wall 7900, put wall 7640. The put wall is 1.16 pts ...  <- body, same sentence again
 *
 * Found by SCREENSHOT while checking tablet chrome — the chrome was clean and the CONTENT was not.
 * No probe I had would have caught it: the text does not overflow, clip, collide, or leak schema.
 * It is simply the same claim twice, which reads as padding to a member and is precisely the
 * "spitting a lot of shitty information" complaint that started this work.
 */

const SRC = readFileSync(
  join(process.cwd(), "src/features/largo/answer/LargoConcreteAnswer.tsx"),
  "utf8"
);

// Exercise the real helpers by evaluating them out of the module — importing the component pulls
// React and the whole answer stack into a node:test run for two pure string functions.
function loadHelper(name: string): (a: string, b: string) => string {
  const at = SRC.indexOf(`function ${name}(`);
  assert.notEqual(at, -1, `${name} must exist`);
  const norm = SRC.slice(SRC.indexOf("function normalizeForCompare("));
  const js = norm
    .replace(/:\s*string\b/g, "")
    .replace(/\)\s*:\s*string\s*\{/g, ") {");
  // eslint-disable-next-line no-new-func
  return new Function(`${js}; return ${name};`)() as (a: string, b: string) => string;
}

const dropLeadingSentence = loadHelper("dropLeadingSentence");

test("REGRESSION: the duplicated opening sentence is removed", () => {
  const verdict = "Call wall 7900, put wall 7640.";
  const body =
    "Call wall 7900, put wall 7640. The put wall is 1.16 points below spot at 7641.16 — the nearest support.";
  const out = dropLeadingSentence(body, verdict);
  assert.ok(out.startsWith("The put wall is 1.16"), `body still opens with the verdict: ${out.slice(0, 60)}`);
  assert.equal(out.includes("Call wall 7900, put wall 7640."), false);
});

test("markdown emphasis does not defeat the match", () => {
  // The verdict has been through `stripEmphasis`; the body still carries its markdown. A raw
  // equality check misses this and leaves the duplication exactly where it was.
  const out = dropLeadingSentence("**Call wall 7900**, put wall 7640. Then more.", "Call wall 7900, put wall 7640.");
  assert.equal(out, "Then more.");
});

test("a headline that is NOT a lift leaves the body intact", () => {
  // The envelope may legitimately carry a fresh summary. Stripping unconditionally would delete the
  // member's real first sentence — a worse bug than the one being fixed.
  const body = "The put wall is 1.16 points below spot. Dealers are net short gamma.";
  assert.equal(dropLeadingSentence(body, "SPX is pinned between two defensive walls."), body);
});

test("a later repeat is a callback, not a duplicate", () => {
  // Only the FIRST sentence is a candidate. Matching anywhere would silently edit prose that
  // deliberately restates a level further down.
  const body = "Dealers are net short gamma. Call wall 7900, put wall 7640.";
  assert.equal(dropLeadingSentence(body, "Call wall 7900, put wall 7640."), body);
});

test("empty and unmatched inputs are total — never throw, never eat the body", () => {
  assert.equal(dropLeadingSentence("Some body.", ""), "Some body.");
  assert.equal(dropLeadingSentence("", "verdict."), "");
  assert.equal(dropLeadingSentence("No terminal punctuation here", "No terminal punctuation here"), "No terminal punctuation here");
});

test("the component renders the stripped body, not the original", () => {
  // The helper is useless if the JSX still passes `body`. This is the wiring the fix depends on —
  // the exact class of mistake this session has found repeatedly: correct logic, not connected.
  assert.match(SRC, /content=\{bodyWithoutVerdict\}/);
  assert.doesNotMatch(SRC, /content=\{body\}/);
});
