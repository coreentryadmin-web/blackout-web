import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { fmtOptionUsd, fmtPct, fmtPremium, fmtPriceLevel } from "./fmt-money";

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

  it(
    "promotes a value that ROUNDS to 1000 of a unit into the next unit, never an " +
      "overflowed four-digit label — same bug class/shape as thermal-compact-matrix.ts's " +
      "fmtCompactHeatMoney (fixed 2026-10-25, PR #6686): abs/1e6 or abs/1e3 landing in " +
      "[999.95, 1000) rounds to '1000.0' at 1dp / 1000 at 0dp, which read as e.g. '$1000.0M' " +
      "or '$1000K' instead of promoting to the next unit",
    () => {
      assert.equal(fmtPremium(999_950_000), "$1.0B");
      assert.equal(fmtPremium(999_999_999), "$1.0B");
      assert.equal(fmtPremium(-999_960_000), "-$1.0B");
      assert.equal(fmtPremium(999_700), "$1.0M");
      assert.equal(fmtPremium(-999_700), "-$1.0M");
    },
  );
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

describe("fmtPct", () => {
  it("returns an em-dash for null/undefined/non-finite", () => {
    assert.equal(fmtPct(null), "—");
    assert.equal(fmtPct(undefined), "—");
    assert.equal(fmtPct(NaN), "—");
    assert.equal(fmtPct(Infinity), "—");
  });

  it("signs positive values with a leading +, never double-signs negatives", () => {
    assert.equal(fmtPct(2.3), "+2.3%");
    assert.equal(fmtPct(-4.9), "-4.9%");
    assert.equal(fmtPct(0), "0.0%");
  });

  it("honors a custom digits count", () => {
    assert.equal(fmtPct(2.347, 2), "+2.35%");
  });

  it(
    "FOURTH OCCURRENCE of fmtOptionUsd's/fmtPriceLevel's own rounding-mismatch bug class " +
      "(2026-10-08), now at PERCENTAGE/distance fields instead of dollar or price-level ones — " +
      "live repro: the swing play-brief structure ladder serializes `distancePct` through " +
      "roundFloats() (2dp, no keyDp override) and BieStructureLadder.tsx's fmtDist() then rounds " +
      "that ALREADY-2dp wire value to 1dp again (a genuine double round) — while the SAME " +
      "underlying rung's narrative prose called plain `n.toFixed(1)` directly on the untouched " +
      "raw float. For raw -4.94999: narrative read '-4.9%' (direct 1dp round) while the double-" +
      "rounded wire path read '-5.0%' (2dp-then-1dp) — two different percentages for one fact.",
    () => {
      // Sanity: plain toFixed(1) really does disagree with a round-to-2dp-then-round-to-1dp
      // path on this value — the double-rounding mechanism, not a one-off coincidence.
      assert.equal((-4.94999).toFixed(1), "-4.9", "environment assumption changed — revisit this test");
      assert.equal((Math.round(-4.94999 * 100) / 100).toFixed(1), "-5.0", "environment assumption changed — revisit this test");

      // fmtPct must agree with the SINGLE canonical round (matching what roundFloats would
      // produce if asked for 1dp directly), not with a value that already lost precision to an
      // intermediate 2dp pass.
      assert.equal(fmtPct(-4.94999, 1), "-4.9%");
    },
  );

  it("matches src/lib/round-floats.ts's roundFloats() byte-for-byte on the same raw number at 1dp", () => {
    // STALE FIXTURE, UPDATED 2026-10-26: this helper used to be a literal copy of the OLD, biased
    // `Math.round(n*factor)/factor` — which meant the `-1.05` entry below only ever asserted
    // self-consistency (fmtPct and this local copy shared the identical bug, so they agreed with
    // each other while BOTH were wrong) and never caught the real defect: -1.05 rounded to "-1.0%"
    // here while +1.05 rounded to "+1.1%", a magnitude asymmetry no test in this file ever
    // compared against the positive case directly. Now mirrors the FIXED production algorithm
    // (round by magnitude, then reapply sign) — see the dedicated symmetric-pair test below for
    // the explicit positive-vs-negative comparison this fixture alone could never catch.
    const roundFloatsStyle = (n: number) => {
      const r = (Math.sign(n) * Math.round(Math.abs(n) * 10)) / 10;
      const sign = r > 0 ? "+" : "";
      return `${sign}${r.toFixed(1)}%`;
    };
    for (const n of [2.347, -4.94999, 0.04, -0.03, 7499.36, 1.05, -1.05]) {
      assert.equal(fmtPct(n), roundFloatsStyle(n));
    }
  });

  // ── Sign-asymmetry fix (2026-10-26) — see this function's own header comment for the full
  // mechanism and live repro (Exec P&L entry $14.80/bid $14.60 -> raw -1.35% rendered "-1.3%"
  // while the identical +1.35% magnitude rendered "+1.4%"). The fixture above only ever compared
  // fmtPct against an equally-biased local copy of the old algorithm — it could never catch a
  // POSITIVE-vs-NEGATIVE magnitude mismatch. These tests do exactly that comparison directly.
  it("rounds a negative tie to the SAME magnitude as its positive mirror image, not a smaller one", () => {
    // Each pair verified (not assumed) to land on an exact floating-point tie at its own precision
    // — a value that merely LOOKS like a tie in decimal (e.g. 1.005 at 2dp) can actually sit
    // slightly UNDER .5 in double precision (1.005 is really 1.00499999999999989341...) and would
    // not exercise this bug at all.
    const tiePairs: Array<[number, number]> = [
      [1.05, 1], // -> ±1.1%
      [1.35, 1], // -> ±1.4% (the exact live Exec P&L repro magnitude)
      [0.25, 1], // -> ±0.3% (sub-1 tie)
      [2.5, 0], // -> ±3% (whole-number digits)
      [12.345, 2], // -> ±12.35%
    ];
    for (const [v, digits] of tiePairs) {
      const pos = fmtPct(v, digits);
      const neg = fmtPct(-v, digits);
      // pos is "+X", neg must be "-X" — same digits, opposite sign, never a smaller magnitude.
      assert.equal(neg, `-${pos.slice(1)}`, `fmtPct(${v}, ${digits})=${pos} vs fmtPct(${-v}, ${digits})=${neg} diverged in magnitude`);
    }

    // Pinned explicitly, not just via the loop above — this is the exact bug: fmtPct(-1.35, 1)
    // used to render "-1.3%" (old, biased toward a smaller magnitude) instead of "-1.4%" (fixed,
    // symmetric with fmtPct(1.35, 1) -> "+1.4%").
    assert.equal(fmtPct(1.35, 1), "+1.4%");
    assert.equal(fmtPct(-1.35, 1), "-1.4%");
    assert.equal(fmtPct(1.05, 1), "+1.1%");
    assert.equal(fmtPct(-1.05, 1), "-1.1%");
  });
});
