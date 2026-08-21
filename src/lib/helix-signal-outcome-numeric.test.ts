import test from "node:test";
import assert from "node:assert/strict";
import { pgNumericOrNull } from "@/lib/db";

/**
 * `pg` returns NUMERIC and BIGSERIAL as STRINGS. `HelixSignalOutcomeRow` declares
 * `number | null`, and nothing cast — 32 numeric strings measured live in one 50-row read
 * (`price_at_fire: "7641.63"`). roundFloats tests `typeof v === "number"` and is blind to them.
 */

test("a numeric string becomes a real number", () => {
  assert.equal(pgNumericOrNull("7641.63"), 7641.63);
  assert.equal(pgNumericOrNull("710.81"), 710.81);
  assert.equal(typeof pgNumericOrNull("92.54"), "number");
});

test("a number passes through untouched", () => {
  assert.equal(pgNumericOrNull(7641.63), 7641.63);
  assert.equal(pgNumericOrNull(0), 0);
});

test("a MISSING checkpoint stays null — it never becomes a real 0.00", () => {
  // Number(null) and Number("") are both 0. A missing 1h checkpoint surfacing as a $0.00 price
  // is the exact fabrication class this repo keeps finding, and gradeOutcome divides by it.
  assert.equal(pgNumericOrNull(null), null);
  assert.equal(pgNumericOrNull(undefined), null);
  assert.equal(pgNumericOrNull(""), null);
});

test("junk does not become a number", () => {
  assert.equal(pgNumericOrNull("N/A"), null);
  assert.equal(pgNumericOrNull("abc"), null);
  assert.equal(pgNumericOrNull(Number.NaN), null);
  assert.equal(pgNumericOrNull(Infinity), null);
});

test("after casting, arithmetic is addition rather than concatenation", () => {
  // The live path only worked because gradeOutcome uses `-` and `/`, which coerce. A single `+`
  // would have concatenated. This pins the property rather than the current operator choice.
  const a = pgNumericOrNull("100.5")!;
  const b = pgNumericOrNull("0.5")!;
  assert.equal(a + b, 101);
  assert.notEqual(a + b, "100.50.5");
});

test("after casting, roundFloats can actually see the value", () => {
  // The point of the cast: a numeric STRING slips past roundFloats entirely.
  const cast = pgNumericOrNull("7641.6300000001");
  assert.equal(typeof cast, "number");
  assert.equal(Math.round(cast! * 100) / 100, 7641.63);
});
