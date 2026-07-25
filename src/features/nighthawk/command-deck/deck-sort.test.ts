import { test } from "node:test";
import assert from "node:assert/strict";
import { sortPlaysForDeck } from "./deck-sort.ts";
import type { DeckStatus, TerminalPlay } from "./types.ts";

/** Minimal TerminalPlay fixture — only id/status matter for ordering; the rest is filler. */
function play(id: string, status: DeckStatus): TerminalPlay {
  return {
    id,
    ticker: "SPY",
    direction: "LONG",
    contract: "700C · 0DTE",
    score: 0,
    status,
    horizon: "ZERO_DTE",
    exitModel: "RATCHET",
    factors: [],
    gates: [],
    recommendation: "HOLD",
  };
}

const ids = (plays: TerminalPlay[]) => plays.map((p) => p.id);

test("sortPlaysForDeck: OPEN band on top, WATCH middle, CLOSED bottom", () => {
  const input = [
    play("c1", "CLOSED"),
    play("w1", "WATCH"),
    play("o1", "OPEN"),
    play("t1", "TRIM"),
    play("s1", "SKIP"),
    play("h1", "HOLD"),
  ];
  const out = sortPlaysForDeck(input);
  // OPEN band = OPEN/HOLD/TRIM, WATCH band = WATCH/SKIP, CLOSED band = CLOSED.
  assert.deepEqual(ids(out), ["o1", "t1", "h1", "w1", "s1", "c1"]);
});

test("sortPlaysForDeck: STABLE within each band (preserves incoming score rank)", () => {
  // Same band, given in a deliberate rank order — must come out in that exact order.
  const input = [
    play("o1", "OPEN"),
    play("o2", "HOLD"),
    play("o3", "TRIM"),
    play("o4", "OPEN"),
  ];
  assert.deepEqual(ids(sortPlaysForDeck(input)), ["o1", "o2", "o3", "o4"]);

  // Interleaved bands: relative order inside each band is preserved.
  const mixed = [
    play("o1", "OPEN"),
    play("w1", "WATCH"),
    play("o2", "OPEN"),
    play("w2", "SKIP"),
    play("o3", "HOLD"),
  ];
  assert.deepEqual(ids(sortPlaysForDeck(mixed)), ["o1", "o2", "o3", "w1", "w2"]);
});

test("sortPlaysForDeck: does not mutate the input array", () => {
  const input = [play("c1", "CLOSED"), play("o1", "OPEN")];
  const snapshot = ids(input);
  const out = sortPlaysForDeck(input);
  assert.deepEqual(ids(input), snapshot, "input order unchanged");
  assert.notEqual(out, input, "returns a new array");
});

test("sortPlaysForDeck: empty and single-band inputs are safe", () => {
  assert.deepEqual(sortPlaysForDeck([]), []);
  const allOpen = [play("a", "OPEN"), play("b", "TRIM")];
  assert.deepEqual(ids(sortPlaysForDeck(allOpen)), ["a", "b"]);
});

test("sortPlaysForDeck: fully interleaved 6-status input — every band split correctly, order preserved within", () => {
  // A deliberately shuffled score-ranked list touching all six statuses more than once.
  const input = [
    play("c1", "CLOSED"),
    play("h1", "HOLD"),
    play("s1", "SKIP"),
    play("o1", "OPEN"),
    play("w1", "WATCH"),
    play("t1", "TRIM"),
    play("c2", "CLOSED"),
    play("o2", "OPEN"),
    play("w2", "WATCH"),
  ];
  const out = sortPlaysForDeck(input);
  // Working band (OPEN/HOLD/TRIM) in incoming order, then middle (WATCH/SKIP), then CLOSED — all stable.
  assert.deepEqual(ids(out), ["h1", "o1", "t1", "o2", "s1", "w1", "w2", "c1", "c2"]);
});

test("sortPlaysForDeck: WATCH and SKIP share the middle band and keep their incoming relative order", () => {
  const input = [play("s1", "SKIP"), play("w1", "WATCH"), play("s2", "SKIP"), play("w2", "WATCH")];
  // No working or closed rows → the whole list is the middle band, untouched.
  assert.deepEqual(ids(sortPlaysForDeck(input)), ["s1", "w1", "s2", "w2"]);
});

test("sortPlaysForDeck: a stable tiebreak — same status, same score comes out in insertion order", () => {
  // Three OPEN rows given in a specific order must survive verbatim (no re-sort by score/id).
  const input = [play("z", "OPEN"), play("a", "OPEN"), play("m", "OPEN")];
  assert.deepEqual(ids(sortPlaysForDeck(input)), ["z", "a", "m"]);
});

test("sortPlaysForDeck: all-CLOSED input is returned in order (bottom band, stable)", () => {
  const input = [play("c1", "CLOSED"), play("c2", "CLOSED"), play("c3", "CLOSED")];
  assert.deepEqual(ids(sortPlaysForDeck(input)), ["c1", "c2", "c3"]);
});
