import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require_ = createRequire(import.meta.url);
const {
  routeBucketVerdict, panelVerdict, freshnessVerdict, overallVerdict, DOMINANT_BUCKET_PCT,
  newBadgeVerdict, coverageNoteVerdict, directionLabelVerdict, expiryBucketVerdict, parseCompactNumber,
} =
  require_("./helix-ui-audit-eval.cjs");

test("routeBucketVerdict fails the §9.8 signature — one bucket holding the whole tape", () => {
  // The live panel before the fix: a single OTHER bar at 98.8%.
  const v = routeBucketVerdict({ present: true, buckets: { OTHER: { count: 4939, pct: 99 } } });
  assert.equal(v.status, "FAIL");
  assert.match(v.detail, /OTHER at 99%/);
});

test("routeBucketVerdict passes a real distribution", () => {
  const v = routeBucketVerdict({
    present: true,
    buckets: { UNREPORTED: { count: 3500, pct: 70 }, REPEAT: { count: 1439, pct: 29 }, FLOOR: { count: 58, pct: 1 } },
  });
  assert.equal(v.status, "PASS");
  assert.match(v.detail, /3 buckets/);
});

test("UNREPORTED is not exempt — it swallowing the tape means the rule-carrying feed died", () => {
  const v = routeBucketVerdict({ present: true, buckets: { UNREPORTED: { count: 5000, pct: 100 } } });
  assert.equal(v.status, "FAIL");
});

test("a panel that painted but parsed no bucket is HARNESS, never PASS", () => {
  const v = routeBucketVerdict({ present: true, buckets: {} });
  assert.equal(v.status, "HARNESS");
});

test("a missing panel is a product FAIL, distinct from an unreadable one", () => {
  assert.equal(routeBucketVerdict({ present: false }).status, "FAIL");
  assert.equal(routeBucketVerdict(null).status, "FAIL");
});

test("the dominance threshold fires before the panel degrades all the way back", () => {
  const justUnder = routeBucketVerdict({
    present: true,
    buckets: { OTHER: { count: 1, pct: DOMINANT_BUCKET_PCT - 1 }, FLOOR: { count: 1, pct: 6 } },
  });
  assert.equal(justUnder.status, "PASS");
  const atThreshold = routeBucketVerdict({
    present: true,
    buckets: { OTHER: { count: 1, pct: DOMINANT_BUCKET_PCT }, FLOOR: { count: 1, pct: 5 } },
  });
  assert.equal(atThreshold.status, "FAIL");
});

test("freshnessVerdict checks that an age is SHOWN, not that the tape is fresh", () => {
  // Off-hours staleness is the correct render. A harness that failed here would cry wolf every
  // weekend and then be ignored — which is worse than not having it.
  assert.equal(freshnessVerdict("3h ago").status, "PASS");
  assert.equal(freshnessVerdict("42s ago").status, "PASS");
  assert.equal(freshnessVerdict("7m ago").status, "PASS");
});

test("freshnessVerdict fails when no age is rendered at all", () => {
  const v = freshnessVerdict(null);
  assert.equal(v.status, "FAIL");
  assert.match(v.detail, /cannot tell how old/);
});

test("freshnessVerdict reports unparseable text as HARNESS, not as a product fault", () => {
  assert.equal(freshnessVerdict("just now").status, "HARNESS");
  assert.equal(freshnessVerdict("—").status, "HARNESS");
});

test("overallVerdict: a real failure is the headline even when another viewport was unreadable", () => {
  assert.equal(overallVerdict([{ verdict: "FAIL" }, { verdict: "HARNESS" }]), "FAIL");
});

test("overallVerdict: one unreadable viewport makes the whole run unproven", () => {
  // A half-blind run must not certify the product on the strength of the half that worked.
  assert.equal(overallVerdict([{ verdict: "PASS" }, { verdict: "HARNESS" }]), "HARNESS");
});

test("overallVerdict: PASS only when every viewport actually passed", () => {
  assert.equal(overallVerdict([{ verdict: "PASS" }, { verdict: "PASS" }]), "PASS");
  assert.equal(overallVerdict([]), "HARNESS");
  assert.equal(overallVerdict(null), "HARNESS");
});

// ── The distinction this harness got wrong on its own first live run ─────────────────────────
// A `startsWith` locator found Net Premium (no kicker) and missed Route Breakdown, whose container
// text begins with its kicker "◇ execution". The harness reported three PRODUCT failures against a
// page that had rendered all three panels correctly. `inBodyText` is what separates "did it
// render" from "can the harness see it", and these tests keep the two from re-merging.

test("rendered-but-unlocatable is HARNESS, not a product failure", () => {
  const v = routeBucketVerdict({ present: false, inBodyText: true });
  assert.equal(v.status, "HARNESS");
  assert.match(v.detail, /locator/);
});

test("genuinely absent is still a product FAIL", () => {
  const v = routeBucketVerdict({ present: false, inBodyText: false });
  assert.equal(v.status, "FAIL");
  assert.match(v.detail, /did not render/);
});

test("panelVerdict makes the same three-way split", () => {
  assert.equal(panelVerdict({ present: true, hasContent: true }, "Net Premium").status, "PASS");
  assert.equal(panelVerdict({ present: true, hasContent: false }, "Net Premium").status, "FAIL");
  assert.equal(panelVerdict({ present: false, inBodyText: true }, "Net Premium").status, "HARNESS");
  assert.equal(panelVerdict({ present: false, inBodyText: false }, "Net Premium").status, "FAIL");
  assert.equal(panelVerdict(null, "Net Premium").status, "FAIL");
});

test("a panel allowed to be empty by design does not fail when absent", () => {
  // ExpiryConcentration returns null when every horizon bucket is under its $50k render floor.
  // Failing on that would report correct behaviour as a defect on every quiet tape.
  const v = panelVerdict({ present: false, inBodyText: false }, "Expiry Concentration", { mayBeEmpty: true });
  assert.equal(v.status, "PASS");
  assert.match(v.detail, /legitimate/);
  // ...but unlocatable is STILL a harness fault, even for a may-be-empty panel.
  assert.equal(
    panelVerdict({ present: false, inBodyText: true }, "Expiry Concentration", { mayBeEmpty: true }).status,
    "HARNESS"
  );
});

test("a parse whose shares do not sum to ~100 is HARNESS, never PASS", () => {
  // The false-PASS this guard exists for: every bucket parsed as 0% by a backtracking regex,
  // against a panel the screenshot showed at OTHER 100%. Nothing dominated, so nothing failed.
  const v = routeBucketVerdict({
    present: true,
    buckets: { SWEEP: { count: 3, pct: 0 }, FLOOR: { count: 58, pct: 0 }, OTHER: { count: 4939, pct: 0 } },
  });
  assert.equal(v.status, "HARNESS");
  assert.match(v.detail, /parse is broken/);
});

test("the sum guard tolerates ordinary rounding but not a broken parse", () => {
  const rounding = routeBucketVerdict({
    present: true,
    buckets: { A: { count: 1, pct: 33 }, B: { count: 1, pct: 33 }, C: { count: 1, pct: 33 } },
  });
  assert.equal(rounding.status, "PASS", "99% is ordinary integer rounding");
  const doubled = routeBucketVerdict({
    present: true,
    buckets: { A: { count: 1, pct: 90 }, B: { count: 1, pct: 90 } },
  });
  assert.equal(doubled.status, "HARNESS", "180% means rows were counted twice");
});

test("the real pre-fix panel still reports the §9.8 signature, not a parse fault", () => {
  // OTHER 100% / FLOOR 0% — measured on production 2026-08-22, sums to 100, so the sum guard
  // passes it through to the dominance check, which is what must fire.
  const v = routeBucketVerdict({
    present: true,
    buckets: { OTHER: { count: 496, pct: 100 }, FLOOR: { count: 3, pct: 0 } },
  });
  assert.equal(v.status, "FAIL");
  assert.match(v.detail, /OTHER at 100%/);
});

// ── Post-fix recalibration: dominance is two different facts ─────────────────────────────────
// The threshold was written when one bucket at ~100% could only mean the §9.8 vocabulary bug.
// After that fix shipped it fired on the FIRST post-deploy run — `UNREPORTED at 95%` — and called
// it "the §9.8 signature". Wrong: the panel's pct is a share of PREMIUM, and the routeless index
// feed carries ~92% of tape premium, so 95% is the honest number.

test("UNREPORTED leading on premium share is NOT a regression when other buckets are present", () => {
  // The real post-deploy production reading, 2026-08-23, both viewports.
  const v = routeBucketVerdict({
    present: true,
    buckets: {
      UNREPORTED: { count: 397, pct: 95 },
      REPEAT: { count: 99, pct: 4 },
      FLOOR: { count: 3, pct: 0 },
      SWEEP: { count: 1, pct: 0 },
    },
  });
  assert.equal(v.status, "PASS");
  assert.match(v.detail, /Not a regression/);
});

test("UNREPORTED as the ONLY bucket still fails — the rule-carrying feed has died", () => {
  const v = routeBucketVerdict({ present: true, buckets: { UNREPORTED: { count: 500, pct: 100 } } });
  assert.equal(v.status, "FAIL");
  assert.match(v.detail, /stopped arriving/);
});

test("OTHER dominating is still the §9.8 signature and still fails", () => {
  // The pre-fix production reading. A vocabulary regression must never be softened into a pass.
  const v = routeBucketVerdict({
    present: true,
    buckets: { OTHER: { count: 496, pct: 100 }, FLOOR: { count: 3, pct: 0 } },
  });
  assert.equal(v.status, "FAIL");
  assert.match(v.detail, /§9.8 signature/);
});

test("any OTHER-family bucket dominating still fails, named plainly", () => {
  const v = routeBucketVerdict({
    present: true,
    buckets: { REPEAT: { count: 490, pct: 97 }, FLOOR: { count: 10, pct: 3 } },
  });
  assert.equal(v.status, "FAIL");
  assert.match(v.detail, /REPEAT at 97%/);
});

// ── Surfaces shipped 2026-08-23 ────────────────────────────────────────────────────────────────

const row = (over) => ({ oi: "884", prem: "$1.4M", fill: "2.75", newLabel: null, ...over });

test("newBadgeVerdict: a badge on a row whose OI reads '—' is FABRICATION", () => {
  // 70% of the live tape reports no open interest. A badge there would be the single most-repeated
  // lie the feature could tell, so it is the first thing checked.
  const v = newBadgeVerdict([row({ oi: "—", newLabel: "NEW 5.7×" }), row({ newLabel: "NEW" })]);
  assert.equal(v.status, "FAIL");
  assert.match(v.detail, /never examined|fabricated/);
});

test("newBadgeVerdict: the ratio must agree with the row's OWN columns", () => {
  // 5000 contracts ($1.4M / 2.75 / 100) against OI 884 is 5.7x — the real production row.
  assert.equal(newBadgeVerdict([row({ newLabel: "NEW 5.7×" })]).status, "PASS");
  // Same row, badge claiming 50x: badge and columns disagree on screen.
  const bad = newBadgeVerdict([row({ newLabel: "NEW 50×" })]);
  assert.equal(bad.status, "FAIL");
  assert.match(bad.detail, /disagree/);
});

test("newBadgeVerdict: display rounding is tolerated, a wrong ratio is not", () => {
  // Prem and Fill are ROUNDED for display, so exact equality would fail on correct rows. The
  // tolerance covers what that rounding can produce and nothing more.
  assert.equal(newBadgeVerdict([row({ prem: "$1.4M", fill: "2.75", oi: "884", newLabel: "NEW 6.0×" })]).status, "PASS");
  assert.equal(newBadgeVerdict([row({ prem: "$1.4M", fill: "2.75", oi: "884", newLabel: "NEW 9.0×" })]).status, "FAIL");
});

test("newBadgeVerdict: a bare NEW carries no ratio, and no badges at all is NOT_EXERCISED", () => {
  assert.equal(newBadgeVerdict([row({ newLabel: "NEW" })]).status, "PASS");
  const none = newBadgeVerdict([row(), row()]);
  assert.equal(none.status, "NOT_EXERCISED", "a page with no qualifying print is not a failure");
  assert.equal(newBadgeVerdict(null).status, "HARNESS");
});

test("parseCompactNumber reads the tape's own formats, and refuses '—'", () => {
  assert.equal(parseCompactNumber("$1.4M"), 1_400_000);
  assert.equal(parseCompactNumber("1.5K"), 1500);
  assert.equal(parseCompactNumber("884"), 884);
  assert.equal(parseCompactNumber("2.75"), 2.75);
  for (const bad of ["—", "-", "", null, undefined, "n/a"]) {
    assert.equal(parseCompactNumber(bad), null, `${String(bad)} is not a number`);
  }
});

test("coverageNoteVerdict: silence is correct only when everything was scannable", () => {
  assert.equal(coverageNoteVerdict(null, 0).status, "PASS");
  assert.equal(coverageNoteVerdict("Scanned 103 of 500 prints — 397 (SPX, SPY) …", 397).status, "PASS");
  // The defect §9.0 fixed: prints skipped, and nothing says so.
  assert.equal(coverageNoteVerdict(null, 397).status, "FAIL");
  // The inverse: a note claiming skipped prints on a fully scannable tape.
  assert.equal(coverageNoteVerdict("Scanned 1 of 500 prints …", 0).status, "FAIL");
  // Without the population, the note's absence cannot be judged — that is a harness gap, not a pass.
  assert.equal(coverageNoteVerdict(null, undefined).status, "HARNESS");
});

test("directionLabelVerdict: the legacy wording fails even on an empty radar", () => {
  // This half works off-hours, which is why it is separated from the populated-state check.
  assert.equal(directionLabelVerdict({ legacyPresent: true, newLabels: [], radarEmpty: true }).status, "FAIL");
  const empty = directionLabelVerdict({ legacyPresent: false, newLabels: [], radarEmpty: true });
  assert.equal(empty.status, "NOT_EXERCISED");
  assert.match(empty.detail, /legacy wording is gone/);
  assert.equal(directionLabelVerdict({ legacyPresent: false, newLabels: ["BULLISH"], radarEmpty: false }).status, "PASS");
  // Populated but no label found: suspect the locator, not the product.
  assert.equal(directionLabelVerdict({ legacyPresent: false, newLabels: [], radarEmpty: false }).status, "HARNESS");
});

test("expiryBucketVerdict: expired prints belong in 0DTE, not 'This week'", () => {
  const dte = [-2, -1, 0, 3, 5, 12, 40, 90];
  const correct = { "0DTE": 3, "This week": 2, Monthly: 1, LEAPS: 2 };
  const v = expiryBucketVerdict(correct, dte);
  assert.equal(v.status, "PASS");
  assert.match(v.detail, /2 expired print\(s\) correctly in 0DTE/);
  // The pre-#2673 shape: the two negatives fell through into "This week".
  const buggy = { "0DTE": 1, "This week": 4, Monthly: 1, LEAPS: 2 };
  const bad = expiryBucketVerdict(buggy, dte);
  assert.equal(bad.status, "FAIL");
  assert.match(bad.detail, /0DTE panel=1 tape=3/);
});

test("expiryBucketVerdict: the DTE column must come from the RENDERED rows", () => {
  // Comparing against the wider API window produced a false FAIL once (RUN-LOG 2026-08-23). With no
  // rendered column supplied the answer is HARNESS, never a product verdict.
  assert.equal(expiryBucketVerdict({ "0DTE": 11 }, []).status, "HARNESS");
  assert.equal(expiryBucketVerdict({}, [1, 2, 3]).status, "NOT_EXERCISED");
});

test("overallVerdict: NOT_EXERCISED does not poison the rollup", () => {
  // A market-closed page legitimately cannot populate the split-flow radar. Reporting HARNESS for
  // that would make every off-hours run look broken and teach its reader to skip the report.
  assert.equal(overallVerdict([{ verdict: "PASS" }, { verdict: "NOT_EXERCISED" }]), "PASS (partial)");
  assert.equal(overallVerdict([{ verdict: "PASS" }, { verdict: "PASS" }]), "PASS");
  assert.equal(overallVerdict([{ verdict: "NOT_EXERCISED" }, { verdict: "FAIL" }]), "FAIL");
  assert.equal(overallVerdict([{ verdict: "NOT_EXERCISED" }, { verdict: "HARNESS" }]), "HARNESS");
});

test("coverageNoteVerdict: 'cannot be counted here' is not the same as 'nobody counted'", () => {
  // null  = this layout offers no marker (mobile flow-cards) -> NOT_EXERCISED
  // undefined = the caller forgot to measure                 -> HARNESS
  // Collapsing them flagged the instrument on every mobile run.
  assert.equal(coverageNoteVerdict(null, null).status, "NOT_EXERCISED");
  assert.equal(coverageNoteVerdict(null, undefined).status, "HARNESS");
  assert.equal(coverageNoteVerdict(null, 0).status, "PASS");
});
