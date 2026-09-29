import test from "node:test";
import assert from "node:assert/strict";
import { executionVerdictForGating } from "./manage-sync.js";
import type { SwingManageVerdict } from "./manage.js";

const baseVerdict = (): SwingManageVerdict => ({
  action: "EXIT",
  rung: "expiry_risk",
  enforced: true,
  reason: "dte migration",
  dteMigration: { migrate: true, reason: "low dte" },
  rollIntent: { roll: true, reason: "valid thesis roll" },
});

test("executionVerdictForGating: intact thesis keeps original verdict", () => {
  const verdict = baseVerdict();
  const out = executionVerdictForGating(
    {
      id: 1,
      direction: "long",
      thesis_invalidation_px: 100,
    } as never,
    { underlyingPrice: 110 } as never,
    verdict,
  );
  assert.equal(out, verdict);
});

test("executionVerdictForGating: structural break forces CLOSE-not-ROLL (Q37)", () => {
  const out = executionVerdictForGating(
    {
      id: 1,
      direction: "long",
      thesis_invalidation_px: 100,
    } as never,
    { underlyingPrice: 95 } as never,
    baseVerdict(),
  );
  assert.equal(out.rung, "structural_stop");
  assert.equal(out.rollIntent.roll, false);
});

// BUG FOUND (Ask Largo standing mandate, 2026-09-20): this Q37 re-check calls the RAW
// structuralBreakFromSpot directly, bypassing the ex-dividend adjustment (Q39,
// ex-dividend-adjustment.ts) that manage.ts's structuralStopBroken applies when building the
// ORIGINAL verdict. So a LONG position that is a genuine roll candidate (still-valid thesis,
// expiry_risk gate, rollIntent.roll=true) can have its roll wrongly flipped to a CLOSE here on
// an ordinary ex-dividend session, purely because the mechanical ex-div gap pushed raw spot
// below the stop — exactly the false-breach Q39 exists to prevent, reintroduced one layer up at
// roll-execution time.
test("executionVerdictForGating (BUG): an ordinary ex-dividend gap must not force a false structural CLOSE on a LONG roll candidate", () => {
  const verdict = baseVerdict();
  const out = executionVerdictForGating(
    {
      id: 1,
      direction: "long",
      thesis_invalidation_px: 95,
    } as never,
    {
      // Raw spot 94 <= stop 95 looks broken, but this is an ex-div session with a $2 cash
      // dividend — the Q39-adjusted compare price is 94 + 2 = 96, which HOLDS the stop. The
      // primary verdict-building path (manage.ts's structuralStopBroken) would correctly see
      // this as NOT broken; this Q37 re-check must agree, not override the roll into a close.
      underlyingPrice: 94,
      exDividendSession: true,
      exDividendCash: 2,
    } as never,
    verdict,
  );
  assert.equal(out, verdict, "an ex-div-adjusted spot that holds the stop must not override the roll into a close");
});

test("executionVerdictForGating: ex-div data unavailable this cycle skips the LONG structural re-check (Q39 fail-safe), same as the primary path", () => {
  const verdict = baseVerdict();
  const out = executionVerdictForGating(
    {
      id: 1,
      direction: "long",
      thesis_invalidation_px: 95,
    } as never,
    {
      underlyingPrice: 94,
      exDividendDataUnavailable: true,
    } as never,
    verdict,
  );
  assert.equal(out, verdict, "an unverifiable ex-div read must not enforce a stop we can't confirm isn't a mechanical gap");
});
