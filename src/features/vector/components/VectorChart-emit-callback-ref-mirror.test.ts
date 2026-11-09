/**
 * Regression guard (DISCOVERY round 507) for a stale-closure gap in VectorChart's live SSE tick
 * handler, the same shape as the already-fixed `onFreshness`/`onSpotChange` ref mirror (see
 * VectorChart-onfreshness-onspotchange-ref-mirror.test.ts) but on a different vein: the five
 * emit* helpers the handler calls on every live tick — `emitRegime`, `emitProximity`,
 * `emitMagnet`, `emitConfluence`, `emitWallIntegrity` — used to read `onRegimeChange`,
 * `onProximityChange`, `onMagnetChange`, `onConfluenceChange`, `onWallIntegrityChange` directly
 * from their own closures instead of through a ref mirror.
 *
 * WHY THIS IS REACHABLE, NOT JUST STYLISTIC: `connectLive` (the `useCallback` that builds the
 * EventSource's `onmessage` handler) is only ever invoked from the mount effect (`[]` deps),
 * `exitReplay`, and the SSE error-retry path — nothing in the file watches `connectLive`'s own
 * identity to tear down and rebuild the connection, so once the handler is built it keeps running
 * unchanged for the life of the connection. The handler calls `emitRegime()`/`emitProximity()`/
 * `emitMagnet()`/`emitConfluence()`/`emitWallIntegrity()` directly (not through refs), so even
 * though each emit* function is a `useCallback` that gets recreated whenever its own deps
 * (including the raw prop) change, the handler's closure keeps calling whichever instance existed
 * the moment `connectLive` was first invoked — forever, regardless of how many fresh instances
 * get created afterward.
 *
 * This is reachable in production, not just theoretical: VectorComparePane.tsx's `handleRegime`
 * (used in Compare mode, wired up through VectorPageShell's own `handleRegime` to VectorChart's
 * `onRegimeChange` prop) has `[pushMeta, spot]` in its own dependency array — `spot` is React
 * state that updates on every live tick, so `handleRegime`'s identity churns constantly during a
 * live Compare session. Before this fix, `emitRegime`'s stale closure kept calling the
 * mount-time-frozen `onRegimeChange`, which in turn called a `pushMeta(regime, spot)` whose
 * `spot` argument was frozen to whatever `spot` was at the moment the chart first mounted —
 * producing a `VectorComparePaneMeta` object whose `spot` field never updated again while its
 * `regime` field (passed as a plain function argument, not closed over) kept updating live. The
 * two fields of one object meant to describe the SAME instant silently drifted apart.
 *
 * Every sibling callback read from the SAME handler (`onPlayChangeRef`, `onAlertsFiredRef`,
 * `onTechnicalsChangeRef`, `onExpectedMoveChangeRef`, `onPriceScaleRenderRef`,
 * `onCompareCrosshairRef`, `onCompareVisibleRangeRef`, and now `onFreshnessRef`/`onSpotChangeRef`)
 * already uses exactly this ref-mirror discipline. These five were the ones that still escaped it.
 *
 * Fix: `onRegimeChangeRef`/`onProximityChangeRef`/`onMagnetChangeRef`/`onConfluenceChangeRef`/
 * `onWallIntegrityChangeRef`, all synced every render via one dependency-less `useEffect` (same
 * pattern as the sibling refs), with each emit* function reading `.current` instead of the raw
 * prop, and each prop dropped from its emit* function's own dependency array (it is no longer
 * referenced directly in the body, matching `emitPlay`'s established `onPlayChangeRef` pattern).
 *
 * This component has no server-only import but the repo carries no DOM/React-renderer test infra
 * (no jsdom, no @testing-library/react — see VectorChart-replay-spot-callback.test.ts's identical
 * note), so this asserts on the source directly, the repo's established fallback for a
 * hook-wiring invariant that can't be driven through a real render.
 *
 * Run: `npx tsx --experimental-test-module-mocks --test src/features/vector/components/VectorChart-emit-callback-ref-mirror.test.ts`
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

const source = readFileSync(
  join(process.cwd(), "src/features/vector/components/VectorChart.tsx"),
  "utf8"
);

const CALLBACKS = [
  { prop: "onRegimeChange", emit: "emitRegime" },
  { prop: "onProximityChange", emit: "emitProximity" },
  { prop: "onMagnetChange", emit: "emitMagnet" },
  { prop: "onConfluenceChange", emit: "emitConfluence" },
  { prop: "onWallIntegrityChange", emit: "emitWallIntegrity" },
] as const;

test("VectorChart declares a ref mirror for each of the five emit*-consumed callbacks", () => {
  for (const { prop } of CALLBACKS) {
    assert.match(
      source,
      new RegExp(`const ${prop}Ref = useRef\\(${prop}\\);`),
      `${prop}Ref must exist as a ref mirror of the \`${prop}\` prop`
    );
  }
});

test("VectorChart: all five refs are kept in lockstep with the latest props every render (no dep array)", () => {
  // Same discipline as the sibling long-lived-handler ref mirrors: a bare `useEffect(() => {...})`
  // with NO dependency array, so it re-syncs on every single render. A dep array here would
  // reintroduce the one-render-behind race this fix exists to close.
  const block = source.match(
    /useEffect\(\(\) => \{\s*onRegimeChangeRef\.current = onRegimeChange;\s*onProximityChangeRef\.current = onProximityChange;\s*onMagnetChangeRef\.current = onMagnetChange;\s*onConfluenceChangeRef\.current = onConfluenceChange;\s*onWallIntegrityChangeRef\.current = onWallIntegrityChange;\s*\}\);/
  );
  assert.ok(
    block,
    "expected a single bare useEffect (no dep array) syncing all five *Ref.current assignments"
  );
});

test("VectorChart: each emit* function reads its *Ref.current, never the closed-over prop directly", () => {
  for (const { prop, emit } of CALLBACKS) {
    const fnMatch = source.match(
      new RegExp(`const ${emit} = useCallback\\(\\(\\) => \\{[\\s\\S]*?\\}, \\[[^\\]]*\\]\\);`)
    );
    assert.ok(fnMatch, `expected to find ${emit}'s useCallback body`);
    const body = fnMatch![0];

    assert.match(
      body,
      new RegExp(`${prop}Ref\\.current`),
      `${emit} must read ${prop}Ref.current`
    );

    // The raw prop identifier must not appear as a bare reference inside the body (it may appear
    // only as part of `${prop}Ref`) — a bare use reintroduces the stale-closure gap.
    const bareRefs = body.match(new RegExp(`\\b${prop}\\b(?!Ref)`, "g")) ?? [];
    assert.equal(
      bareRefs.length,
      0,
      `${emit} must not reference the bare \`${prop}\` prop directly, only ${prop}Ref.current`
    );

    // And the prop must no longer be listed in the emit* function's own dependency array — it is
    // only read via the stable ref now, matching emitPlay's established onPlayChangeRef pattern.
    const depsMatch = body.match(/\}, \[([^\]]*)\]\);$/);
    assert.ok(depsMatch, `expected to find ${emit}'s dependency array`);
    assert.doesNotMatch(
      depsMatch![1]!,
      new RegExp(`\\b${prop}\\b`),
      `${emit}'s dependency array should no longer list the raw ${prop} prop`
    );
  }
});
