import { test } from "node:test";
import assert from "node:assert/strict";
import { COORD_WINDOW_MS, hasCoincidentBlock } from "./helix-coord-window";

const T = Date.parse("2026-08-21T20:00:00.000Z");
const at = (offsetMs: number) => new Date(T + offsetMs).toISOString();

test("a block inside the window coincides; one outside does not", () => {
  assert.equal(hasCoincidentBlock([{ ticker: "NVDA", executed_at: at(-60_000) }], "NVDA", T), true);
  assert.equal(
    hasCoincidentBlock([{ ticker: "NVDA", executed_at: at(-COORD_WINDOW_MS - 1) }], "NVDA", T),
    false
  );
});

test("the window is symmetric — a block just AFTER the print still coincides", () => {
  assert.equal(hasCoincidentBlock([{ ticker: "NVDA", executed_at: at(60_000) }], "NVDA", T), true);
});

test("an unparseable block time is SKIPPED, not silently answered 'no'", () => {
  // The defect: `Math.abs(NaN - t) <= WINDOW` is false, so a bad block time did not error — it
  // quietly failed to coincide with anything. With a real block also present, the bad one must not
  // be able to hide it.
  const blocks = [
    { ticker: "NVDA", executed_at: "not-a-time" },
    { ticker: "NVDA", executed_at: at(-30_000) },
  ];
  assert.equal(hasCoincidentBlock(blocks, "NVDA", T), true);
});

test("every plausible bad block time is handled, not just the obvious one", () => {
  for (const bad of ["", "   ", "not-a-time", "1787343258239", null, undefined]) {
    assert.equal(
      hasCoincidentBlock([{ ticker: "NVDA", executed_at: bad as never }], "NVDA", T),
      false,
      `${JSON.stringify(bad)} must not coincide`
    );
  }
});

test("an epoch-string block time does not coincide — and must not be read as 1970 either", () => {
  // `new Date("1787343258239")` is Invalid Date. The point is that it is REFUSED rather than
  // coerced: a block coerced to 1970 would be outside every window, which looks the same here but
  // is the wrong reason, and would be the wrong answer anywhere a distance is reported.
  assert.equal(
    hasCoincidentBlock([{ ticker: "NVDA", executed_at: "1787343258239" }], "NVDA", T),
    false
  );
});

test("ticker must match — a coincident block on another name is not this name's block", () => {
  assert.equal(hasCoincidentBlock([{ ticker: "AMD", executed_at: at(0) }], "NVDA", T), false);
});

test("an unusable alert time refuses outright", () => {
  // "this print has no trustworthy time" and "no block matched" are different refusals; the caller
  // resolves the alert time, and a NaN reaching here must not be treated as a real comparison.
  assert.equal(hasCoincidentBlock([{ ticker: "NVDA", executed_at: at(0) }], "NVDA", Number.NaN), false);
});

test("no blocks at all is false, not a throw", () => {
  assert.equal(hasCoincidentBlock([], "NVDA", T), false);
});

test("the boundary is inclusive and exact", () => {
  assert.equal(hasCoincidentBlock([{ ticker: "N", executed_at: at(-COORD_WINDOW_MS) }], "N", T), true);
  assert.equal(hasCoincidentBlock([{ ticker: "N", executed_at: at(COORD_WINDOW_MS) }], "N", T), true);
});
