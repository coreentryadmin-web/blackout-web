import { test } from "node:test";
import assert from "node:assert/strict";
import { findContradictions, applyCoherenceCaveat } from "./coherence";

// The real answer, trimmed. Verbatim phrasing from production 2026-08-10.
const LIVE_CONTRADICTION = `**Verdict**

There are no open plays right now. SPX Slayer is in SCANNING mode, 0DTE Command has no committed positions on the board, and the Bangers/Swings lanes show only staged plays, not live risk. A VIX doubling would have nothing to break because nothing is live.

**Facts**

- [fact] SPX Slayer phase: SCANNING, session closed
- [fact] Bangers (Engine B): 20 open positions (JMIA, BHC, HLF, NN, PCT, WGS)
- [fact] Swings lane: 13 committed, 7 watch
`;

test("catches the live case: verdict says none, its own facts say twenty", () => {
  // Every other check passes on this answer — the numbers are real and traceable, the sections
  // conform, grounding is 1.0. Nothing compared the conclusion against the evidence.
  const found = findContradictions(LIVE_CONTRADICTION);
  assert.equal(found.length, 1, "the contradiction must be detected");
  assert.match(found[0]!.claim, /no open plays/i);
  assert.equal(found[0]!.count, 20);
});

test("a consistent answer produces nothing", () => {
  const clean = `**Verdict**

There are no open plays right now — the desk is between sessions.

**Facts**

- [fact] 0DTE Command board: 0 open plays, 0 fresh finds
- [fact] SPX Slayer phase: SCANNING, session closed
`;
  assert.deepEqual(findContradictions(clean), []);
});

test("an answer that never claims absence is never flagged", () => {
  const positive = `**Verdict**

Three plays are live and the riskiest is the SPX condor.

**Facts**

- [fact] Bangers: 20 open positions
- [fact] Swings lane: 13 committed
`;
  assert.deepEqual(findContradictions(positive), []);
});

test("a number far from the noun does not count as evidence", () => {
  // "20 minutes ago" must not pair with "open plays" — requiring adjacency is what keeps this
  // checker quiet enough to survive.
  const noisy = `**Verdict**

There are no open plays right now.

**Facts**

- [fact] Board refreshed 20 minutes ago; 0 open plays
`;
  assert.deepEqual(findContradictions(noisy), []);
});

test("an absence phrase far from the noun does not pair with it", () => {
  // A checker that cries wolf gets deleted, so the absence claim must be ABOUT the noun.
  const unrelated = `**Verdict**

There is no macro catalyst today, and the desk is running its usual scan across a long list of names that it has been building since the open which is quite unrelated to open plays.

**Facts**

- [fact] Bangers: 20 open positions
`;
  assert.deepEqual(findContradictions(unrelated), []);
});

test("a zero count in the evidence is agreement, not contradiction", () => {
  const agree = `**Verdict**

There are no open positions.

**Facts**

- [fact] Board: 0 open positions
`;
  assert.deepEqual(findContradictions(agree), []);
});

test("only one contradiction is reported per answer", () => {
  // "plays" and "open plays" both match; reporting both reads as two separate problems.
  const doubled = `**Verdict**

There are no open plays and no positions live right now.

**Facts**

- [fact] Bangers: 20 open positions
- [fact] Swings: 13 plays committed
`;
  assert.equal(findContradictions(doubled).length, 1);
});

test("the caveat names the disagreement plainly and never replaces the answer", () => {
  const out = applyCoherenceCaveat(LIVE_CONTRADICTION, findContradictions(LIVE_CONTRADICTION));
  assert.ok(out.startsWith(LIVE_CONTRADICTION), "the original answer survives verbatim");
  assert.match(out, /These two parts of this answer disagree/);
  assert.match(out, /Trust the evidence/);
  assert.equal(applyCoherenceCaveat("x", []), "x");
});

test("malformed and empty input is total", () => {
  for (const junk of ["", "no sections here at all", "**Verdict**\n\nonly a verdict"]) {
    assert.doesNotThrow(() => findContradictions(junk));
    assert.deepEqual(findContradictions(junk), []);
  }
});
