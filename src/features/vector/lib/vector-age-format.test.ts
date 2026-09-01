import { test } from "node:test";
import assert from "node:assert/strict";
import { formatVectorAge } from "./vector-age-format";

test("formatVectorAge: null/undefined/zero/negative asOf or missing now → null (no chip)", () => {
  assert.equal(formatVectorAge(null, 1000), null);
  assert.equal(formatVectorAge(undefined, 1000), null);
  assert.equal(formatVectorAge(0, 1000), null);
  assert.equal(formatVectorAge(-5, 1000), null);
  assert.equal(formatVectorAge(500, null), null);
});

test("formatVectorAge: under a minute renders whole seconds", () => {
  assert.equal(formatVectorAge(1000, 1000), "0s");
  assert.equal(formatVectorAge(1000, 1500), "0s");
  assert.equal(formatVectorAge(1000, 6000), "5s");
  assert.equal(formatVectorAge(1000, 60_000 - 1), "58s");
});

test("formatVectorAge: a minute or more renders whole minutes", () => {
  // asOf<=0 is itself an invalid-sentinel guard case (tested above), so use a real epoch base.
  assert.equal(formatVectorAge(1000, 1000 + 60_000), "1m");
  assert.equal(formatVectorAge(1000, 1000 + 90_000), "1m");
  assert.equal(formatVectorAge(1000, 1000 + 25 * 60_000), "25m");
});

test("formatVectorAge: asOf in the future clamps to 0s, never negative", () => {
  assert.equal(formatVectorAge(2000, 1000), "0s");
});
