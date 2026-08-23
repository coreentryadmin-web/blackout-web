import { test } from "node:test";
import assert from "node:assert/strict";
import {
  checkLabelCoherence,
  formatCoherenceReport,
  normalizeLabel,
  type LabeledValue,
} from "./spx-label-coherence";

const v = (
  surface: string,
  label: string,
  value: number | null,
  basis: string
): LabeledValue => ({ surface, label, value, basis });

test("agreeing values under one label are GREEN and reported as compared", () => {
  const report = checkLabelCoherence(
    [
      v("desk-header", "γ Flip", 7640, "gamma-flip:near-term:matrix"),
      v("ios-desk", "γ flip", 7642, "gamma-flip:near-term:matrix"),
    ],
    5
  );
  assert.equal(report.verdict, "GREEN");
  assert.equal(report.findings.length, 0);
  assert.equal(report.compared.length, 1);
  assert.equal(report.compared[0]!.spread, 2);
});

test("one label over two quantities that disagree is a COLLISION naming both bases", () => {
  // The real §5 shape: desk flip is the near-term aggregate, pin flip is 0DTE-only. Both correct,
  // both called "flip", 45 points apart.
  const report = checkLabelCoherence(
    [
      v("desk-header", "γ Flip", 7640, "gamma-flip:near-term:matrix"),
      v("pin-panel", "Gamma flip", 7685, "gamma-flip:0dte:oi"),
    ],
    5
  );
  assert.equal(report.verdict, "RED");
  const f = report.findings[0]!;
  assert.equal(f.kind, "label_collision");
  assert.equal(f.kind === "label_collision" && f.spread, 45);
  assert.ok(f.detail.includes("gamma-flip:0dte:oi"));
  assert.ok(f.detail.includes("split the label"), f.detail);
});

test("one label, ONE basis, disagreeing surfaces is a different message — staleness, not naming", () => {
  // Same quantity on two surfaces that drifted apart. Splitting the label would be the wrong fix,
  // so the finding must not suggest it.
  const report = checkLabelCoherence(
    [
      v("desk-header", "γ Flip", 7640, "gamma-flip:near-term:matrix"),
      v("gex-matrix", "γ Flip", 7700, "gamma-flip:near-term:matrix"),
    ],
    5
  );
  assert.equal(report.verdict, "RED");
  const f = report.findings[0]!;
  assert.ok(f.detail.includes("stale or wrong"), f.detail);
  assert.ok(!f.detail.includes("split the label"), "one basis — renaming is not the remedy");
});

test("distinct labels are NEVER compared — that is the sanctioned escape hatch", () => {
  // Exactly the state PR #2694 put max pain into: two genuinely different numbers, two labels.
  // A checker that flagged this would punish the fix.
  const report = checkLabelCoherence(
    [
      v("desk-header", "OI Max Pain", 7430, "max-pain:near-term:oi"),
      v("pin-panel", "EFF MAX PAIN", 7495, "max-pain:0dte:oi+volume"),
    ],
    5
  );
  assert.equal(report.findings.filter((f) => f.kind === "label_collision").length, 0);
  // Each label was seen once, so each is INSUFFICIENT — never GREEN, never RED.
  assert.equal(report.verdict, "INSUFFICIENT");
});

test("one quantity under two labels is the INVERSE defect and is caught", () => {
  const report = checkLabelCoherence(
    [
      v("desk-header", "γ Flip", 7640, "gamma-flip:near-term:matrix"),
      v("chart-banner", "Gamma pivot", 7641, "gamma-flip:near-term:matrix"),
    ],
    5
  );
  assert.equal(report.verdict, "RED");
  const dup = report.findings.find((f) => f.kind === "duplicate_naming");
  assert.ok(dup, "same basis under two labels must be reported");
  assert.ok(dup!.detail.includes("two findings where there is one"));
});

test("a single observed value is INSUFFICIENT, never GREEN — absence is not agreement", () => {
  // The property that decides whether this checker is worth having. A run where three of four
  // surfaces were down must not come back clean.
  const report = checkLabelCoherence([v("desk-header", "γ Flip", 7640, "gamma-flip:near-term:matrix")], 5);
  assert.equal(report.verdict, "INSUFFICIENT");
  assert.equal(report.findings[0]!.kind, "insufficient");
  assert.ok(report.findings[0]!.detail.includes("cannot corroborate itself"));
});

test("all-null values are INSUFFICIENT and say so, rather than reporting a spread of zero", () => {
  const report = checkLabelCoherence(
    [
      v("desk-header", "γ Flip", null, "gamma-flip:near-term:matrix"),
      v("gex-matrix", "γ Flip", null, "gamma-flip:near-term:matrix"),
    ],
    5
  );
  assert.equal(report.verdict, "INSUFFICIENT");
  assert.ok(report.findings[0]!.detail.includes("not observed on any surface"));
  assert.equal(report.compared.length, 0);
});

test("a real COLLISION outranks a co-occurring gap — verdict is RED, not INSUFFICIENT", () => {
  const report = checkLabelCoherence(
    [
      v("desk-header", "γ Flip", 7640, "gamma-flip:near-term:matrix"),
      v("gex-matrix", "γ Flip", 7700, "gamma-flip:near-term:matrix"),
      v("pin-panel", "Projected close", null, "pin:0dte:oi+volume"),
    ],
    5
  );
  assert.equal(report.verdict, "RED");
  assert.equal(report.findings.length, 2);
});

test("the tolerance boundary is inclusive — exactly at tolerance still agrees", () => {
  const at = checkLabelCoherence(
    [v("a", "X", 100, "b"), v("b", "X", 105, "b")],
    5
  );
  assert.equal(at.verdict, "GREEN");
  const over = checkLabelCoherence(
    [v("a", "X", 100, "b"), v("b", "X", 105.01, "b")],
    5
  );
  assert.equal(over.verdict, "RED");
});

test("NaN and Infinity are treated as absent, not as values", () => {
  const report = checkLabelCoherence(
    [
      v("a", "X", Number.NaN, "b"),
      v("b", "X", Number.POSITIVE_INFINITY, "b"),
      v("c", "X", 7640, "b"),
    ],
    5
  );
  // Only one usable value survives, so this is a gap — never a spread of Infinity.
  assert.equal(report.verdict, "INSUFFICIENT");
});

test("normalizeLabel compares the way a member reads, not the way === does", () => {
  assert.equal(normalizeLabel("γ Flip"), normalizeLabel("γ flip"));
  assert.equal(normalizeLabel("Max Pain"), normalizeLabel("max-pain"));
  assert.notEqual(normalizeLabel("Max Pain"), normalizeLabel("OI Max Pain"));
});

test("a greek SYMBOL and its spelled-out name are the same label to a reader", () => {
  // The false negative this closes: without symbol expansion "γ Flip" strips to "flip" and
  // "Gamma flip" to "gammaflip", so the two land in different groups and are never compared —
  // the checker would report INSUFFICIENT on precisely the collision it exists to catch.
  assert.equal(normalizeLabel("γ Flip"), normalizeLabel("Gamma Flip"));
  assert.equal(normalizeLabel("Δ Exposure"), normalizeLabel("delta exposure"));
  const report = checkLabelCoherence(
    [
      v("desk-header", "γ Flip", 7640, "gamma-flip:near-term:matrix"),
      v("pin-panel", "Gamma flip", 7685, "gamma-flip:0dte:oi"),
    ],
    5
  );
  assert.equal(report.verdict, "RED", "symbol and word must group together");
});

test("formatCoherenceReport leads with the verdict and lists both sides of the evidence", () => {
  const out = formatCoherenceReport(
    checkLabelCoherence(
      [
        v("desk-header", "γ Flip", 7640, "gamma-flip:near-term:matrix"),
        v("ios-desk", "γ flip", 7641, "gamma-flip:near-term:matrix"),
        v("pin-panel", "Projected close", null, "pin:0dte:oi+volume"),
      ],
      5
    )
  );
  assert.match(out, /^LABEL COHERENCE: INSUFFICIENT/);
  assert.match(out, /OK\s+γ Flip/);
  assert.match(out, /INSUFFICIENT .*Projected close/);
});
