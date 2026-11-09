/**
 * Regression guard (DISCOVERY round 508) for a stale-closure gap in VectorChart's live SSE tick
 * handler: `onRegimeChange` was read directly from the component's closure inside `emitRegime`
 * (called from the `onmessage` handler `connectLive` builds), instead of through a ref mirror like
 * every OTHER callback that same long-lived handler reads — including `onFreshness`/`onSpotChange`,
 * which were fixed for the identical shape in round 506
 * (`VectorChart-onfreshness-onspotchange-ref-mirror.test.ts`).
 *
 * WHY THIS IS REACHABLE, NOT JUST STYLISTIC: `connectLive` is a `useCallback` invoked only from the
 * mount effect (`[]` deps), `exitReplay`, and the SSE error-retry path — nothing in the file watches
 * `connectLive`'s own identity to re-invoke it, so listing `emitRegime` in ITS dependency array (as
 * it still is) does not make the already-running `onmessage` handler see a new `emitRegime`; only
 * tearing down and recreating the EventSource does that.
 *
 * `onRegimeChange` churns in exactly one real call site: VectorPageShell's `chartOnly` embed (used
 * by VectorComparePane in Compare mode) wires `onRegimeChange={handleRegime}`, where `handleRegime`
 * depends on `[onCompareRegimeChange]` — and `onCompareRegimeChange` is VectorComparePane's OWN
 * `handleRegime`, which depends on `[pushMeta, spot]`. Since `spot` state updates on every live
 * tick (via the already-fixed `onSpotChange` path), `VectorComparePane.handleRegime` gets a new
 * identity on every tick, so `VectorPageShell.handleRegime` churns too, so `emitRegime` churned too
 * — all without ever reconnecting the SSE stream. The long-lived tick handler kept calling the
 * FIRST `emitRegime` captured at mount, which closed over the FIRST `VectorComparePane.handleRegime`
 * forever, which closed over `spot` AS IT WAS AT MOUNT. Every live regime-change emit therefore
 * called `pushMeta(freshRegime, staleMountTimeSpot)`, writing a frozen initial spot into
 * `VectorCompareDesk`'s `metaByTicker[ticker].spot` on every regime flip, never the live spot.
 *
 * Every sibling callback read from the SAME handler (`onFreshnessRef`, `onSpotChangeRef`,
 * `onPlayChangeRef`, `onAlertsFiredRef`, `onTechnicalsChangeRef`, `onExpectedMoveChangeRef`,
 * `onPriceScaleRenderRef`, `onCompareCrosshairRef`, `onCompareVisibleRangeRef`) already uses this
 * ref-mirror discipline. `onRegimeChange` was the one still closed over directly via `emitRegime`.
 *
 * Fix: `onRegimeChangeRef`, updated every render (no dep array, same pattern as the others), with
 * `emitRegime` reading `.current` instead of the closed-over prop, and no longer listing
 * `onRegimeChange` in its own `useCallback` deps.
 *
 * This component has no server-only import but the repo carries no DOM/React-renderer test infra
 * (no jsdom, no @testing-library/react — see VectorChart-replay-spot-callback.test.ts's identical
 * note), so this asserts on the source directly, the repo's established fallback for a hook-wiring
 * invariant that can't be driven through a real render.
 *
 * Run: `npx tsx --experimental-test-module-mocks --test src/features/vector/components/VectorChart-onregimechange-ref-mirror.test.ts`
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

const source = readFileSync(
  join(process.cwd(), "src/features/vector/components/VectorChart.tsx"),
  "utf8"
);

test("VectorChart declares onRegimeChangeRef as a ref mirror of the `onRegimeChange` prop", () => {
  assert.match(
    source,
    /const onRegimeChangeRef = useRef\(onRegimeChange\);/,
    "onRegimeChangeRef must exist as a ref mirror of the `onRegimeChange` prop"
  );
});

test("VectorChart: onRegimeChangeRef is kept in lockstep with the latest prop every render (no dep array)", () => {
  // Same bare useEffect (no deps) pattern as onFreshnessRef/onSpotChangeRef/onPriceScaleRenderRef/
  // etc. — re-runs on every render so the ref never goes stale by even one commit.
  const block = source.match(
    /useEffect\(\(\) => \{\s*onFreshnessRef\.current = onFreshness;\s*onSpotChangeRef\.current = onSpotChange;\s*onRegimeChangeRef\.current = onRegimeChange;\s*\}\);/
  );
  assert.ok(
    block,
    "expected onRegimeChangeRef.current = onRegimeChange inside the SAME bare (no-deps) useEffect " +
      "that already mirrors onFreshness/onSpotChange"
  );
});

test("VectorChart: emitRegime reads onRegimeChangeRef.current, never the closed-over `onRegimeChange` prop directly", () => {
  const emitRegimeBlock = source.match(
    /const emitRegime = useCallback\(\(\) => \{[\s\S]*?\}, \[liveGexWalls, liveGammaFlip\]\);/
  );
  assert.ok(emitRegimeBlock, "expected to find emitRegime's useCallback body");
  assert.match(
    emitRegimeBlock![0],
    /const cb = onRegimeChangeRef\.current;/,
    "emitRegime must read onRegimeChangeRef.current into a local, not the bare onRegimeChange closure"
  );
  assert.doesNotMatch(
    emitRegimeBlock![0],
    /\bonRegimeChange\(regime\);/,
    "a bare onRegimeChange(regime) call reintroduces the stale-closure gap this fix closes"
  );
});

test("VectorChart: emitRegime's useCallback no longer lists onRegimeChange as a dependency (it's read via ref now)", () => {
  const emitRegimeDeps = source.match(/const emitRegime = useCallback\([\s\S]*?\}, \[([^\]]*)\]\);/);
  assert.ok(emitRegimeDeps, "expected to find emitRegime's dependency array");
  assert.doesNotMatch(
    emitRegimeDeps![1],
    /\bonRegimeChange\b/,
    "emitRegime's dependency array should no longer list the raw onRegimeChange prop"
  );
});
