import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { unverifiedTurn, verifyClaims, auditLargoAnswerGrounding } from "@/lib/bie/verifier";
import { applyVerificationCaveat } from "@/lib/largo/turn-outcome";

/**
 * COVERAGE OVER ZERO CLAIMS IS UNDEFINED, NEVER 1 — AND THE FIX HAD THREE SURVIVORS.
 *
 * `coverage` is `verified / total`. At `total === 0` that is `0/0`, and inventing `1` advertises a
 * data-less answer as perfectly grounded — the fabricated certainty `LARGO-PRODUCT-CONTRACT.md`
 * forbids, because a score a product cannot calibrate is compared against another lane's MEASURED
 * one and corrupts cross-product ranking silently.
 *
 * #2626 fixed that at the source in `verifyClaims`. **Three hand-written copies of the forbidden
 * shape survived it** in `largo-terminal.ts`'s error paths — `{ total: 0, verified: 0, coverage: 1,
 * unverified: [] }` — and one of them (the non-streaming internal-error response) LEAVES THE
 * PROCESS. They compiled because the field is legitimately `number | null`, so nothing objected.
 *
 * Two guards, because the two failure modes are different: a behavioural one that pins what an
 * unverifiable turn actually reports, and a source one that pins that the literal cannot come back.
 * The literal is what regressed last time, so it needs a check that reads the file.
 */

const TERMINAL = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "..", "largo-terminal.ts"),
  "utf8"
);
/** Comments explain the defect and quote the forbidden shape on purpose — strip them first. */
const CODE = TERMINAL.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");

test("an unverifiable turn reports coverage NULL, not 1", () => {
  const v = unverifiedTurn();
  assert.equal(v.coverage, null, "0/0 is undefined — 1 advertises a data-less answer as fully grounded");
  assert.equal(v.total, 0);
  assert.equal(v.verified, 0);
  assert.deepEqual(v.unverified, []);
});

test("REGRESSION: no `coverage: 1` literal survives anywhere in the turn pipeline", () => {
  assert.doesNotMatch(
    CODE,
    /coverage:\s*1\b/,
    "a hand-written coverage:1 is the exact shape #2626 removed — construct it with unverifiedTurn()"
  );
});

test("the error paths construct it, rather than each writing the shape out", () => {
  // Three call sites: two logClaudeTurn calls and the returned payload on the non-streaming
  // internal-error path. Counting them pins that a fourth error path cannot quietly hand-roll one.
  const uses = CODE.match(/unverifiedTurn\(\)/g) ?? [];
  assert.equal(uses.length, 3, `expected 3 constructed verifications, found ${uses.length}`);
});

test("consumers treat null as NOT-APPLICABLE — never as a low OR high score", () => {
  const v = unverifiedTurn();
  // The caveat must not fire: there is nothing to caveat, and firing would tell a member that
  // figures "could not be traced" in an answer that contains no figures.
  const text = "**Verdict** — I hit an internal error before I could finish this answer.";
  assert.equal(applyVerificationCaveat(text, v), text, "no claims means no grounding caveat");
});

test("the honest shape agrees with what verifyClaims itself returns on a claimless answer", () => {
  // If these two ever disagree, one of them is lying about the same situation.
  const fromVerifier = verifyClaims("No numbers here at all.", [123, 456]);
  assert.equal(fromVerifier.coverage, null);
  assert.deepEqual(
    { total: fromVerifier.total, verified: fromVerifier.verified, coverage: fromVerifier.coverage },
    { total: unverifiedTurn().total, verified: unverifiedTurn().verified, coverage: unverifiedTurn().coverage }
  );
});

test("a claimless answer is not flagged by the cron either — null is not a low score", () => {
  // shouldFlag requires coverage != null && < threshold. A null must not be coerced to 0 and
  // reported as 0% grounded, which would flood the audit with data-less error turns.
  assert.equal(auditLargoAnswerGrounding("I hit an internal error.", []).shouldFlag, false);
});
