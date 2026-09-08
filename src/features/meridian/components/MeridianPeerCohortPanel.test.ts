/**
 * Regression guard: the peer-reaction lens must gate on EITHER cohort having a count, and each
 * displayed stat must show its OWN count — not a single shared `(n=X)` borrowed from the other
 * cohort.
 *
 * `avgReactionPct`/`n` (settled-reaction cohort) and `beatRate`/`beatRateN` (EPS-graded cohort)
 * are independent: a print can be graded without its reaction having settled, or vice versa. The
 * bug this guards (fixed 2026-09-06): gating the whole lens on `reaction.n > 0` silently hid a
 * valid, gradable beat rate whenever a peer had zero settled reactions on file. Source-scanned
 * rather than rendered — this codebase has no React Testing Library harness for this component and
 * the bug is a data-flow/gating mismatch, not something that needs a DOM.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const src = readFileSync(join(process.cwd(), "src/features/meridian/components/MeridianPeerCohortPanel.tsx"), "utf8");

test("MeridianPeerCohortPanel: the reaction lens renders when EITHER cohort has a count, not just n", () => {
  const gate = src.match(/\{reaction && \(([^)]*)\) && \(/);
  assert.ok(gate, "expected to find the reaction lens's render gate");
  assert.match(
    gate[1],
    /reaction\.n > 0/,
    "gate must still check the settled-reaction cohort"
  );
  assert.match(
    gate[1],
    /reaction\.beatRateN > 0/,
    "gate must ALSO check the EPS-graded cohort — a peer with beatRateN>0 but n===0 must still render"
  );
});

test("MeridianPeerCohortPanel: the beat-rate stat shows its OWN count (beatRateN), not the reaction cohort's n", () => {
  assert.match(
    src,
    /beat \(n=\$\{reaction\.beatRateN\}\)/,
    "the beat-rate figure must be labeled with beatRateN, not n"
  );
});

test("MeridianPeerCohortPanel: the avg-reaction stat shows its OWN count (n), not the beat cohort's beatRateN", () => {
  assert.match(
    src,
    /\(n=\$\{reaction\.n\}\)/,
    "the avg-reaction figure must be labeled with n"
  );
});
