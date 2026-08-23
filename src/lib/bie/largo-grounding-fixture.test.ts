import assert from "node:assert/strict";
import test from "node:test";
import { auditLargoAnswerGrounding, LARGO_RUNTIME_CAUTION_MARKER } from "./verifier";
import { applyVerificationCaveat } from "@/lib/largo/turn-outcome";

test("auditLargoAnswerGrounding: self-test fixture flags invented targets below coverage threshold", () => {
  const answer =
    "SPX is at 5,842.30, the call wall sits at 5900 with $2.3M of premium, IV rank 47%. Targets 6100, 6200, 6300.";
  const toolResults: unknown[] = [
    { spot: 5842.31, call_wall: 5900, premium: 2_300_000 },
    { iv_rank: 47 },
  ];
  const { verification, shouldFlag } = auditLargoAnswerGrounding(answer, toolResults);
  assert.ok(verification.unverified.some((n) => Math.abs(n - 6100) < 1));
  assert.equal(shouldFlag, true);
});

/**
 * THIS TEST NEVER EXERCISED THE THING ITS NAME CLAIMS.
 *
 * Its fixture was `"SPX at 9999 with fake levels."` plus a hand-written footer. `extractNumericClaims`
 * finds exactly ONE claim there (9999 — the footer's own "5" and "6" are bare ints <= 31 and are not
 * claims), while `shouldFlag` requires `total >= 4`. So it short-circuited on the threshold and never
 * reached `alreadyDisclosed` at all: it passed, and would have passed identically with the disclosure
 * check deleted outright. A guard that cannot fail is not a guard.
 *
 * Rebuilt so it actually reaches the branch — four-plus untraceable claims so the low-coverage
 * threshold IS crossed, and the footer produced by the REAL `applyVerificationCaveat` rather than a
 * hand-copied string. Hand-copying is what let the old fixture go on asserting a footer format the
 * producer had long since stopped emitting.
 */
test("auditLargoAnswerGrounding: skips answers that already carry the runtime caution footer", () => {
  const ungrounded = "SPX at 9999.5 with 8888.25 resistance, 77.7% call share and $6543.21 premium.";
  const toolResults = [{ spot: 5900 }];

  // Precondition: WITHOUT the footer this answer must flag, else the assertion below proves nothing.
  const bare = auditLargoAnswerGrounding(ungrounded, toolResults);
  assert.ok(bare.verification.total >= 4, `fixture must carry >= 4 claims, got ${bare.verification.total}`);
  assert.equal(bare.shouldFlag, true, "an ungrounded answer with no footer must be flagged");

  // WITH the footer the runtime actually appends, the cron must not re-flag it.
  const disclosed = applyVerificationCaveat(ungrounded, bare.verification);
  assert.ok(disclosed.includes(LARGO_RUNTIME_CAUTION_MARKER), "the producer must emit the marker the auditor seeks");
  assert.equal(auditLargoAnswerGrounding(disclosed, toolResults).shouldFlag, false);
});

test("auditLargoAnswerGrounding: does not false-flag list markers like '- 8 alerts'", () => {
  const answer = "Flow tape:\n- 8 alerts · $272K total · 181 fills";
  const toolResults = [{ alerts: 8, premium: 272_000, fills: 181 }];
  const { shouldFlag } = auditLargoAnswerGrounding(answer, toolResults);
  assert.equal(shouldFlag, false);
});

test("auditLargoAnswerGrounding: does not parse '$80 max pain' as $80M", () => {
  const answer = "Near-the-money: $80 max pain is the magnet.";
  const toolResults = [{ max_pain: 80 }];
  const { shouldFlag } = auditLargoAnswerGrounding(answer, toolResults);
  assert.equal(shouldFlag, false);
});
