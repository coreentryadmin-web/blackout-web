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
