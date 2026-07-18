import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluateMacroHardBlock } from "./macro-hard-block";

test("evaluateMacroHardBlock: CPI 08:30 blocks 08:25 ET", () => {
  const r = evaluateMacroHardBlock(
    [{ event: "CPI", time: "08:30", date: "2026-07-13", country: "US" }],
    8 * 60 + 25,
    "2026-07-13"
  );
  assert.equal(r.blocked, true);
  assert.match(String(r.reason), /Macro hard block/);
});

test("evaluateMacroHardBlock: outside window passes", () => {
  const r = evaluateMacroHardBlock(
    [{ event: "CPI", time: "08:30", date: "2026-07-13", country: "US" }],
    10 * 60,
    "2026-07-13"
  );
  assert.equal(r.blocked, false);
});
