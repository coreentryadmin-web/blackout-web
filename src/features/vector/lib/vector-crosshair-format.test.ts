import { test } from "node:test";
import assert from "node:assert/strict";
import { fmtGex } from "./vector-crosshair-format";

test("fmtGex: K->M boundary promotes when the rounded quotient reaches 1000K", () => {
  // 999_600 / 1e3 = 999.6, which .toFixed(0) rounds UP to "1000" -- the pre-fix bug rendered the
  // literal "1000K" here instead of promoting to "1.0M".
  assert.equal(fmtGex(999_600), "1.0M");
  assert.equal(fmtGex(-999_600), "-1.0M");
});

test("fmtGex: M->B boundary promotes when the rounded quotient reaches 1000.0M", () => {
  // 999_950_000 / 1e6 = 999.95, which .toFixed(1) rounds UP to "1000.0" -- the pre-fix bug
  // rendered the literal "1000.0M" here instead of promoting to "1.0B".
  assert.equal(fmtGex(999_950_000), "1.0B");
  assert.equal(fmtGex(-999_950_000), "-1.0B");
  // A value just under THAT, still < 1e9, genuinely stays in M at its own 1dp precision.
  assert.equal(fmtGex(999_600_000), "999.6M");
});

test("fmtGex: values that genuinely stay under a boundary render in their own unit, unchanged", () => {
  assert.equal(fmtGex(500), "500");
  assert.equal(fmtGex(500_000), "500K");
  assert.equal(fmtGex(1_500_000), "1.5M");
  assert.equal(fmtGex(1_500_000_000), "1.5B");
  assert.equal(fmtGex(900_000), "900K");
  assert.equal(fmtGex(900_000_000), "900.0M");
});

test("fmtGex: values exactly at a boundary already rendered correctly and still do", () => {
  assert.equal(fmtGex(1_000_000), "1.0M");
  assert.equal(fmtGex(1_000_000_000), "1.0B");
  assert.equal(fmtGex(1_000), "1K");
});

test("fmtGex: zero and small magnitudes render as plain rounded integers", () => {
  assert.equal(fmtGex(0), "0");
  assert.equal(fmtGex(-42.7), "-43");
});
