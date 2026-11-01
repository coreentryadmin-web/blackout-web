// BUG (found live 2026-11-01, discovery-lane audit, round 319): `ratioNum` in `polygon.ts`
// (the shared coercion helper backing EVERY field of `fetchPolygonFinancialRatios` — pe_ratio,
// roe, debt_to_equity, current_ratio, price_to_sales, dividend_yield, price, etc.) used
// `Number(v)` with no null/undefined guard. `Number(null) === 0`, which IS finite, so a field the
// upstream Polygon ratios API reports as explicit JSON `null` — its documented convention for "not
// computable for this ticker" (e.g. no debt, a loss-making company's P/E, a non-dividend payer's
// yield) — silently became the NUMBER ZERO instead of staying absent. That is the exact
// measured-zero-conflated-with-absence failure shape this repo's own CLAUDE.md names under
// "Data-correctness notes learned", and it is a real, observable downstream defect: Night Hawk's
// `passesFundamentalSanity` (scorer.ts) reads `ratios.current_ratio` with a bare `cr != null && cr
// < 1` check and flags "current ratio 0.00 (<1, working-capital squeeze)" for a ticker whose
// current_ratio was simply MISSING from the API, not actually squeezed — a false sanity-check
// demotion driven entirely by this coercion bug, not by real fundamentals.
//
// Every sibling "parse an unknown field to number-or-null" helper in this SAME file already
// guards this exact case — `shapeBenzingaStructuredEarnings`'s and
// `shapeBenzingaCorporateGuidance`'s shared `num()` closures use
// `v != null && Number.isFinite(Number(v)) ? Number(v) : null`, and `latestIndicator`
// (fetchTickerEma/Rsi) uses `v != null ? Number(v) : null` — `ratioNum` was the one holdout
// missing the `v != null` guard before coercing.
import assert from "node:assert/strict";
import test from "node:test";
import { ratioNum } from "./polygon";

test("ratioNum: explicit null (Polygon's 'not computable' convention) stays null, never becomes 0", () => {
  assert.equal(ratioNum(null), null, "null must mean absent, not the number zero");
});

test("ratioNum: undefined (missing field) stays null", () => {
  assert.equal(ratioNum(undefined), null);
});

test("ratioNum: a genuine zero ratio is preserved (not confused with the null case)", () => {
  assert.equal(ratioNum(0), 0);
  assert.equal(ratioNum("0"), 0);
});

test("ratioNum: a real finite number/string passes through unchanged", () => {
  assert.equal(ratioNum(24.5), 24.5);
  assert.equal(ratioNum("13.2"), 13.2);
});

test("ratioNum: non-numeric garbage still returns null (not NaN)", () => {
  assert.equal(ratioNum("not-a-number"), null);
  assert.equal(ratioNum({}), null);
});
