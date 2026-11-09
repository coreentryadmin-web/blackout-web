import assert from "node:assert/strict";
import test from "node:test";
import { fmtMoney } from "./zerodte-board-format";

test("fmtMoney promotes a rounded-to-1000 K value to the M unit instead of overflowing", () => {
  // RED on the pre-fix body: (999_600 / 1_000).toFixed(0) === "1000" => "$1000K".
  assert.equal(fmtMoney(999_600), "$1.0M");
  assert.equal(fmtMoney(999_950), "$1.0M");
  // Exactly at the cutoff already took the M branch before this fix — unaffected, still correct.
  assert.equal(fmtMoney(1_000_000), "$1.0M");
});

test("fmtMoney formats ordinary magnitudes unaffected by the boundary fix", () => {
  assert.equal(fmtMoney(0), "$0");
  assert.equal(fmtMoney(500), "$500");
  assert.equal(fmtMoney(1_500), "$2K");
  assert.equal(fmtMoney(840_000), "$840K");
  assert.equal(fmtMoney(2_300_000), "$2.3M");
});

test("fmtMoney handles null/undefined/non-finite as the honest em-dash", () => {
  assert.equal(fmtMoney(null), "—");
  assert.equal(fmtMoney(undefined), "—");
  assert.equal(fmtMoney(NaN), "—");
  assert.equal(fmtMoney(Infinity), "—");
});

test("fmtMoney keeps the pre-existing negative-value convention untouched (not this fix's scope)", () => {
  assert.equal(fmtMoney(-500), "$-500");
  assert.equal(fmtMoney(-2_300_000), "$-2.3M");
  // The negative-side boundary case also promotes correctly (by magnitude).
  assert.equal(fmtMoney(-999_600), "$-1.0M");
});

test("fmtMoney promotes into a B unit instead of printing an overflowed 4-digit M label", () => {
  // RED on the pre-fix body: there is no B branch at all, so `abs >= 1_000_000` unconditionally
  // returns the M-unit string — a genuine >=$1B value (e.g. a whole-market 0DTE flow aggregate on
  // an extreme session) rendered as "$1250.0M" instead of "$1.3B", and a value that only ROUNDS up
  // into the billions at M's own 1dp precision (999_950_000) rendered the exact
  // round-first-then-promote overflow this file's own doc comment already describes for the K->M
  // boundary ("$1000.0M" instead of "$1.0B") — just one unit higher, and still unfixed.
  assert.equal(fmtMoney(1_250_000_000), "$1.3B");
  assert.equal(fmtMoney(999_950_000), "$1.0B");
  // Exactly at the cutoff already belongs in B — unaffected, still correct.
  assert.equal(fmtMoney(1_000_000_000), "$1.0B");
  // The negative-side boundary case also promotes correctly (by magnitude), matching this file's
  // existing sign-inside-the-glyph convention for every other unit.
  assert.equal(fmtMoney(-1_250_000_000), "$-1.3B");
  // A value comfortably inside the M tier, nowhere near the boundary, is unaffected.
  assert.equal(fmtMoney(45_000_000), "$45.0M");
});
