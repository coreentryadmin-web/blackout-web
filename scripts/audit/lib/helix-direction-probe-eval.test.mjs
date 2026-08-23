import { test } from "node:test";
import assert from "node:assert/strict";

import { coverageContractViolations } from "./helix-direction-probe-eval.mjs";

const SRC = new URL("../../../src/", import.meta.url).pathname;
// The REAL threshold. A copy here would be the exact defect #2731 was about.
const { MIN_READABLE_PCT_FOR_VERDICT } = await import(
  `${SRC}features/helix/lib/helix-direction-read.ts`
);

const row = (over) => ({ what: "ticker X", shipped_verdict: "bullish", readable_pct: 90, ...over });

test("today's live rows are clean — every sub-threshold row returns undetermined", () => {
  // Measured live 2026-08-23: SPX 0.1%, SPY 11%, MRNA 44.7%, Monthly 6.1%, LEAPS 3.2% — all
  // `undetermined`; SPXW 53.3% and TSLA 90.2% state a verdict, both above the gate.
  const live = [
    row({ what: "ticker SPX", shipped_verdict: "undetermined", readable_pct: 0.1 }),
    row({ what: "ticker SPY", shipped_verdict: "undetermined", readable_pct: 11 }),
    row({ what: "ticker MRNA", shipped_verdict: "undetermined", readable_pct: 44.7 }),
    row({ what: "horizon LEAPS", shipped_verdict: "undetermined", readable_pct: 3.2 }),
    row({ what: "ticker SPXW", shipped_verdict: "mixed", readable_pct: 53.3 }),
    row({ what: "ticker TSLA", shipped_verdict: "mixed", readable_pct: 90.2 }),
  ];
  assert.deepEqual(coverageContractViolations(live, MIN_READABLE_PCT_FOR_VERDICT), []);
});

test("a verdict stated below the gate IS a violation — the gate can go red", () => {
  // The whole point of the correction: this check must be capable of failing. If the coverage gate
  // were dropped in a refactor, SPX would state `bullish` off 0.1% readable premium and $4.0B of
  // net — and that must stop the run.
  const bad = row({ what: "ticker SPX", shipped_verdict: "bullish", readable_pct: 0.1 });
  const hits = coverageContractViolations([bad], MIN_READABLE_PCT_FOR_VERDICT);
  assert.equal(hits.length, 1);
  assert.equal(hits[0].what, "ticker SPX");
});

test("null coverage is not a violation — nothing was measured", () => {
  // A horizon carrying no premium reads null, never 0. "Nothing to read" must not be scored as
  // "read and violated".
  assert.deepEqual(
    coverageContractViolations([row({ shipped_verdict: "bullish", readable_pct: null })], MIN_READABLE_PCT_FOR_VERDICT),
    []
  );
});

test("exactly at the threshold is allowed; a hair below is not", () => {
  const at = row({ readable_pct: MIN_READABLE_PCT_FOR_VERDICT });
  const below = row({ readable_pct: MIN_READABLE_PCT_FOR_VERDICT - 0.1 });
  assert.deepEqual(coverageContractViolations([at], MIN_READABLE_PCT_FOR_VERDICT), []);
  assert.equal(coverageContractViolations([below], MIN_READABLE_PCT_FOR_VERDICT).length, 1);
});

test("rule DISAGREEMENT is never a violation, at any coverage", () => {
  // The condition the old gate failed on. These rows disagree with the legacy colour and are
  // perfectly contract-compliant; the probe must exit 0 on all of them.
  const disagreeing = [
    row({ shipped_verdict: "mixed", readable_pct: 97.7 }),
    row({ shipped_verdict: "undetermined", readable_pct: 0.1 }),
    row({ shipped_verdict: "bearish", readable_pct: 94.6 }),
  ];
  assert.deepEqual(coverageContractViolations(disagreeing, MIN_READABLE_PCT_FOR_VERDICT), []);
});

test("malformed rows are skipped rather than crashing the gate", () => {
  assert.deepEqual(coverageContractViolations([null, undefined, {}], MIN_READABLE_PCT_FOR_VERDICT), []);
  assert.deepEqual(
    coverageContractViolations([row({ readable_pct: Number.NaN })], MIN_READABLE_PCT_FOR_VERDICT),
    []
  );
  assert.deepEqual(coverageContractViolations(null, MIN_READABLE_PCT_FOR_VERDICT), []);
});
