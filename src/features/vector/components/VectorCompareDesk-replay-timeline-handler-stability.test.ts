/**
 * Regression guard (DISCOVERY round 508) for a self-sustaining render/effect loop in
 * `VectorCompareDesk.tsx`'s linked-replay scrubber wiring.
 *
 * ROOT CAUSE: each compare pane's `onReplayTimeline` prop used to be built INLINE inside the
 * `seeds.map()` JSX — `(timeline) => handleReplayTimeline(seed.ticker, timeline)` — a brand-new
 * function reference on EVERY VectorCompareDesk render, regardless of whether anything about
 * that specific pane actually changed. `VectorChart.tsx` deliberately lists its own
 * `onReplayTimeline` prop in a `useEffect`'s dependency array (`[sessionHistory, sessionBars,
 * onReplayTimeline]`, so a genuine prop swap is honored) — but since neither `VectorChart` nor
 * `VectorComparePane` is wrapped in `React.memo`, EVERY VectorCompareDesk render recreates this
 * inline callback for every pane, which re-fires that effect even when `sessionHistory`/
 * `sessionBars` are byte-for-byte unchanged.
 *
 * That effect calls `onReplayTimeline(buildReplayTimeline(...))`, which reaches
 * `handleReplayTimeline` → `setUnionTimeline(mergeReplayTimelines([...]))`.
 * `mergeReplayTimelines` builds a `Set` and spreads+sorts it into a BRAND-NEW array every single
 * call, with no reference caching — so even when its CONTENT is identical to the last call,
 * `setUnionTimeline` never bails (a new array is never `Object.is`-equal to the old one),
 * triggering another VectorCompareDesk render, which recreates the inline callback again. This
 * closes a self-sustaining loop with NO terminating condition tied to real data — reachable in
 * ANY Compare session with 1+ panes, independent of whether live ticks are even flowing, pegging
 * the tab's CPU (never a thrown "Maximum update depth exceeded": that guard only fires for a
 * synchronous setState-during-render loop, not an effect-driven one like this).
 *
 * This directly contradicts this very file's OWN doc comments (and the matching FINDINGS.md
 * entry for `pruneStaleTickerMapEntries`), which describe `handleReplayTimeline` as firing
 * "whenever [a pane's] own sessionHistory/sessionBars change, i.e. on its next bar" — the
 * INTENDED model, which was never actually true while the per-pane callback churned every render.
 *
 * FIX: cache one stable function per ticker instead of a fresh closure every render.
 * `handleReplayTimelineRef` mirrors the latest `handleReplayTimeline` (itself still churns
 * whenever `seeds` changes — the ref keeps the cached per-ticker function from ever calling a
 * stale version), and `getReplayTimelineHandler(ticker)` returns the SAME function object for a
 * given ticker across renders, breaking the identity churn `VectorChart`'s effect was reacting
 * to. The cache is pruned on ticker departure via the same `pruneStaleTickerMapEntries` helper
 * already used for `timelinesRef`/`metaByTicker`/`playByTicker`.
 *
 * This component has no server-only import but the repo carries no DOM/React-renderer test infra
 * (no jsdom, no @testing-library/react) — this repo's established fallback for a hook-wiring
 * invariant that can't be driven through a real render is a source-text assertion (see
 * `vector-tier-fixes.test.ts`'s own `VectorCompareDesk.tsx` source-scan tests, and every
 * `VectorChart-*-ref-mirror.test.ts` file in this directory).
 *
 * Run: `npx tsx --experimental-test-module-mocks --test src/features/vector/components/VectorCompareDesk-replay-timeline-handler-stability.test.ts`
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

const source = readFileSync(
  join(process.cwd(), "src/features/vector/components/VectorCompareDesk.tsx"),
  "utf8"
);

test("VectorCompareDesk: the JSX no longer builds onReplayTimeline as a fresh inline closure every render", () => {
  assert.doesNotMatch(
    source,
    /onReplayTimeline=\{\(timeline\) => handleReplayTimeline\(seed\.ticker, timeline\)\}/,
    "a bare inline `(timeline) => handleReplayTimeline(seed.ticker, timeline)` reintroduces the " +
      "per-render identity churn that caused the self-sustaining render/effect loop"
  );
});

test("VectorCompareDesk: a stable per-ticker getReplayTimelineHandler is wired into the JSX", () => {
  assert.match(
    source,
    /onReplayTimeline=\{getReplayTimelineHandler\(seed\.ticker\)\}/,
    "expected onReplayTimeline to be wired through getReplayTimelineHandler(seed.ticker)"
  );
});

test("VectorCompareDesk: getReplayTimelineHandler caches one function per ticker instead of creating a new one every call", () => {
  const fnMatch = source.match(
    /const getReplayTimelineHandler = useCallback\(\(ticker: string\) => \{[\s\S]*?\}, \[\]\);/
  );
  assert.ok(fnMatch, "expected to find getReplayTimelineHandler's useCallback body");
  const body = fnMatch![0];
  assert.match(
    body,
    /replayTimelineHandlersRef\.current\.get\(ticker\)/,
    "getReplayTimelineHandler must look up an existing cached function for the ticker first"
  );
  assert.match(
    body,
    /replayTimelineHandlersRef\.current\.set\(ticker, fn\)/,
    "getReplayTimelineHandler must cache the function it creates, so later calls for the SAME " +
      "ticker return the SAME reference"
  );
  // Empty deps: the getter's own identity must stay stable across renders too (it reads/writes a
  // ref, never closes over anything that changes), so it never forces the memo Map to be rebuilt.
  assert.match(
    fnMatch![0],
    /\}, \[\]\);$/,
    "getReplayTimelineHandler itself must have an empty dependency array"
  );
});

test("VectorCompareDesk: the cached per-ticker function reads handleReplayTimeline through a ref, never closing over a stale instance", () => {
  assert.match(
    source,
    /const handleReplayTimelineRef = useRef\(handleReplayTimeline\);/,
    "expected handleReplayTimelineRef to mirror the handleReplayTimeline callback"
  );
  assert.match(
    source,
    /useEffect\(\(\) => \{\s*handleReplayTimelineRef\.current = handleReplayTimeline;\s*\}\);/,
    "expected a bare (no deps) useEffect keeping handleReplayTimelineRef in sync every render"
  );
  const fnMatch = source.match(
    /const getReplayTimelineHandler = useCallback\(\(ticker: string\) => \{[\s\S]*?\}, \[\]\);/
  );
  assert.ok(fnMatch);
  assert.match(
    fnMatch![0],
    /handleReplayTimelineRef\.current\(ticker, timeline\)/,
    "the cached per-ticker function must call handleReplayTimelineRef.current, not a closed-over " +
      "handleReplayTimeline directly (which would go stale once `seeds` changes handleReplayTimeline's " +
      "own identity)"
  );
});

test("VectorCompareDesk: the per-ticker handler cache is pruned when a ticker leaves the compare set, mirroring timelinesRef's own cleanup", () => {
  const pruneEffect = source.match(
    /useEffect\(\(\) => \{\s*const active = new Set\(seeds\.map\(\(s\) => s\.ticker\)\);[\s\S]*?\}, \[seeds\]\);/
  );
  assert.ok(pruneEffect, "expected to find the seeds-keyed pruning useEffect");
  assert.match(
    pruneEffect![0],
    /pruneStaleTickerMapEntries\(replayTimelineHandlersRef\.current, active\)/,
    "expected replayTimelineHandlersRef to be pruned via pruneStaleTickerMapEntries alongside " +
      "timelinesRef in the same seeds-keyed effect"
  );
});
