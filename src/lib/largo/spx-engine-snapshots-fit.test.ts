import assert from "node:assert/strict";
import { test } from "node:test";
import type { SpxEngineSnapshotRow } from "@/features/spx/lib/spx-signal-log";
import { fitSpxEngineSnapshotsForModel } from "@/lib/largo/spx-engine-snapshots-fit";
import { LARGO_RESULT_CHAR_BUDGET } from "@/lib/largo/fit-tool-result";

function snapshot(i: number): SpxEngineSnapshotRow {
  return {
    id: i,
    observed_at: `2026-09-03T14:${String(i).padStart(2, "0")}:00.000Z`,
    session_date: "2026-09-03",
    phase: "WATCHING",
    action: "WATCHING",
    direction: "long",
    score: 70 + i,
    gates_passed: false,
    gates_blocks: [`Gate block ${i}: ${"detail ".repeat(20)}`],
    thesis: "x".repeat(400),
    as_of: `2026-09-03T14:${String(i).padStart(2, "0")}:00.000Z`,
  };
}

test("fitSpxEngineSnapshotsForModel caps rows and reports truncation", () => {
  const rows = Array.from({ length: 20 }, (_, i) => snapshot(i));
  const { fitted } = fitSpxEngineSnapshotsForModel(rows, 20);
  assert.ok(fitted.snapshots.length <= 15);
  assert.equal(fitted.total, 20);
  assert.equal(fitted.truncated, true);
});

test("fitSpxEngineSnapshotsForModel stays under Largo char budget for heavy gate blocks", () => {
  const rows = Array.from({ length: 20 }, (_, i) => snapshot(i));
  const { fitted } = fitSpxEngineSnapshotsForModel(rows, 20);
  assert.ok(JSON.stringify(fitted).length <= LARGO_RESULT_CHAR_BUDGET);
});

test("fitSpxEngineSnapshotsForModel passes through small histories untruncated", () => {
  const rows = Array.from({ length: 5 }, (_, i) => snapshot(i));
  const { fitted } = fitSpxEngineSnapshotsForModel(rows, 20);
  assert.equal(fitted.snapshots.length, 5);
  assert.equal(fitted.truncated, false);
});
