import { test } from "node:test";
import assert from "node:assert/strict";
import {
  maxPainForExpiryFromHeatmap,
  maxPainForExpiryStrict,
  summarizeHeatmapGammaByExpiry,
} from "./meridian-gex-reads";
import { buildOpexPinAccuracy } from "./meridian-analytics-core";

test("maxPainForExpiryFromHeatmap prefers scoped expiry over front max_pain", () => {
  const hm = {
    max_pain: 5500,
    max_pain_by_expiry: { "2026-08-15": 5480, "2026-08-22": 5520 },
  };
  assert.equal(maxPainForExpiryFromHeatmap(hm as never, "2026-08-22"), 5520);
  assert.equal(maxPainForExpiryFromHeatmap(hm as never, "2026-09-01"), 5500);
});

test("summarizeHeatmapGammaByExpiry pins dominant expiry from cells", () => {
  const cells = {
    "5500": { "2026-08-15": 100, "2026-08-22": 10 },
    "5510": { "2026-08-15": 50, "2026-08-22": 5 },
    "5520": { "2026-08-22": 200 },
  };
  const summary = summarizeHeatmapGammaByExpiry(cells, "2026-08-15");
  assert.ok(summary);
  assert.equal(summary!.pinned_expiry, "2026-08-22");
  assert.ok(summary!.pinned_pct! > 50);
  assert.match(summary!.headline, /2026-08-22/);
});

test("summarizeHeatmapGammaByExpiry returns null on empty cells", () => {
  assert.equal(summarizeHeatmapGammaByExpiry({}, "2026-08-15"), null);
});

test("maxPainForExpiryStrict refuses the whole-book fallback for a settled expiry", () => {
  // The defect this guards: a PAST OpEx has no strikes in the current chain, so
  // max_pain_by_expiry never carries it and the fallback stamped TODAY's book-wide max pain
  // onto that date as if it had been measured then. Measured live 2026-08-21: all six prior
  // OpEx rows (2026-02-20 … 2026-07-17) came back with an identical max_pain of 7685.
  const hm = {
    max_pain: 7685,
    max_pain_by_expiry: { "2026-08-21": 7700 },
  };

  // A settled expiry the book no longer breaks out → no number, rather than today's number.
  assert.equal(maxPainForExpiryStrict(hm as never, "2026-07-17"), null);
  assert.equal(maxPainForExpiryStrict(hm as never, "2026-02-20"), null);

  // The expiry the book DOES carry still resolves normally.
  assert.equal(maxPainForExpiryStrict(hm as never, "2026-08-21"), 7700);
});

test("maxPainForExpiryFromHeatmap keeps its fallback — the current-event path is unchanged", () => {
  // Deliberate asymmetry: for the CURRENT/upcoming event "the book's max pain" and "this
  // expiry's max pain" describe the same live chain, so the fallback is defensible there.
  // This pins that the strict variant did not silently change the existing caller.
  const hm = { max_pain: 7685, max_pain_by_expiry: { "2026-08-21": 7700 } };
  assert.equal(maxPainForExpiryFromHeatmap(hm as never, "2026-09-18"), 7685);
  assert.equal(maxPainForExpiryFromHeatmap(hm as never, "2026-08-21"), 7700);
});

test("both variants reject a missing heatmap, a blank date and a non-positive max pain", () => {
  const zeroed = { max_pain: 0, max_pain_by_expiry: { "2026-08-21": 0 } };
  for (const fn of [maxPainForExpiryStrict, maxPainForExpiryFromHeatmap]) {
    assert.equal(fn(null, "2026-08-21"), null);
    assert.equal(fn(undefined, "2026-08-21"), null);
    assert.equal(fn({ max_pain: 7685 } as never, ""), null);
    // A zero/absent max pain is not a strike — opexPinHeld would divide by it.
    assert.equal(fn(zeroed as never, "2026-08-21"), null);
  }
});

test("a settled expiry yields null WITH a reason — the panel does not light up, and says why", () => {
  // Verified live 2026-08-21: the SPX heatmap's max_pain_by_expiry carried 54 keys, EARLIEST
  // 2026-08-21. fetchGexHeatmap prunes settled expiries by design, so every prior OpEx date is
  // absent and strict returns null for all of them.
  //
  // This pins the honest consequence, which the first draft of this fix overstated: strict
  // replaces a WRONG number (today's book-wide 7685 stamped on six different past dates) with an
  // absence. It does NOT restore pin accuracy — `buildOpexPinAccuracy` skips a row whose max_pain
  // is null, so `graded` stays 0 and the headline stays "insufficient graded history". Recovering
  // the metric needs open interest snapshotted AT each expiry; the live chain cannot answer a
  // question about a settlement that already happened.
  const liveShapedHeatmap = {
    max_pain: 7685,
    max_pain_by_expiry: { "2026-08-21": 7700, "2026-09-18": 7650 },
  };
  for (const settled of ["2026-02-20", "2026-03-20", "2026-04-17", "2026-05-15", "2026-07-17"]) {
    assert.equal(
      maxPainForExpiryStrict(liveShapedHeatmap as never, settled),
      null,
      `${settled} settled — strict must not fall back to the book-wide number`
    );
  }
  assert.equal(maxPainForExpiryStrict(liveShapedHeatmap as never, "2026-08-21"), 7700);
});

test("buildOpexPinAccuracy grades nothing when max_pain is null — stated, not assumed", () => {
  // The exact post-fix state, asserted so nobody reads the PR as "the panel now works".
  const rows = ["2026-07-17", "2026-05-15", "2026-04-17"].map((date) => ({
    date,
    spx_session_pct: 0.14,
    spx_next_day_pct: -0.19,
    max_pain: null,
    spx_close: 7457.69,
    pin_held: null,
    max_pain_basis: null,
    max_pain_unavailable: {
      reason: "settled_expiry_not_in_live_chain",
      what_is_missing: "historical open interest is not stored",
      retryable: false,
    },
  }));
  const acc = buildOpexPinAccuracy(rows as never);
  assert.equal(acc.graded, 0);
  assert.equal(acc.accuracy_pct, null);
  assert.match(acc.headline, /insufficient graded history/);
});
