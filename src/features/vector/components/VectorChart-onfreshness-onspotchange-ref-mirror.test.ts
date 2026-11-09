/**
 * Regression guard (DISCOVERY round 506) for a stale-closure gap in VectorChart's live SSE tick
 * handler: `onFreshness` and `onSpotChange` were read directly from the component's closure
 * inside the `onmessage` handler `connectLive` builds, instead of through a ref mirror like every
 * OTHER callback that same long-lived handler reads.
 *
 * WHY THIS IS REACHABLE, NOT JUST STYLISTIC: `connectLive` is a `useCallback` invoked only from
 * the mount effect (`[]` deps), `exitReplay`, and the SSE error-retry path — nothing in the file
 * watches `connectLive`'s own identity to re-invoke it, so listing a prop in ITS dependency array
 * (as `onFreshness` previously was) does not make the already-running `onmessage` handler see a
 * new value; only tearing down and recreating the EventSource does that. Both VectorPageShell call
 * sites pass `liveSession ? theRealCallback : undefined` for both props — a VALUE that flips with
 * `liveSession`, not just a re-created function with equivalent behavior. `VectorChart` is mounted
 * with `key={activeTicker}` (remounts only on a ticker switch), so `liveSession` can flip from true
 * to false mid-mount with NO remount and NO reconnect. Before this fix, the long-lived handler kept
 * calling the STALE pre-flip `onFreshness`/`onSpotChange` (continuing to push "live" updates into
 * the parent — `setStreamUpdatedAt`/`setLiveSpot`/`handleSpot`) even after the parent intended to
 * stop, until the member switched tickers or toggled replay.
 *
 * Every sibling callback read from the SAME handler (`onPlayChangeRef`, `onAlertsFiredRef`,
 * `onTechnicalsChangeRef`, `onExpectedMoveChangeRef`, `onPriceScaleRenderRef`,
 * `onCompareCrosshairRef`, `onCompareVisibleRangeRef`) already uses exactly this ref-mirror
 * discipline, each with its own comment explaining why (e.g. onAlertsFiredRef: "all in refs so the
 * []-dep tick handler reads the latest without re-subscribing the SSE stream"). `onFreshness` and
 * `onSpotChange` were the two that escaped it.
 *
 * Fix: `onFreshnessRef`/`onSpotChangeRef`, updated every render (no dep array, same pattern as
 * `onPriceScaleRenderRef`/`onTechnicalsChangeRef`/etc.), with both call sites inside the tick
 * handler reading `.current` instead of the closed-over prop.
 *
 * This component has no server-only import but the repo carries no DOM/React-renderer test infra
 * (no jsdom, no @testing-library/react — see VectorChart-replay-spot-callback.test.ts's identical
 * note), so this asserts on the source directly, the repo's established fallback for a hook-wiring
 * invariant that can't be driven through a real render.
 *
 * Run: `npx tsx --experimental-test-module-mocks --test src/features/vector/components/VectorChart-onfreshness-onspotchange-ref-mirror.test.ts`
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

const source = readFileSync(
  join(process.cwd(), "src/features/vector/components/VectorChart.tsx"),
  "utf8"
);

test("VectorChart declares onFreshnessRef/onSpotChangeRef mirrors, same discipline as the sibling callback refs", () => {
  assert.match(
    source,
    /const onFreshnessRef = useRef\(onFreshness\);/,
    "onFreshnessRef must exist as a ref mirror of the `onFreshness` prop"
  );
  assert.match(
    source,
    /const onSpotChangeRef = useRef\(onSpotChange\);/,
    "onSpotChangeRef must exist as a ref mirror of the `onSpotChange` prop"
  );
});

test("VectorChart: both refs are kept in lockstep with the latest props every render (no dep array)", () => {
  // The established pattern for these long-lived-handler ref mirrors (onPriceScaleRenderRef,
  // onTechnicalsChangeRef, onExpectedMoveChangeRef, onPlayChangeRef, onAlertsFiredRef) is a
  // `useEffect` with NO dependency array, so it re-runs — and re-syncs the ref — on every single
  // render, never going stale by even one commit. A dep array here would reintroduce exactly the
  // one-render-behind race this fix exists to close.
  const block = source.match(
    /useEffect\(\(\) => \{\s*onFreshnessRef\.current = onFreshness;\s*onSpotChangeRef\.current = onSpotChange;\s*\}\);/
  );
  assert.ok(
    block,
    "expected a bare `useEffect(() => { onFreshnessRef.current = onFreshness; onSpotChangeRef.current = onSpotChange; });` " +
      "with NO dependency array"
  );
});

test("VectorChart: the SSE tick handler reads onFreshnessRef.current, never the closed-over `onFreshness` prop directly", () => {
  assert.match(
    source,
    /onFreshnessRef\.current\?\.\(snap\.t\);/,
    "the tick handler must call onFreshnessRef.current, not the bare onFreshness closure"
  );
  assert.doesNotMatch(
    source,
    /(?<!Ref\.current)\bonFreshness\?\.\(snap\.t\);/,
    "a bare onFreshness?.(snap.t) call reintroduces the stale-closure gap this fix closes"
  );
});

test("VectorChart: the SSE tick handler reads onSpotChangeRef.current, never the closed-over `onSpotChange` prop directly", () => {
  assert.match(
    source,
    /onSpotChangeRef\.current\?\.\(curSpot\);/,
    "the tick handler must call onSpotChangeRef.current, not the bare onSpotChange closure"
  );
  assert.doesNotMatch(
    source,
    /(?<!Ref\.current)\bonSpotChange\?\.\(curSpot\);/,
    "a bare onSpotChange?.(curSpot) call reintroduces the stale-closure gap this fix closes"
  );
});

test("VectorChart: connectLive's useCallback no longer lists onFreshness as a dependency (it never made the handler re-subscribe)", () => {
  // `connectLive`'s own identity changing doesn't cause anything to tear down and recreate the
  // EventSource — nothing in the file watches `[connectLive]`. Listing `onFreshness` there gave a
  // false sense of freshness without ever achieving it; removing it (now that the handler reads
  // the ref instead) keeps the dependency array honest about what actually needs a fresh
  // `connectLive` identity.
  const depsLine = source.match(/\}, \[sessionYmd, refreshTrails, refreshOverlays, [^\]]*\]\);/);
  assert.ok(depsLine, "expected to find connectLive's dependency array");
  assert.doesNotMatch(
    depsLine![0],
    /\bonFreshness\b/,
    "connectLive's dependency array should no longer list the raw onFreshness prop"
  );
});
