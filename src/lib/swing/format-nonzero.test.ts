import test from "node:test";
import assert from "node:assert/strict";
import { formatFixedNonZero } from "./format-nonzero";

test("formatFixedNonZero: behaves exactly like toFixed when the value survives rounding", () => {
  assert.equal(formatFixedNonZero(12.34, 1), "12.3");
  assert.equal(formatFixedNonZero(-5.678, 2), "-5.68");
});

test("formatFixedNonZero: exact zero stays '0.0', never widened", () => {
  assert.equal(formatFixedNonZero(0, 1), "0.0");
});

test("formatFixedNonZero: a real nonzero value that would round to a false zero widens precision", () => {
  // 0.04 rounds to "0.0" at 1dp but is a real, nonzero value.
  assert.equal(formatFixedNonZero(0.04, 1), "0.04");
  assert.equal(formatFixedNonZero(-0.04, 1), "-0.04");
});

test("formatFixedNonZero: widens up to (decimals + 4) places for a value the cap can still resolve", () => {
  // 1dp cap reaches 5dp; 0.00003 is resolvable there without a false zero.
  assert.equal(formatFixedNonZero(0.00003, 1), "0.00003");
});

test("formatFixedNonZero: a value beyond the widening cap falls back to the original fixed string, never grows unbounded", () => {
  const widened = formatFixedNonZero(0.0000001, 1);
  assert.equal(widened, "0.0");
});
