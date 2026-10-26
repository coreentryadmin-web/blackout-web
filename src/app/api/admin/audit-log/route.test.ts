import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("./route.ts", import.meta.url), "utf8");

// Regression (DISCOVERY-lane input-validation sweep): `parseInt(..., 10)` on a non-numeric
// `?limit=` value (or an absent one where `searchParams.get` returns null, coerced to the
// default string) returns NaN, which `Math.min(100, NaN)` passes straight through — NaN is
// neither less than nor greater than anything, so every Math.min/max comparison against it is
// false. That NaN then reaches `LIMIT $N` in the raw Postgres query below, which Postgres
// rejects outright (LIMIT must be a non-negative integer), turning a malformed query param into
// a 502 instead of the stated "default 50" behavior every sibling limit param in this repo
// (market/vector/pick-closures/board, market/ticker-search, cron/alert-outcome-sync) falls back
// to via a `Number.isFinite` guard.
test("limit falls back to 50 on malformed (non-numeric) input, not NaN, via a Number.isFinite guard", () => {
  assert.doesNotMatch(
    src,
    /parseInt\(url\.searchParams\.get\("limit"\)/,
    "limit must not be parsed with bare parseInt — it has no NaN/bounds guard"
  );
  assert.match(
    src,
    /Number\.isFinite\(rawLimit\)/,
    "limit must be guarded with Number.isFinite so a non-numeric param can't survive as NaN"
  );
});

test("limit is clamped to [1, 100] so a negative or over-cap value can't reach the LIMIT clause unchecked", () => {
  assert.match(
    src,
    /Math\.min\(100, Math\.max\(1, Math\.round\(rawLimit\)\)\)/,
    "limit must be bounded on both sides, not just capped at 100"
  );
});
