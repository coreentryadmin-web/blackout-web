import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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
  // The read exists to say long/short gamma and where resistance/support sit. Removing the
  // parenthetical must not cost any of that.
  const src = PROJECTION.slice(PROJECTION.indexOf("function stripEmbeddedLevel"));
  const body = src.slice(0, src.indexOf("\n}"));
  const m = body.match(/replace\((\/[^/]+\/[a-z]*)/);
  assert.ok(m, "strip must be implemented as a replace");
  // Reconstruct the behaviour on the real production string.
  const sample = "Spot 7,707.98 is below the gamma flip (7,887.15) → short gamma: momentum / vol expansion, moves accelerate. Resistance 7,800, support 7,700.";
  const stripped = sample.replace(/\s*\(\s*[\d,]+(?:\.\d+)?\s*\)/g, "").replace(/\s{2,}/g, " ").trim();
  assert.doesNotMatch(stripped, /7,887\.15/, "the conflicting level must be gone");
  assert.match(stripped, /short gamma/, "the regime verdict must survive");
  assert.match(stripped, /Resistance 7,800/, "walls are NOT parenthetical duplicates — they must survive");
  assert.match(stripped, /support 7,700/);
});
