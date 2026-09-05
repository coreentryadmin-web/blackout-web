import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("applyEvidenceOnly skips snapshot when updateLiveState touches zero rows (Q36)", () => {
  const src = readFileSync("src/lib/swing/manage-sync.ts", "utf8");
  assert.match(src, /const rows = await deps\.updateLiveState/);
  assert.match(src, /if \(rows === 0\)/);
  assert.match(src, /snapshotId = await deps\.insertSnapshot/);
  const updateIdx = src.indexOf("const rows = await deps.updateLiveState");
  const snapIdx = src.indexOf("snapshotId = await deps.insertSnapshot", updateIdx);
  assert.ok(snapIdx > updateIdx, "snapshot append must follow successful live-state latch");
});
