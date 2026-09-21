import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { fmtOptionUsd, fmtPremium, fmtPriceLevel } from "./fmt-money";

describe("fmt-money", () => {
  it("returns an em-dash for null/non-finite", () => {
    assert.equal(fmtPremium(null), "—");
    assert.equal(fmtPremium(NaN), "—");
    assert.equal(fmtPremium(Infinity), "—");
  });

  it("keeps sign outside the currency glyph", () => {
    assert.equal(fmtPremium(-1_200_000), "-$1.2M");
    assert.equal(fmtPremium(-4_100), "-$4.1K");
    assert.equal(fmtPremium(-50), "-$50");
  });

  it("checks billions before millions", () => {
    assert.equal(fmtPremium(5_000_000_000), "$5.0B");
    assert.equal(fmtPremium(1_200_000_000), "$1.2B");
  });

  it("formats millions to 1 decimal", () => {
    assert.equal(fmtPremium(38_200_000), "$38.2M");
  });

  it("keeps 1 decimal below $10K, whole K at/above $10K", () => {
    assert.equal(fmtPremium(1_400), "$1.4K");
    assert.equal(fmtPremium(9_900), "$9.9K");
    assert.equal(fmtPremium(22_100), "$22K");
    assert.equal(fmtPremium(456_700), "$457K");
  });

  it("formats sub-$1K as whole dollars", () => {
    assert.equal(fmtPremium(500), "$500");
    assert.equal(fmtPremium(0), "$0");
  });
});

describe("fmtOptionUsd", () => {
  it("returns an em-dash for null/undefined/non-finite", () => {
    assert.equal(fmtOptionUsd(null), "—");
    assert.equal(fmtOptionUsd(undefined), "—");
    assert.equal(fmtOptionUsd(NaN), "—");
    assert.equal(fmtOptionUsd(Infinity), "—");
  });

  it("never prefixes a sign — a premium price is never a signed delta", () => {
    assert.equal(fmtOptionUsd(6.18), "$6.18");
    assert.equal(fmtOptionUsd(0), "$0.00");
  });

  it("agrees with roundFloats' rounding on the exact half-cent boundaries where plain toFixed(2) does not — live repro: AAPL position #37's mark disagreed with itself across the same API response (Position section '$6.17' vs the response's own roundFloats'd briefContentKey.mark '6.18') because the markdown formatter used plain toFixed(2)", () => {
    // Sanity: plain toFixed(2) really does disagree with roundFloats-style rounding on these —
    // if a future JS engine changes float behavior and this assertion starts failing, the bug
    // this test guards against may no longer reproduce the same way and the test should be
    // revisited, not silently adjusted to match a new toFixed output.
    assert.equal((6.175).toFixed(2), "6.17", "environment assumption changed — revisit this test");
    assert.equal((6.725).toFixed(2), "6.72", "environment assumption changed — revisit this test");

    assert.equal(fmtOptionUsd(6.175), "$6.18");
    assert.equal(fmtOptionUsd(6.725), "$6.73");
    assert.equal(fmtOptionUsd(6.165), "$6.17");
    assert.equal(fmtOptionUsd(6.715), "$6.72");
  });

  it("matches src/lib/round-floats.ts's roundFloats() byte-for-byte on the same raw number", () => {
    // roundFloats() is the canonical rounding every play-brief API route wraps its JSON response
    // in. fmtOptionUsd formats a value baked into markdown TEXT before roundFloats ever runs, so
    // it must independently reproduce the identical rounding rather than relying on the route's
    // own pass to fix it up — that pass cannot reach inside an already-built string.
    const roundFloatsStyle = (n: number) => (Math.round(n * 100) / 100).toFixed(2);
    for (const n of [6.175, 6.725, 6.165, 6.715, 7499.360000000001, 1.005, 2.675, 0.005]) {
      assert.equal(fmtOptionUsd(n), `$${roundFloatsStyle(n)}`);
    }
  });
});

describe("fmtPriceLevel", () => {
  it("returns an em-dash for null/undefined/non-finite", () => {
    assert.equal(fmtPriceLevel(null), "—");
    assert.equal(fmtPriceLevel(undefined), "—");
    assert.equal(fmtPriceLevel(NaN), "—");
    assert.equal(fmtPriceLevel(Infinity), "—");
  });

  it("never prefixes a $ — a bare price LEVEL (spot/wall/flip/pin), not a dollar amount", () => {
    assert.equal(fmtPriceLevel(152.04), "152.04");
    assert.equal(fmtPriceLevel(0), "0.00");
  });

  it(
    "THIRD OCCURRENCE of fmtOptionUsd's own rounding-mismatch bug class (2026-09-12), now at bare " +
      "price levels — live repro: SPCX's swing play-brief (2026-09-21) read 'Spot **152.03**' in " +
      "the narrative text (plain toFixed(2)) while envelope.levels/structureLadder carried the " +
      "number 152.04 (roundFloats' Math.round(n*100)/100) for the SAME underlying spot value in " +
      "the SAME response",
    () => {
      // Sanity: plain toFixed(2) really does disagree with roundFloats-style rounding on these —
      // see fmtOptionUsd's own sibling test for why this assumption is asserted, not assumed.
      assert.equal((152.035).toFixed(2), "152.03", "environment assumption changed — revisit this test");
      assert.equal((6.175).toFixed(2), "6.17", "environment assumption changed — revisit this test");

      assert.equal(fmtPriceLevel(152.035), "152.04");
      assert.equal(fmtPriceLevel(6.175), "6.18");
      assert.equal(fmtPriceLevel(6.725), "6.73");
    },
  );

  it("matches src/lib/round-floats.ts's roundFloats() byte-for-byte on the same raw number", () => {
    const roundFloatsStyle = (n: number) => (Math.round(n * 100) / 100).toFixed(2);
    for (const n of [152.035, 6.175, 6.725, 7499.360000000001, 1.005, 2.675, 0.005]) {
      assert.equal(fmtPriceLevel(n), roundFloatsStyle(n));
    }
  });
});
