import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stripEmbeddedLevel } from "./strip-embedded-level";
import { join } from "node:path";

/**
 * Vanna walls exist, are published, and were being dropped on the way to Largo.
 *
 * PRODUCTION, 2026-08-20. Asked "Where are SPX vanna walls?", Largo answered:
 *
 *   "Vanna walls themselves don't appear as discrete strikes in the live feed the way gamma walls
 *    do; vanna is a distributed effect across the matrix rather than a concentrated barrier at one
 *    level."
 *
 * At that exact moment /api/market/gex-heatmap?ticker=SPX was publishing
 * `vex.pos_wall = 7900` and `vex.neg_wall = 7625`.
 *
 * ROOT CAUSE: `gexHeatmapForLargo` projects the heatmap down to summary scalars for the prompt, and
 * carried `net_vex` and `vanna_regime_read` but NOT the vex walls. Largo could not state them
 * because it never received them.
 *
 * The second, worse half is what it did NEXT: rather than say "I don't have that read", it produced
 * a confident structural explanation for the absence. A member cannot distinguish a real structural
 * fact from a rationalised gap, so they leave believing the platform does not compute something it
 * does — and it is on their heatmap. Missing input became a fabricated NEGATIVE.
 *
 * Asserted on SOURCE for the projection (importing it reaches Polygon/Redis) and on the system
 * prompt for the rule.
 */

const root = process.cwd();
const PROJECTION = readFileSync(join(root, "src/lib/largo/gex-heatmap-for-largo.ts"), "utf8");
const SYSTEM = readFileSync(join(root, "src/lib/largo/system-prompt.ts"), "utf8");

/** Strip comments so a guard never matches its own explanation. */
const CODE = PROJECTION.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");

test("REGRESSION: the Largo projection carries the vanna walls", () => {
  assert.match(CODE, /vex_pos_wall/, "vex_pos_wall must reach Largo");
  assert.match(CODE, /vex_neg_wall/, "vex_neg_wall must reach Largo");
  // Sourced from the heatmap payload, not invented downstream.
  assert.match(CODE, /hm\.vex\?\.pos_wall/, "must read pos_wall off the heatmap");
  assert.match(CODE, /hm\.vex\?\.neg_wall/, "must read neg_wall off the heatmap");
});

test("the vex flip travels with the walls", () => {
  // Without it, "where is the vanna flip" has the same failure mode the walls just had.
  assert.match(CODE, /vex_flip/);
  assert.match(CODE, /hm\.vex\?\.flip/);
});

test("the empty/degraded branch declares the new fields too", () => {
  // A projection that omits them when the read fails would make `vex_pos_wall` undefined rather
  // than null — which reads to the model as "field absent" instead of "value unknown", and that is
  // exactly the ambiguity that produced the fabricated negative.
  const nullBranch = CODE.slice(0, CODE.indexOf("top_strikes: topStrikesFromTotals"));
  assert.match(nullBranch, /vex_pos_wall:\s*null/);
  assert.match(nullBranch, /vex_neg_wall:\s*null/);
});

test("REGRESSION: the missing-read rule EXTENDS the existing non-negotiable section", () => {
  // The "Evidence absent is NOT evidence of absence" section already existed and Largo violated it
  // anyway — because every one of its examples was about MARKET PARTICIPANTS ("no institutional
  // conviction"), and the vanna failure was a claim about WHAT THE PLATFORM COMPUTES. The fix
  // widens that section rather than adding a second copy elsewhere: a non-negotiable rule split
  // across two places is a rule on its way to being weakened.
  const start = SYSTEM.indexOf("Evidence absent is NOT evidence of absence");
  assert.notEqual(start, -1, "the original section must still exist");
  const section = SYSTEM.slice(start, start + 2600);

  // The new shape lives INSIDE that section, not in a separate block.
  assert.match(section, /vanna walls/i, "the vanna case must be one of its examples");
  assert.match(
    section,
    /what the platform computes/i,
    "must name the platform-claim shape, not just the participant-claim shape"
  );
  // Whitespace-tolerant: the prompt is a wrapped template literal, so a literal-space regex would
  // fail on re-wrapping rather than on meaning.
  assert.match(
    section,
    /never\s+evidence\s+about\s+what\s+exists/i,
    "must state the principle, not only the example"
  );
});

test("the rule is not duplicated into a second location", () => {
  // Two copies drift. One wins, the other rots, and nobody knows which the model followed.
  const hits = SYSTEM.match(/never explain WHY it is absent/gi) ?? [];
  assert.ok(hits.length <= 1, `missing-read rule appears ${hits.length} times; it must live in one place`);
});

test("the existing non-omission guarantee survives alongside it", () => {
  // The new rule is an ADDITION. If it ever displaces the original silent-omission guarantee, the
  // honesty contract has been traded sideways rather than strengthened.
  assert.match(SYSTEM, /silent omission/i);
});

/**
 * The regime read must not smuggle a SECOND, DIFFERENT value for a level already typed.
 *
 * `gex.flip` and `gex.regime.flip` disagree on prod by 6.22 pts, deterministically — confirmed
 * across four samples 20s apart AND through a forced rebuild (`?force=1`, 9.5s, genuinely
 * recomputed), which rules out both staleness and caching. The regime READ embeds the second value
 * in prose, so Largo received the same quantity twice with two numbers and reported both:
 * "Gamma flip 7891.94 (7886.81 on Thermal matrix)". To a member that reads as the product
 * contradicting itself.
 */
test("REGRESSION: the gamma regime read hands Largo no duplicate level", () => {
  assert.match(CODE, /stripEmbeddedLevel/, "the read must be sanitised before it reaches the model");
  assert.match(
    CODE,
    /gamma_regime_read:\s*stripEmbeddedLevel\(/,
    "the gamma read specifically — that is where the conflicting flip lives"
  );
});

test("stripping removes the level but keeps the regime words", () => {
  // Exercises the REAL function. The first version of this test reconstructed the regex inline,
  // and that copy silently drifted the moment the implementation was hardened for CodeQL — the
  // test kept passing while verifying a pattern no longer in use. That is the same
  // duplicate-and-drift failure this audit has now found three times in product code; a test is
  // not exempt from it.
  const sample =
    "Spot 7,707.98 is below the gamma flip (7,887.15) → short gamma: momentum / vol expansion, moves accelerate. Resistance 7,800, support 7,700.";
  const out = stripEmbeddedLevel(sample) ?? "";
  assert.doesNotMatch(out, /7,887\.15/, "the conflicting level must be gone");
  assert.doesNotMatch(out, /\(\s*\)/, "no empty parens left behind");
  assert.match(out, /short gamma/, "the regime verdict must survive");
  assert.match(out, /Resistance 7,800/, "bare wall levels are not duplicates — they must survive");
  assert.match(out, /support 7,700/);
  assert.match(out, /Spot 7,707\.98 is below the gamma flip/, "the sentence must still read");
});

test("stripEmbeddedLevel is total — null in, null out, no throw", () => {
  assert.equal(stripEmbeddedLevel(null), null);
  assert.equal(stripEmbeddedLevel(undefined), null);
  assert.equal(stripEmbeddedLevel(""), null);
});

test("bounded regex does not blow up on a pathological run of spaces", () => {
  // The CodeQL alert this guards. An unbounded `\s*\(\s*...` retries every split on input like
  // this; the bounded form cannot. Asserted as a TIME budget because the failure mode is latency,
  // not a wrong answer.
  const evil = "flip " + " ".repeat(50_000) + "(";
  const t0 = Date.now();
  stripEmbeddedLevel(evil);
  assert.ok(Date.now() - t0 < 1000, "must not backtrack into the seconds on adversarial spacing");
});
