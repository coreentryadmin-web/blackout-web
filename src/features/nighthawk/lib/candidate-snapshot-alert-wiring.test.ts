import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Source-inspection regression guard (2026-09-20 audit follow-up, extended 2026-09-21 for #30's
// bearish-posture-shadow call site): every one of the six
// `insertNighthawkCandidateSnapshots(...).catch(...)` call sites in candidates.ts/edition-builder.ts
// must call alertCandidateSnapshotWriteFailure from inside its catch block, so a real future write
// failure is never silent again. A full behavioral test of all six would require mocking the
// entire multi-thousand-line buildEveningEdition pipeline for the three inline (non-extracted) call
// sites -- this direct source check is the cheap, precise substitute: it fails the instant any of
// the six loses its alert call, without needing to stand up that machinery. The three call sites
// that live in their own named functions (recordDiscoveryStageSnapshots,
// recordScoringStageSnapshots, recordStageRejectionSnapshots) get a real behavioral test too, in
// their own test files -- this file exists specifically to also cover the three inline sites
// (governor-cut, rank_final, bearish-posture-shadow) that behavioral testing can't reach cheaply.

function readSource(file: string): string {
  return readFileSync(fileURLToPath(new URL(file, import.meta.url)), "utf8");
}

function catchBlockFor(src: string, anchor: string): string {
  const start = src.indexOf(anchor);
  assert.ok(start >= 0, `anchor not found: ${anchor}`);
  // Every one of the five catch blocks closes within a few lines -- slice a generous window
  // rather than parsing braces, matching this repo's own established source-inspection idiom
  // (see db-nighthawk-candidate-snapshot.test.ts).
  return src.slice(start, start + 400);
}

test("candidates.ts: discovery-stage snapshot write failure calls alertCandidateSnapshotWriteFailure", () => {
  const src = readSource("./candidates.ts");
  assert.match(src, /import \{ alertCandidateSnapshotWriteFailure \} from "\.\/candidate-snapshot-alert";/);
  const block = catchBlockFor(src, "failed to write discovery-stage candidate snapshots");
  assert.match(block, /alertCandidateSnapshotWriteFailure\("discovery", editionFor, err\)/);
});

test("edition-builder.ts: scoring/rank_governor-stage snapshot write failure calls alertCandidateSnapshotWriteFailure with the real stage", () => {
  const src = readSource("./edition-builder.ts");
  assert.match(src, /import \{ alertCandidateSnapshotWriteFailure \} from "\.\/candidate-snapshot-alert";/);
  const block = catchBlockFor(src, "failed to write ${stage}-stage candidate snapshots");
  assert.match(block, /alertCandidateSnapshotWriteFailure\(stage, editionFor, err\)/);
});

test("edition-builder.ts: rejected-stage snapshot write failure calls alertCandidateSnapshotWriteFailure", () => {
  const src = readSource("./edition-builder.ts");
  const block = catchBlockFor(src, "failed to write rejected-stage candidate snapshots");
  assert.match(block, /alertCandidateSnapshotWriteFailure\("rejected", editionFor, err\)/);
});

test("edition-builder.ts: governor-cut snapshot write failure calls alertCandidateSnapshotWriteFailure", () => {
  const src = readSource("./edition-builder.ts");
  const block = catchBlockFor(src, "governor-cut candidate snapshot write failed");
  assert.match(block, /alertCandidateSnapshotWriteFailure\("rejected:cross_edition_governor", editionFor, err\)/);
});

test("edition-builder.ts: rank_final snapshot write failure calls alertCandidateSnapshotWriteFailure", () => {
  const src = readSource("./edition-builder.ts");
  const block = catchBlockFor(src, "failed to write rank_final candidate snapshots");
  assert.match(block, /alertCandidateSnapshotWriteFailure\("rank_final", editionFor, err\)/);
});

test("edition-builder.ts: bearish-posture-shadow snapshot write failure calls alertCandidateSnapshotWriteFailure", () => {
  const src = readSource("./edition-builder.ts");
  const block = catchBlockFor(src, "failed to write bearish-posture-shadow candidate snapshot");
  assert.match(block, /alertCandidateSnapshotWriteFailure\("bearish_posture_shadow", editionFor, err\)/);
});

test("all six call sites use insertNighthawkCandidateSnapshots().catch() -- never awaited into the critical path", () => {
  const candidatesSrc = readSource("./candidates.ts");
  const editionSrc = readSource("./edition-builder.ts");
  const combined = candidatesSrc + editionSrc;
  const voidInsertCalls = combined.match(/void insertNighthawkCandidateSnapshots\(/g) ?? [];
  assert.equal(voidInsertCalls.length, 6, "expected exactly 6 fire-and-forget snapshot-write call sites");
  // None of the six may be preceded by `await` -- a plain string search for "await
  // insertNighthawkCandidateSnapshots" (as opposed to "void insertNighthawkCandidateSnapshots")
  // would mean a write got threaded into the critical path.
  assert.doesNotMatch(combined, /await insertNighthawkCandidateSnapshots\(/);
});
