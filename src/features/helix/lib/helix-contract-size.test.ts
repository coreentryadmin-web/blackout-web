import { test } from "node:test";
import assert from "node:assert/strict";
import {
  SHARES_PER_CONTRACT,
  contractSizeExact,
  contractSizeRounded,
} from "./helix-contract-size";

/**
 * These cases are the UNION of what the five duplicate derivations each tested separately, folded
 * into one place along with the live prints that motivated them. Keeping the evidence together is
 * the point: each copy had been written against a different real print, so no single one of them
 * was ever exercised against all of the cases the others had found.
 */

test("contractSizeExact backs contracts out of premium ÷ (fill × 100)", () => {
  // 100 contracts × $5.00 × 100 shares = $50,000
  assert.equal(contractSizeExact(50_000, 5), 100);
  // The live MRNA print: 8500 contracts at $17.50/share = $14,875,000.
  assert.equal(contractSizeExact(14_875_000, 17.5), 8500);
  assert.equal(contractSizeExact(512_640, 1.8), 2848);
});

test("contractSizeExact reproduces the print that looked like a units error and was not", () => {
  // $1,307,530,000 of SPX read as an obvious mistake and is arithmetically exact:
  // 14,000 × 100 × 933.95. A number being astonishing is not evidence that it is wrong.
  const c = contractSizeExact(1_307_530_000, 933.95);
  assert.ok(c != null);
  assert.ok(Math.abs(c - 14_000) < 0.5, `expected ~14000 contracts, got ${c}`);
});

test("contractSizeExact does NOT round — the OI counting argument depends on it", () => {
  // 10.5 contracts: 10.5 × 3 × 100 = 3150. The `size >= oi × 1.05` test in helix-position-intent
  // was measured against the unrounded quotient; rounding here would move that boundary.
  assert.equal(contractSizeExact(3150, 3), 10.5);
});

test("contractSizeRounded rounds to whole contracts — a fractional contract does not trade", () => {
  assert.equal(contractSizeRounded(3150, 3), 11);
  assert.equal(contractSizeRounded(12_500, 2.5), 50);
  // 1 contract × $1.20 × 100 = $120
  assert.equal(contractSizeRounded(120, 1.2), 1);
});

test("both return null rather than a fabricated zero, Infinity or NaN", () => {
  // Every one of these produces 0, Infinity or NaN when computed naively — and a print of
  // "0 contracts" compared against open interest would read as a real measurement.
  const degenerate: Array<[number | null | undefined, number | null | undefined]> = [
    [0, 5],
    [1000, 0],
    [1000, -1],
    [-1000, 5],
    [1000, undefined],
    [undefined, 5],
    [1000, null],
    [null, 5],
    [Number.NaN, 5],
    [1000, Number.NaN],
    [50_000, Number.POSITIVE_INFINITY],
    [Number.POSITIVE_INFINITY, 5],
  ];
  for (const [premium, fill] of degenerate) {
    assert.equal(contractSizeExact(premium, fill), null, `exact(${premium}, ${fill}) must be null`);
    assert.equal(
      contractSizeRounded(premium, fill),
      null,
      `rounded(${premium}, ${fill}) must be null`
    );
  }
});

test("a quotient under half a contract reports underivable, not zero contracts", () => {
  // 0.4 contracts. `Math.round` alone gives 0, and 0 is a measurement — of nothing that happened.
  const exact = contractSizeExact(120, 3);
  assert.ok(exact != null && exact < 0.5, `expected a sub-half quotient, got ${exact}`);
  assert.equal(contractSizeRounded(120, 3), null);
});

test("the two views agree: rounded is the rounding of exact, wherever exact exists", () => {
  for (const [premium, fill] of [
    [50_000, 5],
    [3150, 3],
    [14_875_000, 17.5],
    [512_640, 1.8],
    [12_500, 2.5],
  ] as Array<[number, number]>) {
    const exact = contractSizeExact(premium, fill)!;
    assert.equal(contractSizeRounded(premium, fill), Math.round(exact));
  }
});

test("SHARES_PER_CONTRACT is the only place 100 is asserted", () => {
  assert.equal(SHARES_PER_CONTRACT, 100);
  // Stated as an identity so the constant cannot drift away from the arithmetic above.
  assert.equal(contractSizeExact(7 * 4.25 * SHARES_PER_CONTRACT, 4.25), 7);
});
