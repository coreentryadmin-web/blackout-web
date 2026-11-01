import assert from "node:assert/strict";
import { test } from "node:test";
import { applyIfGenerationUnchanged } from "./FlowFeed";

/**
 * Regression (DISCOVERY sweep, round 239): `loadOlderFlows` had NO generation guard at all,
 * unlike its siblings `loadFlows`/`refreshHead` (both check `loadGenerationRef`). It fetches an
 * OLDER page of the flow tape and, on resolve, unconditionally appends it onto whatever `alerts`
 * currently holds and overwrites `hasMorePages`/`nextBefore`.
 *
 * Concretely reachable: a member scrolls to the bottom of the tape (wired to `onLoadOlder` /
 * the auto-backfill effect), starting an older-page fetch under filter A. Before it resolves,
 * they change the ticker/DTE/min-premium filter — `loadFlows` fires, resets `alerts` to filter
 * B's fresh results. If the (now stale) older-page fetch for filter A then resolves, it spliced
 * filter A's rows into filter B's tape via the functional `setAlerts` updater, and clobbered
 * filter B's own `nextBefore` pagination cursor with filter A's — breaking "load more" for the
 * filter actually on screen, with no error and no visible sign anything went wrong.
 *
 * The fix adds `filterGenerationRef` (bumped only inside `loadFlows`, i.e. only on a genuine
 * filter change — NOT reusing the shared `loadGenerationRef`, which `refreshHead`'s routine 30s
 * poll also bumps with no filter change at all, which would have produced false-positive
 * discards on the common case) and routes `loadOlderFlows` through the exported, pure
 * `applyIfGenerationUnchanged` guard tested here — same shape as `AdminApiEventDetail.tsx`'s
 * `loadEventDetailIfCurrent`.
 */

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

test("applyIfGenerationUnchanged: a fetch that resolves AFTER the generation changed is NOT applied", async () => {
  const page = deferred<{ rows: string[] }>();
  let generation = 1;
  const applied: Array<{ rows: string[] }> = [];

  // The older-page fetch starts while generation is 1 (filter A).
  const run = applyIfGenerationUnchanged(
    () => page.promise,
    () => generation,
    (d) => applied.push(d)
  );

  // The filter changes before the fetch resolves — loadFlows bumps the generation (filter B).
  generation = 2;

  // The stale filter-A page finally lands.
  page.resolve({ rows: ["old-filter-row"] });
  await run;

  assert.deepEqual(
    applied,
    [],
    "a page fetched under a filter generation that has since changed must never be applied"
  );
});

test("applyIfGenerationUnchanged: a fetch that resolves with the generation unchanged IS applied", async () => {
  let generation = 1;
  const applied: Array<{ rows: string[] }> = [];

  await applyIfGenerationUnchanged(
    async () => ({ rows: ["fresh-row"] }),
    () => generation,
    (d) => applied.push(d)
  );

  assert.deepEqual(applied, [{ rows: ["fresh-row"] }]);
});

test("applyIfGenerationUnchanged: multiple older-page fetches each check their OWN start generation, not the other's", async () => {
  const pageA = deferred<{ rows: string[] }>();
  const pageB = deferred<{ rows: string[] }>();
  let generation = 1;
  const applied: string[] = [];

  // Page A starts under generation 1 (filter A).
  const runA = applyIfGenerationUnchanged(
    () => pageA.promise,
    () => generation,
    () => applied.push("A")
  );

  // Filter changes to generation 2 (filter B); a fresh older-page fetch starts under it.
  generation = 2;
  const runB = applyIfGenerationUnchanged(
    () => pageB.promise,
    () => generation,
    () => applied.push("B")
  );

  // B (current filter) resolves first.
  pageB.resolve({ rows: ["b-row"] });
  await runB;
  // A (stale filter) resolves after.
  pageA.resolve({ rows: ["a-row"] });
  await runA;

  assert.deepEqual(
    applied,
    ["B"],
    "only the page fetched under the generation that is still current may be applied"
  );
});
