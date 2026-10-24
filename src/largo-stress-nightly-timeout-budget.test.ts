import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { bankStats } from "../scripts/largo-stress-banks.mjs";

/**
 * ROOT CAUSE OF #5485 (2026-09-24, run 35996805744) — a genuine `cancelled` timeout, not a
 * misread of an old issue. `largo-stress-nightly.yml`'s scheduled/rotated-bank path has run at
 * `LARGO_STRESS_CONCURRENCY=2` since PR #4073 (2026-09-05, deliberately lowered from 5 to reduce
 * Clerk/UW 429 storms) — but the job's own `timeout-minutes` for that path was never revisited,
 * and the banks are NOT evenly sized: `bankStats()` reports bank3 at 193 questions vs 100-121 for
 * the other three, nearly double. Measured live throughput at concurrency=2 (run 36239606676,
 * 2026-09-26, bank1, 109 questions, full completion before any cancellation): the live phase ran
 * 11:41:51 -> 12:17:30, 35.65 minutes for 109 questions = ~0.327 min/question. Bank3 at that same
 * rate projects to ~63 minutes — comfortably over the 45-minute budget this test guards, and
 * exactly what was observed: run 35996805744 (bank3) was killed by `timeout-minutes` at 44m45s,
 * mid-sweep, with the job step itself ending `cancelled`.
 *
 * This is a DIFFERENT root cause from the misleading in-repo comment that preceded this fix
 * ("Scheduled: one rotated bank ... at concurrency 5 — fits 45m") — concurrency for this path has
 * actually been 2, not 5, since #4073, and nobody updated either the comment or the timeout
 * budget to match. Bumping concurrency back to 5 is NOT the fix here: both the bank1 (2026-09-26)
 * and bank3 (2026-09-24) runs already show live http-429 SKIPs during their tail even at
 * concurrency=2, so raising concurrency would make the rate-limiting #4073 was written to fix
 * worse, not better. The fix is headroom: the job-level timeout for a SINGLE rotated bank must be
 * large enough to cover the LARGEST bank at the CONFIGURED concurrency, with real margin — not
 * reverting the concurrency choice that caused #4073's prior fix to exist.
 */

const WORKFLOW = join(import.meta.dirname, "..", ".github", "workflows", "largo-stress-nightly.yml");

/** Measured 2026-09-26 (run 36239606676, bank1, concurrency=2, completed in full — see above). */
const MEASURED_MIN_PER_QUESTION_AT_CONCURRENCY_2 = 0.327;

function singleBankTimeoutMinutes(src: string): number {
  // The ternary's non-"all" (scheduled / manual-single-bank) branch is the literal after `|| `.
  const m = src.match(/timeout-minutes:\s*\$\{\{[^}]*\|\|\s*(\d+)\s*\}\}/);
  assert.ok(m, "expected a ternary timeout-minutes expression with an `|| <N>` fallback branch");
  return Number(m![1]);
}

test("single-bank scheduled timeout covers the LARGEST bank at concurrency=2 with real margin", () => {
  const src = readFileSync(WORKFLOW, "utf8");
  const timeoutMinutes = singleBankTimeoutMinutes(src);
  const stats = bankStats();
  const largestBank = Math.max(stats.bank1, stats.bank2, stats.bank3, stats.bank4);
  const projectedMinutes = largestBank * MEASURED_MIN_PER_QUESTION_AT_CONCURRENCY_2;
  // Require real margin (not just "greater than"), since observed throughput already varies
  // run to run (401/429 cascades burn wall clock without producing a scored answer).
  const MARGIN_MULTIPLIER = 1.15;
  assert.ok(
    timeoutMinutes >= projectedMinutes * MARGIN_MULTIPLIER,
    `timeout-minutes (${timeoutMinutes}) does not cover the largest bank (${largestBank} questions, ` +
      `projected ${projectedMinutes.toFixed(1)}min at the measured concurrency=2 rate, ` +
      `+15% margin = ${(projectedMinutes * MARGIN_MULTIPLIER).toFixed(1)}min) — this is exactly how ` +
      `#5485 (run 35996805744, bank3, cancelled at 44m45s) happened`
  );
});

test("concurrency for the scheduled/single-bank path stays at 2 (the #4073 429 mitigation is not reverted)", () => {
  const src = readFileSync(WORKFLOW, "utf8");
  // Both non-"all" branches (explicit manual bank, and the rotated scheduled default) must keep
  // concurrency=2 -- only `bank=all`'s dedicated 360-minute window uses concurrency=5. Match each
  // `elif`/`else` block individually rather than splitting on the "all" branch's own marker,
  // which left that branch's own concurrency=5 line in the remainder and produced a false RED.
  const branchRe = /(?:elif[^\n]*\n|else\n)\s*(?:BANK=.*\n\s*)?echo "bank=[^"]*"[^\n]*\n\s*echo "concurrency=(\d+)"/g;
  const concurrencyValues = [...src.matchAll(branchRe)].map((m) => Number(m[1]));
  assert.ok(concurrencyValues.length >= 2, "expected both non-all (elif/else) branches to set concurrency");
  for (const c of concurrencyValues) {
    assert.equal(c, 2, "raising concurrency on the per-bank path re-introduces the #4073 429 storms");
  }
});
