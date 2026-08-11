import test from "node:test";
import assert from "node:assert/strict";
import { overconfidentClaims, toneIssues, honestyIssues } from "./professional-tone";

/**
 * TONE SCORING — and specifically the direction its errors point.
 *
 * These tests exist because a false positive on this check is not a neutral measurement error. The
 * only way an answer layer can "fix" a caution flagged as overconfidence is to delete the caution,
 * so a bad check here actively pushes member-facing copy toward more confident claims. The negation
 * cases below are therefore the load-bearing ones, not the edge cases.
 */

test("a negated caution is NOT overconfidence — the live false positive", () => {
  // Verbatim from a production answer, scored `tone-overconfident` by the old bare-word check.
  const real = "SPX whale calls are bullish, but conviction in the tape does not guarantee execution.";
  assert.deepEqual(overconfidentClaims(real), []);
  assert.deepEqual(toneIssues(real), []);
});

test("other negation shapes are also suppressed", () => {
  for (const s of [
    "There is no guarantee this holds.",
    "This is never a sure thing.",
    "Nothing here is free money.",
    "A high win rate cannot guarantee the next trade.",
    "No setup is a sure thing at this size.",
  ]) {
    assert.deepEqual(overconfidentClaims(s), [], `should not flag: ${s}`);
  }
});

test("an actual overconfident claim IS still flagged", () => {
  for (const s of [
    "This setup is a guaranteed win.",
    "SPX 6000 calls are free money into the close.",
    "This is a sure thing.",
    "You can't lose on this one.",
  ]) {
    assert.ok(overconfidentClaims(s).length > 0, `should flag: ${s}`);
    assert.ok(toneIssues(s).includes("overconfident"), `toneIssues should flag: ${s}`);
  }
});

test("negation does not leak across a sentence boundary", () => {
  // The negation window stops at `.` and `;` — otherwise "not" in a previous sentence would
  // whitewash a boast in the next one, which is the failure mode in the opposite direction.
  const s = "The read is not settled. This trade is a guaranteed win.";
  assert.deepEqual(overconfidentClaims(s), ["guaranteed"]);
});

test("the other tone heuristics are unchanged", () => {
  assert.ok(toneIssues("I think SPX might be around 6000").includes("speculative"));
  assert.ok(toneIssues("SPX is ripping 🚀").includes("emoji"));
  assert.ok(toneIssues("SPX is ripping!!!").includes("casual-punctuation"));
  assert.deepEqual(toneIssues("SPX spot 6012.40, call wall 6100."), []);
});

test("honesty check still demands grounded numbers in a long answer", () => {
  const wordy = "The tape looks constructive and the desk leans long into the close across the board here.";
  assert.ok(honestyIssues(wordy).includes("no-grounded-numbers"));
  assert.deepEqual(honestyIssues("SPX spot 6012.40 with the call wall at 6100 and put wall 5900."), []);
});
