import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Half of a Largo turn elapsed before the first tool ran.
 *
 * MEASURED ON PROD 2026-08-20 during RTH, decomposed from the SSE stream (`tool_start` / `token`
 * events), because the server-side per-tool timings go only to `console.info`:
 *
 *     question              total    request -> first tool_start    get_gex_heatmap
 *     "gamma flip?"         44.1s    22.3s                          4.6s
 *     "gamma walls?"        41.4s    15.1s                          5.7s
 *
 * The TOOLS cost ~5s. The dominant cost is a chain of sequential awaits ahead of the first model
 * round-trip. This removes one of them.
 *
 * `buildTurnSnapshot` outside `diff` mode feeds nothing the member sees — its only consumer is the
 * fire-and-forget `updateLargoSessionMetadata` write, which exists so a LATER `diff` turn has a
 * baseline. Awaiting it made every ordinary turn wait on a desk round-trip for a value that never
 * reaches the answer.
 *
 * This corrects my own earlier characterisation: I told the user latency was "a TRADE needing a
 * product call (fewer rounds / smaller prefetch / earlier streaming)". It is not — a measurable
 * part of it is fixed overhead doing work the answer does not consume. I should not have handed
 * that back without decomposing it first.
 */

const SRC = readFileSync(join(process.cwd(), "src/lib/largo-terminal.ts"), "utf8");

/** The `else if` branch — ordinary (non-diff) turns. */
function nonDiffBranch(): string {
  const at = SRC.indexOf('} else if (activeDeskScope && deskScopeArgs?.mode !== "watch") {');
  assert.notEqual(at, -1, "the non-diff snapshot branch must still exist");
  return SRC.slice(at, SRC.indexOf("\n  }", at));
}

/** The `diff` branch — where the snapshot genuinely feeds the prompt. */
function diffBranch(): string {
  const at = SRC.indexOf('if (deskScopeArgs?.mode === "diff") {');
  assert.notEqual(at, -1, "the diff branch must still exist");
  return SRC.slice(at, SRC.indexOf('} else if (activeDeskScope', at));
}

test("REGRESSION: an ordinary turn does not await the turn snapshot", () => {
  const branch = nonDiffBranch();
  assert.ok(
    !/const nowSnap = await buildTurnSnapshot/.test(branch),
    "the non-diff branch must not block the member's turn on the snapshot"
  );
  assert.match(branch, /void buildTurnSnapshot\(/, "it must be fired and forgotten instead");
});

test("the DIFF branch still awaits — there the answer depends on it", () => {
  // The distinction is "does the member's answer read this value", not "is it cheap". In diff mode
  // `nowSnap` feeds `formatDiffBlock` straight into the prompt, so removing that await would ship a
  // diff turn with no diff.
  const branch = diffBranch();
  assert.match(branch, /const nowSnap = await buildTurnSnapshot/, "diff must keep its await");
  assert.match(branch, /formatDiffBlock\(prevSnap, nowSnap\)/, "…because the prompt consumes it");
});

test("the metadata write still happens, and still cannot fail the turn", () => {
  // The snapshot exists to give a LATER diff turn a baseline. Making it non-blocking must not make
  // it not-happen, and a failed snapshot must never surface as a failed answer.
  const branch = nonDiffBranch();
  assert.match(branch, /updateLargoSessionMetadata\(sid, userId, \{ last_turn_snapshot: nowSnap \}\)/);
  assert.match(branch, /\.catch\(\(\) => \{\}\)/, "errors stay swallowed as before");
});

test("the reason is recorded in code, not just in a PR", () => {
  // This is a deliberate ordering decision that looks like a missing await to a future reader. The
  // WHY has to survive being skimmed, or someone restores the await to 'fix' it.
  const branch = nonDiffBranch();
  assert.match(branch, /NOT AWAITED/i);
  assert.match(branch, /feeds NOTHING the member sees|never reaches the answer/i);
});
