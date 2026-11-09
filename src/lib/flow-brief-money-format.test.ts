import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { moneyShort, sharesShort } from "./flow-brief-money-format";

// Regression for the "round-first-then-promote" money-formatter defect class (already
// fixed in ~20 other call sites across the repo, e.g. src/lib/helix-discord-format.ts's
// moneyShort). The OLD inline formatting in src/app/api/market/flow-brief/route.ts
// picked a fixed K/M unit by comparing the RAW, unrounded value against a threshold,
// then rounded it INSIDE that unit's own branch — so a value just under a 1000x
// boundary rounded UP past 1000 without the label being promoted:
//   (999_600 / 1000).toFixed(0)      -> "1000" rendered "$1000K" instead of "$1.0M"
//   (999_950_000 / 1e6).toFixed(1)   -> "1000.0" rendered "$1000.0M" instead of "$1.0B"
//   (1_999_750 / 1000).toFixed(0)    -> "2000" rendered "2000K shares" instead of "2.0M shares"
//
// Run with:
//   node --import tsx --experimental-test-module-mocks --test \
//     src/lib/flow-brief-money-format.test.ts
describe("flow-brief moneyShort/sharesShort — round-first-then-promote", () => {
  test("K->M boundary: a premium just under $1M promotes to M, not $1000K", () => {
    assert.equal(moneyShort(999_600), "$1.0M");
  });

  test("M->B boundary: a total just under $1B promotes to B, not $1000.0M", () => {
    assert.equal(moneyShort(999_950_000), "$1.0B");
  });

  test("values comfortably inside a unit are unaffected by the fix", () => {
    assert.equal(moneyShort(500_000), "$500K");
    assert.equal(moneyShort(23_400_000), "$23.4M");
    assert.equal(moneyShort(1_500_000_000), "$1.5B");
    assert.equal(moneyShort(950), "$950");
  });

  test("sharesShort K->M boundary: a block just under 2,000,000 shares promotes to M", () => {
    assert.equal(sharesShort(1_999_750), "2.0M");
  });

  test("sharesShort values comfortably inside a unit are unaffected by the fix", () => {
    assert.equal(sharesShort(450_000), "450K");
    assert.equal(sharesShort(3_200_000), "3.2M");
  });
});
