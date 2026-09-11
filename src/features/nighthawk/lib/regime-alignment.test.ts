import assert from "node:assert/strict";
import { test } from "node:test";
import { regimeAlignmentNote } from "@/features/nighthawk/lib/regime-alignment";

test("regimeAlignmentNote: matching regimes report intact, tone up", () => {
  const note = regimeAlignmentNote("RISK_ON", "RISK_ON");
  assert.equal(note?.tone, "up");
  assert.match(note!.label, /Still RISK_ON/);
});

test("regimeAlignmentNote: matching case-insensitively still reports intact", () => {
  const note = regimeAlignmentNote("risk_on", "RISK_ON");
  assert.equal(note?.tone, "up");
});

test("regimeAlignmentNote: a real drift reports both regimes, tone warn", () => {
  const note = regimeAlignmentNote("RISK_ON", "RISK_OFF");
  assert.equal(note?.tone, "warn");
  assert.match(note!.label, /Published in RISK_ON/);
  assert.match(note!.label, /market now RISK_OFF/);
});

test("regimeAlignmentNote: never renders when either side is missing", () => {
  assert.equal(regimeAlignmentNote(null, "RISK_ON"), null);
  assert.equal(regimeAlignmentNote("RISK_ON", null), null);
  assert.equal(regimeAlignmentNote(undefined, undefined), null);
  assert.equal(regimeAlignmentNote("", "RISK_ON"), null);
  assert.equal(regimeAlignmentNote("RISK_ON", "  "), null);
});
