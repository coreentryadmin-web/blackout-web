/**
 * Regression guard (DISCOVERY round 505) for a one-tick stale-closure race in the pinned-bias
 * sessionStorage persist path.
 *
 * SpxCommentaryRail runs two independent `useEffect`s that can both call the shared `persist()`
 * helper: the "brain tick" effect (`[desk, live]` deps, recomputes the pinned bias) and the "play
 * lifecycle" effect (`[play, live]` deps, armed/fired/closed lines). Each effect body is a fresh
 * closure created on every render, but a closure is only INVOKED when its own deps array changed
 * since the last run — and when invoked, React does not synchronously flush a sibling effect's
 * `setState` call that ran moments earlier in the SAME commit. So if both effects' deps change in
 * the same tick (plausible: `desk` ticks ~every 2s via useMergedDesk, `play` updates via its own
 * SWR revalidation — nothing prevents them landing in the same React commit), and the brain-tick
 * effect (which runs first, per declaration order) just called `setPinned(nextPinned)` to pin a
 * freshly-changed bias, the play-lifecycle effect running right after it in that same pass would
 * read the STALE pre-update `pinned` STATE variable from its own closure — because that closure
 * was created at render time, before either effect ran, and setPinned's update hasn't flushed into
 * a new render yet. Calling persist(pinned, ...) with that stale value overwrites the correct
 * sessionStorage write the brain-tick effect just made, with the old bias — a real, reachable
 * staleness in what gets cached (and therefore in what the session time bar's event dots and a
 * same-tab reload see), even though it self-corrects on the next ~2s poll.
 *
 * The file already has the exact right pattern for this shape of bug — `shiftsRef`, declared with
 * a comment that says in plain words: "Mirror of `shifts` so persist() calls from other effects
 * never write a stale closure." That discipline was applied to `shifts` but NOT to `pinned`,
 * leaving `pinned` exposed to precisely the bug its sibling ref exists to prevent.
 *
 * Fix: a `pinnedRef` mirror, updated synchronously everywhere `setPinned` is called (hydration +
 * brain-tick effect), with BOTH persist() call sites reading `pinnedRef.current` instead of the
 * closure-captured `pinned` state variable.
 *
 * This component has no server-only import but the repo carries no DOM/React-renderer test infra
 * (no jsdom, no @testing-library/react — see AdminApiDashboard.test.ts's identical note), so this
 * asserts on the source directly, the repo's established fallback for a hook-wiring invariant that
 * can't be driven through a real render.
 *
 * Run: `npx tsx --experimental-test-module-mocks --test src/features/spx/components/SpxCommentaryRail-pinned-persist-race.test.ts`
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const source = readFileSync(
  fileURLToPath(new URL("./SpxCommentaryRail.tsx", import.meta.url)),
  "utf8"
);

test("SpxCommentaryRail declares a pinnedRef mirror, same discipline as the existing shiftsRef", () => {
  assert.match(
    source,
    /const pinnedRef = useRef<PinnedBias \| null>\(null\);/,
    "pinnedRef must exist as a ref mirror of the `pinned` state"
  );
});

test("SpxCommentaryRail: every setPinned(...) call site also updates pinnedRef.current synchronously", () => {
  // Every place the component actually PINS a new bias (hydration seed + brain-tick effect)
  // must keep pinnedRef in lockstep, or the mirror itself goes stale and the fix is a no-op.
  const setPinnedCalls = [...source.matchAll(/setPinned\(([^)]+)\);/g)];
  assert.ok(setPinnedCalls.length >= 2, "expected at least the hydration seed and brain-tick setPinned calls");
  for (const call of setPinnedCalls) {
    const idx = call.index ?? -1;
    assert.ok(idx >= 0);
    // The matching `pinnedRef.current = <same argument>;` must appear within a few lines
    // immediately before this setPinned call (the established ordering used for pinnedRef and
    // shiftsRef alike elsewhere in this file: update the ref, then setState).
    const windowBefore = source.slice(Math.max(0, idx - 200), idx);
    assert.match(
      windowBefore,
      new RegExp(`pinnedRef\\.current = ${call[1].trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")};`),
      `setPinned(${call[1]}) at offset ${idx} must be paired with a preceding pinnedRef.current update to the same value`
    );
  }
});

test("SpxCommentaryRail: the play-lifecycle effect's persist() reads pinnedRef.current, never the closure-captured `pinned` state", () => {
  const start = source.indexOf("// Play lifecycle — armed / fired / closed, one line each.");
  assert.ok(start > 0, "could not locate the play-lifecycle effect");
  const end = source.indexOf("}, [play, live]);", start);
  assert.ok(end > start, "could not find the play-lifecycle effect's closing deps array");
  const body = source.slice(start, end);

  assert.match(
    body,
    /persist\(pinnedRef\.current,\s*next\)/,
    "the play-lifecycle effect must persist pinnedRef.current, not the stale `pinned` closure"
  );
  assert.doesNotMatch(
    body,
    /persist\(pinned,\s*next\)/,
    "persisting the bare `pinned` state variable here reintroduces the one-tick stale-closure race " +
      "(this effect's deps are [play, live], independent of the brain-tick effect's [desk, live], so " +
      "both can fire in the same commit and this closure's `pinned` can be one render behind)"
  );
});

test("SpxCommentaryRail: the brain-tick effect's persist() falls back to pinnedRef.current, not the stale `pinned` state", () => {
  const start = source.indexOf("// The brain tick: snapshot the desk, detect transitions, keep the pinned bias fresh.");
  assert.ok(start > 0, "could not locate the brain-tick effect");
  const end = source.indexOf("}, [desk, live]);", start);
  assert.ok(end > start, "could not find the brain-tick effect's closing deps array");
  const body = source.slice(start, end);

  assert.match(
    body,
    /persist\(nextPinned \?\? pinnedRef\.current,\s*next\)/,
    "the brain-tick effect's persist fallback must read pinnedRef.current, not the `pinned` state"
  );
});
