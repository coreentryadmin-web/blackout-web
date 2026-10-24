import { test } from "node:test";
import assert from "node:assert/strict";
import { buildPlayIdea, humanizeGateBlocks } from "@/features/spx/lib/spx-play-intel";
import type { SpxDeskPayload } from "@/features/spx/lib/spx-desk";
import type { SpxConfluence } from "@/features/spx/lib/spx-signals";

/**
 * Regression for the "direction: null but play_idea reads confidently one-sided" trace flagged
 * by the standing Ask Largo / 5-engine monitor (cycle 2026-09-09, off SPX Slayer live GET
 * /api/market/spx/play): score +8, bias "neutral" (abs(score) < 10 stays WAIT/neutral per
 * spx-signals.ts), confluence.direction correctly null — but resolveLeanDirection's final
 * fallback in spx-play-intel.ts ignored the score's own sign entirely and used `desk.above_vwap`
 * instead, which can (and, live, did) disagree with the sign of the very score it's supposed to
 * summarize: score was net +8 (weakly bullish) while above_vwap was false (price sat below VWAP
 * that snapshot), so the fallback asserted "short" — the play_idea line read
 * "Tape's mixed, but Puts lean" while the net weighted score said the opposite.
 *
 * Fix: when bias is neutral (direction null) and |score| < 12 (below the resolveLeanDirection's
 * own explicit-lean threshold), prefer the SIGN of the score itself before falling back to the
 * VWAP proxy — score is the aggregate the caller already trusts enough to display, so a fallback
 * that contradicts its sign is misleading by construction. Only a genuinely zero score (no lean
 * information at all) falls through to the VWAP-position proxy.
 */

function fixture(score: number, aboveVwap: boolean): { desk: SpxDeskPayload; confluence: SpxConfluence } {
  const desk = {
    price: 7673.52,
    vwap: 7685.91,
    above_vwap: aboveVwap,
    gex_walls: [],
    levels: [],
  } as unknown as SpxDeskPayload;

  const confluence = {
    action: "WAIT",
    bias: "neutral",
    rawScore: 39,
    score,
    headline: "",
    thesis: "",
    factors: [
      { label: "0DTE flow", weight: 14, detail: "Call premium leading 0DTE tape" },
      { label: "Market tide", weight: -10, detail: "bearish broad flow" },
      { label: "TICK", weight: -8, detail: "NYSE TICK -353" },
    ],
    levels: { entry: 7718.6, stop: null, target: null, invalidation: "" },
    as_of: new Date().toISOString(),
    grade: "D",
    conflicts: 3,
    weighted_conflicts: 5,
    agreeing: 0,
    direction: null,
  } as unknown as SpxConfluence;

  return { desk, confluence };
}

test("humanizeGateBlocks: two unrelated raw gates (grade-below-minimum, score-too-low) that both humanize via the same buildPlayIdeaIntel() line are deduped, not shown twice (live repro SPX play 2026-09-28)", () => {
  // BUG: humanizeGateBlock replaces several structurally different raw gate reasons with the
  // SAME buildPlayIdeaIntel(desk, confluence) line (a pure function of desk+confluence), each
  // appending its own trailing suffix. A weak setup commonly fails both the grade gate AND the
  // score gate at once, so a plain .map() over raw blocks let the same idea line through twice —
  // live repro: "...· waiting for grade confirmation" and the identical line without the suffix,
  // back to back in the same gates.blocks array.
  //
  // UPDATED 2026-10-20 (Ask Largo/5-engine standing mandate, live repro): this fixture's first
  // raw block ("too many conflicting signals") used to NEVER match any humanize branch (a
  // separate keyword-mismatch bug, since fixed below) and so never entered the dedup pool at
  // all — which is why the ORIGINAL version of this test could assert the suffixed
  // grade-confirmation variant "wins": with mixed-tape sitting outside the pool, the
  // grade-below-minimum gate was genuinely the FIRST real idea-prefix entry. Now that mixed-tape
  // is correctly humanized too, it is first in evaluation order (matching this file's own
  // documented first-occurrence-wins tie-break, "whichever gate rule ran first, not an arbitrary
  // pick") and so is the one kept; the suffixed duplicate is deduped away. This is the correct
  // outcome of the keyword fix, not a regression — see the sibling test below for the specific
  // keyword-match bug this closes.
  const { desk, confluence } = fixture(8, false);
  const rawBlocks = [
    "Tape's mixed — too many conflicting signals for clean entry",
    "Grade D below minimum (need B or better)", // -> idea + "· waiting for grade confirmation"
    "Cold BUY needs score ≥78 (have 33) — WATCH→ENTRY path preferred",
    "Cold BUY requires grade A or better — B setups need WATCH→ENTRY",
    "Score 33 too low — quality setups only", // -> idea line, no suffix — the duplicate
  ];
  const out = humanizeGateBlocks(rawBlocks, desk, confluence);
  const ideaLines = out.filter((b) => /Tape's mixed, but/.test(b));
  assert.equal(ideaLines.length, 1, `expected exactly one humanized idea line, got: ${JSON.stringify(out)}`);
  // Everything that never matched a humanize branch must survive untouched.
  assert.ok(out.some((b) => b.includes("Cold BUY needs score")));
  assert.ok(out.some((b) => b.includes("Cold BUY requires grade")));
});

// BUG FIX (2026-10-20, Ask Largo/5-engine standing mandate, live repro). humanizeGateBlock's
// mixed-tape check matched the substring "too many conflicts", but the real gate message (built
// once in spx-play-gates.ts) reads "too many conflicting signals for clean entry" — that
// substring never appears, so the mixed-tape block was NEVER humanized and never entered the
// dedup pool humanizeGateBlocks relies on. Live production evidence: gates.blocks carried the
// raw, untouched mixed-tape string AND a separately-humanized idea line for the grade gate, back
// to back — reading as two unrelated problems when both describe the identical mixed-tape
// condition.
test("humanizeGateBlocks: the mixed-tape raw block is itself humanized, not left as an incoherent raw duplicate alongside another gate's idea line", () => {
  const { desk, confluence } = fixture(8, false);
  const rawBlocks = [
    "Tape's mixed — too many conflicting signals for clean entry",
    "Grade D below minimum (need B or better)",
  ];
  const out = humanizeGateBlocks(rawBlocks, desk, confluence);
  assert.ok(
    !out.some((b) => b.includes("too many conflicting signals")),
    `the raw mixed-tape string must not survive untouched — got: ${JSON.stringify(out)}`,
  );
  const ideaLines = out.filter((b) => /Tape's mixed, but/.test(b));
  assert.equal(
    ideaLines.length,
    1,
    `mixed-tape and grade-below-minimum describe the same condition and must collapse to one idea line, got: ${JSON.stringify(out)}`,
  );
});

test("humanizeGateBlock: dead 'headwinds' keyword matches nothing (confirmed no gate message anywhere contains it)", () => {
  const { desk, confluence } = fixture(8, false);
  const out = humanizeGateBlocks(["Some gate blocked due to macro headwinds today"], desk, confluence);
  assert.equal(
    out[0],
    "Some gate blocked due to macro headwinds today",
    "a message merely containing the word 'headwinds' must not be rewritten — that keyword branch is gone",
  );
});

test("buildPlayIdea leans with the score's own sign in the neutral zone, not an unrelated VWAP proxy that can disagree with it", () => {
  // Net score +8 (weakly bullish) but price below VWAP (above_vwap=false) — the exact live
  // disagreement. The idea must not assert "short"/"Puts" here.
  const { desk, confluence } = fixture(8, false);
  const idea = buildPlayIdea(desk, confluence);
  assert.ok(idea, "expected a play idea");
  assert.equal(idea!.direction, "long", "a net-positive score must not produce a short/Puts lean");
  assert.equal(idea!.option_type, "call");
  assert.match(idea!.line, /Calls/);
});

test("buildPlayIdea leans short with a net-negative score even when above_vwap is true", () => {
  const { desk, confluence } = fixture(-8, true);
  const idea = buildPlayIdea(desk, confluence);
  assert.ok(idea);
  assert.equal(idea!.direction, "short", "a net-negative score must not produce a long/Calls lean");
  assert.equal(idea!.option_type, "put");
  assert.match(idea!.line, /Puts/);
});

test("buildPlayIdea still falls back to the VWAP proxy when the score is exactly zero (no lean information at all)", () => {
  const { desk, confluence } = fixture(0, false);
  const idea = buildPlayIdea(desk, confluence);
  assert.ok(idea);
  assert.equal(idea!.direction, "short");
});

/**
 * Regression for the "anchor cites the farthest wall instead of the nearest" bug flagged by the
 * standing Ask Largo / 5-engine monitor (cycle 2026-10-17 ~19:21 UTC, live GET
 * /api/market/spx/desk + /api/market/spx/play): `desk.gex_walls` is returned strike-descending
 * (live: 7900, 7675, 7670, 7665, 7660 resistances, spot 7659.44). `anchorPhrase`'s old
 * `desk.gex_walls?.find((w) => w.kind === "resistance")` had no proximity selection, so on a
 * descending array it always returned the FIRST resistance encountered — the highest-strike
 * (farthest) one, not the nearest. Live repro: play_idea cited "below 7900 resistance" (240.56
 * pts away) while the confluence factor actually driving the score ("Into 0DTE resistance 7660")
 * sat only 0.56 pts from spot and was never mentioned. Fixed by reusing `nearestWall` (the same
 * resolver `buildLevels()` uses to pick the wall the score is keyed off of) instead of a bare
 * `.find()`.
 */
test("buildPlayIdea's anchor cites the NEAREST resistance wall, not the farthest one in a descending gex_walls array (live repro 2026-10-17)", () => {
  const desk = {
    price: 7659.44,
    vwap: null,
    above_vwap: false,
    gex_walls: [
      { kind: "resistance", strike: 7900 },
      { kind: "resistance", strike: 7675 },
      { kind: "resistance", strike: 7670 },
      { kind: "resistance", strike: 7665 },
      { kind: "resistance", strike: 7660 },
      { kind: "support", strike: 7635 },
    ],
    levels: [],
  } as unknown as SpxDeskPayload;

  const confluence = {
    action: "WAIT",
    bias: "bearish",
    rawScore: 44,
    score: -44,
    headline: "",
    thesis: "",
    factors: [{ label: "GEX resistance", weight: -18, detail: "Into 0DTE resistance 7660 (−1 pts)" }],
    levels: { entry: 7659.44, stop: null, target: null, invalidation: "" },
    as_of: new Date().toISOString(),
    grade: "D",
    conflicts: 1,
    weighted_conflicts: 1,
    agreeing: 0,
    direction: "short",
  } as unknown as SpxConfluence;

  const idea = buildPlayIdea(desk, confluence);
  assert.ok(idea, "expected a play idea");
  assert.equal(idea!.direction, "short");
  assert.match(idea!.line, /below 7660 resistance/, `anchor must cite the nearest wall (7660), got: ${idea!.line}`);
  assert.doesNotMatch(idea!.line, /7900/, "must not cite the farthest wall");
});
