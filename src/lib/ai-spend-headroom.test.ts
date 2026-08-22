import assert from "node:assert/strict";
import test from "node:test";

import { aiSpendHeadroomIssue, evaluateAiSpendHeadroom } from "./ai-spend-headroom";

test("plenty of headroom is ok and raises no issue", () => {
  const h = evaluateAiSpendHeadroom({ spentUsd: 10, ceilingUsd: 100 });
  assert.equal(h.verdict, "ok");
  assert.equal(h.fraction, 0.1);
  assert.equal(h.remainingUsd, 90);
  assert.equal(aiSpendHeadroomIssue(h), null);
});

test("crossing the warn fraction warns with the dollars left, not just a percentage", () => {
  const h = evaluateAiSpendHeadroom({ spentUsd: 80, ceilingUsd: 100 });
  assert.equal(h.verdict, "warning");
  assert.equal(h.remainingUsd, 20);
  assert.match(h.reason, /\$20\.00 left/);
  assert.equal(aiSpendHeadroomIssue(h)?.severity, "warning");
});

test("at or over the ceiling is tripped and CRITICAL", () => {
  for (const spent of [100, 137.42]) {
    const h = evaluateAiSpendHeadroom({ spentUsd: spent, ceilingUsd: 100 });
    assert.equal(h.verdict, "tripped", `spent=${spent}`);
    assert.equal(h.remainingUsd, 0);
    assert.equal(aiSpendHeadroomIssue(h)?.severity, "critical");
  }
});

// The distinction that matters most. An unarmed kill switch is not headroom — collapsing the two
// is how a guardrail stays unarmed forever, because the console reads green either way.
test("an unarmed ceiling is DISABLED, never ok, and still raises", () => {
  for (const ceiling of [null, undefined, 0, -5, Number.NaN]) {
    const h = evaluateAiSpendHeadroom({ spentUsd: 10, ceilingUsd: ceiling as number | null });
    assert.equal(h.verdict, "disabled", `ceiling=${String(ceiling)}`);
    assert.notEqual(h.verdict, "ok");
  }
  const issue = aiSpendHeadroomIssue(evaluateAiSpendHeadroom({ spentUsd: 10, ceilingUsd: null }));
  assert.equal(issue?.severity, "warning");
  assert.match(issue!.detail, /NOT the same as having headroom/);
});

test("an unreadable ledger is UNKNOWN, never ok — the runaway case is when it cannot be read", () => {
  for (const spent of [null, undefined, Number.NaN, -1]) {
    const h = evaluateAiSpendHeadroom({ spentUsd: spent as number | null, ceilingUsd: 100 });
    assert.equal(h.verdict, "unknown", `spent=${String(spent)}`);
  }
  assert.equal(aiSpendHeadroomIssue(evaluateAiSpendHeadroom({ spentUsd: null, ceilingUsd: 100 }))?.severity, "warning");
});

test("the warn boundary is inclusive and configurable", () => {
  assert.equal(evaluateAiSpendHeadroom({ spentUsd: 75, ceilingUsd: 100 }).verdict, "warning");
  assert.equal(evaluateAiSpendHeadroom({ spentUsd: 74.99, ceilingUsd: 100 }).verdict, "ok");
  assert.equal(
    evaluateAiSpendHeadroom({ spentUsd: 50, ceilingUsd: 100, warnFraction: 0.5 }).verdict,
    "warning",
  );
});

test("zero spend against an armed ceiling is ok, not unknown", () => {
  const h = evaluateAiSpendHeadroom({ spentUsd: 0, ceilingUsd: 100 });
  assert.equal(h.verdict, "ok");
  assert.equal(h.fraction, 0);
});

test("the tripped message names the member-visible consequence", () => {
  // An operator reading the console must connect this to what members are being told.
  const h = evaluateAiSpendHeadroom({ spentUsd: 100, ceilingUsd: 100 });
  assert.match(h.reason, /refusing new queries|ET midnight/);
});
