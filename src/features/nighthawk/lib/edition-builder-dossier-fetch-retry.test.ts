import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Regression guard for a bug found 2026-10-20 (Ask Largo standing audit, live-reproduced on
// production): PR #6380 added a bounded retry meant to recover from Night Hawk Legacy's
// starved-dossier-scoring funnel (two, later confirmed four, consecutive recap-only nights), but
// the retry wrapped rescoreDossier()/scoreCandidate() -- a synchronous, pure function with zero
// network I/O -- instead of fetchAllDossiers, where all the real network I/O (UW flow, IV rank,
// positioning, tech, news, financials) actually happens. fetchTickerDossierWithWall returns null
// on its 45s per-ticker timeout and fetchAllDossiers silently drops nulls, so under the exact
// congestion scenario the retry was written for, `dossiers` ends up with ZERO keys before the old
// retry loop ever ran -- retrying a pure function over an empty object can never recover. Live
// evidence matched this exactly: the funnel reported `dossiers: 0`, not "20 attempted, 0 scored".
//
// A full behavioral test would require mocking the entire multi-thousand-line buildEveningEdition
// pipeline (checkpointing DB layer, candidate discovery, UW/Polygon dossier fetch, synthesis,
// critic) -- this repo's own established substitute for that cost, used elsewhere in this same
// file for the same reason (see candidate-snapshot-alert-wiring.test.ts's header), is a precise
// source-inspection regression check: it fails the instant the retry is moved back onto the wrong
// stage, without standing up that machinery.
function readSource(): string {
  return readFileSync(fileURLToPath(new URL("./edition-builder.ts", import.meta.url)), "utf8");
}

function sliceBetween(src: string, startAnchor: string, endAnchor: string): string {
  const start = src.indexOf(startAnchor);
  assert.ok(start >= 0, `start anchor not found: ${startAnchor}`);
  const end = src.indexOf(endAnchor, start);
  assert.ok(end >= 0, `end anchor not found after start: ${endAnchor}`);
  return src.slice(start, end);
}

test("edition-builder.ts: the bounded dossier retry re-checks the FETCH output (dossiers), not the scored list", () => {
  const src = readSource();
  const retryBlock = sliceBetween(
    src,
    "while (dossierFetchAttempt < MAX_DOSSIER_FETCH_ATTEMPTS",
    "dossierFetchAttempt += 1;\n    }"
  );
  assert.match(retryBlock, /Object\.keys\(dossiers\)\.length === 0/);
  assert.doesNotMatch(retryBlock, /scoredList\.length === 0/);
});

test("edition-builder.ts: fetchAllDossiers (the real network fetch) is INSIDE the retry loop body, so a retry actually re-fetches", () => {
  const src = readSource();
  const retryBlock = sliceBetween(
    src,
    "while (dossierFetchAttempt < MAX_DOSSIER_FETCH_ATTEMPTS",
    "dossierFetchAttempt += 1;\n    }"
  );
  // Both the checkpointing and non-checkpointing branches must call fetchAllDossiers from
  // inside the loop -- that's the actual network stage the old bug never retried.
  const fetchCalls = retryBlock.match(/await fetchAllDossiers\(/g) ?? [];
  assert.equal(fetchCalls.length, 2, "expected fetchAllDossiers called from both checkpointing branches inside the retry loop");
});

test("edition-builder.ts: the rescore pass after the fetch retry is a single pass, no retry/sleep wrapper (scoreCandidate is pure -- retrying it is a no-op)", () => {
  const src = readSource();
  const rescoreSection = sliceBetween(
    src,
    "for (const d of Object.values(dossiers)) {\n      try {\n        rescoreDossier(",
    "const scoredList: ScoredCandidate[] ="
  );
  assert.doesNotMatch(rescoreSection, /while \(/, "rescore pass must not be wrapped in a retry while-loop");
  assert.doesNotMatch(rescoreSection, /setTimeout/, "rescore pass must not sleep/retry -- it has nothing to gain from a delay");
  assert.doesNotMatch(src, /MAX_RESCORE_ATTEMPTS/, "the old rescore-retry constant must be gone, not left dead alongside the new fetch-retry one");
});

test("edition-builder.ts: the recap-only reason names the dossier-FETCH attempt count, not a rescore-attempt count", () => {
  const src = readSource();
  assert.match(src, /No scored dossiers after \$\{dossierFetchAttempt\} dossier-fetch attempt\(s\)/);
  assert.doesNotMatch(src, /No scored dossiers after \$\{rescoreAttempt\} rescore attempt\(s\)/);
});

test("edition-builder.ts: `resumed` in the final result reflects dossiers staged before THIS invocation's own fetch/retry work, not a mid-retry re-check", () => {
  const src = readSource();
  assert.match(src, /const alreadyDoneAtStart = checkpointing \? await fetchStagedDossierTickers\(editionFor\) : \[\];/);
  assert.match(src, /resumed: alreadyDoneAtStart\.length > 0,/);
  assert.doesNotMatch(src, /resumed: alreadyDone\.length > 0,/);
});
