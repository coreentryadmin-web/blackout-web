import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require_ = createRequire(import.meta.url);
const { routeBucketVerdict, panelVerdict, freshnessVerdict, overallVerdict, DOMINANT_BUCKET_PCT } =
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
