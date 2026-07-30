import { test } from "node:test";
import assert from "node:assert/strict";
import { thesisProgress01, volCollapsedFromIvRanks, addEligibleFromProgress } from "./thesis-progress.ts";

test("thesisProgress01 LONG: 0 at entry, 1 at target, mid-span fractional", () => {
  assert.equal(thesisProgress01({ direction: "long", entryPx: 100, targetPx: 110, spot: 100 }), 0);
  assert.equal(thesisProgress01({ direction: "long", entryPx: 100, targetPx: 110, spot: 110 }), 1);
  assert.equal(thesisProgress01({ direction: "long", entryPx: 100, targetPx: 110, spot: 105 }), 0.5);
});

test("thesisProgress01 SHORT: mirror of LONG", () => {
  assert.equal(thesisProgress01({ direction: "short", entryPx: 100, targetPx: 90, spot: 100 }), 0);
  assert.equal(thesisProgress01({ direction: "short", entryPx: 100, targetPx: 90, spot: 90 }), 1);
  assert.equal(thesisProgress01({ direction: "short", entryPx: 100, targetPx: 90, spot: 95 }), 0.5);
});

test("thesisProgress01: missing/degenerate → null (never fabricated 0)", () => {
  assert.equal(thesisProgress01({ direction: "long", entryPx: null, targetPx: 110, spot: 105 }), null);
  assert.equal(thesisProgress01({ direction: "long", entryPx: 100, targetPx: 100, spot: 105 }), null);
  assert.equal(thesisProgress01({ direction: "long", entryPx: 100, targetPx: 90, spot: 105 }), null); // target not past entry
});

test("volCollapsedFromIvRanks: ≥15pt crush → true; thin/missing → null", () => {
  assert.equal(volCollapsedFromIvRanks(40, 20), true);
  assert.equal(volCollapsedFromIvRanks(40, 30), false);
  assert.equal(volCollapsedFromIvRanks(0.4, 0.2), true); // 0–1 fraction tolerated
  assert.equal(volCollapsedFromIvRanks(40, null), null);
  assert.equal(volCollapsedFromIvRanks(null, 20), null);
});

test("addEligibleFromProgress: progressing + mark≥entry → true; unknown → null", () => {
  assert.equal(
    addEligibleFromProgress({ thesisProgress01: 0.6, entryPremium: 4, mark: 4.5 }),
    true,
  );
  assert.equal(
    addEligibleFromProgress({ thesisProgress01: 0.2, entryPremium: 4, mark: 5 }),
    false,
  );
  assert.equal(
    addEligibleFromProgress({ thesisProgress01: 0.8, entryPremium: 4, mark: 3 }),
    false,
  );
  assert.equal(
    addEligibleFromProgress({ thesisProgress01: null, entryPremium: 4, mark: 5 }),
    null,
  );
});
