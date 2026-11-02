> **kind:** FINDING

## SPX Slayer closed-market `/play` served a VIX-blind fixed target while stop/invalidation were already VIX-aware — FIXED

| **Status** | Fixed |
|---|---|

**Found by:** live production audit, 2026-11-01 (`GET /api/market/spx/play` during a closed-market
session, 5-engine live monitor mandate).

**Root cause:** `evaluateSpxPlayCore`'s closed-market branch (`src/features/spx/lib/spx-play-engine.ts`,
the `!desk.market_open && !premarket` path) built `closedConfluence = computeSpxConfluence(desk)`
and correctly reused `closedConfluence.levels.stop` and `closedConfluence.levels.invalidation` for
the rendered trade idea's `levels.stop`/`levels.invalidation` — but for `levels.target`, it silently
discarded `closedConfluence.levels.target` and instead recomputed a *different* value via the older
`playIdealTargetPts()` helper (`src/features/spx/lib/spx-play-config.ts`), a fixed 10-point default
that ignores VIX entirely:

```ts
const idealTarget =
  entry != null && dir != null
    ? dir === "long" ? entry + playIdealTargetPts() : entry - playIdealTargetPts()
    : null;
...
levels: { entry, stop: closedConfluence?.levels.stop ?? null, target: idealTarget, ... }
```

Meanwhile `computeSpxConfluence()` (`spx-signals.ts`) builds its own `levels.target` via
`buildLevels(desk, price, bias, action)`, whose `targetPts` comes from
`playDynamicTargetPts(desk.vix)` — a VIX-indexed function (12pt for VIX <16, 14pt for VIX 16-22,
18pt for VIX >22; added 2026-06-21, "normal markets average 25-40pt days"). `playIdealTargetPts()`
predates that work (added 2026-06-17) and was never removed from this one call site once the
VIX-indexed path shipped, so `stop`/`invalidation` were VIX-correctness-aware while `target` on the
very same payload silently was not — a two-tier regression where one trade level reflects the day's
actual volatility regime and the adjacent two do not.

**Live evidence (2026-11-01):** with `desk.vix=19.42` (which `playDynamicTargetPts` maps to the
16-22 "normal market" tier → 14 points), the live `GET /api/market/spx/play` response during a
closed-market session showed `play.levels.entry=7580.07` and `play.levels.target=7590.07` —
exactly `entry + 10.00`, confirming the VIX-blind fallback fired, not the VIX-aware path.
`closedConfluence.levels.target` (unused by this call site) would have been `entry + 14.00 =
7594.07`.

**Fix:** source `levels.target` from `closedConfluence?.levels.target ?? null` directly, the same
way `stop`/`invalidation` already are, removing the separate `idealTarget` computation and its
`playIdealTargetPts()` call from this site entirely. `playIdealTargetPts()` itself is left in place
in `spx-play-config.ts` — grepping the repo confirmed a second, unrelated call site
(`src/lib/admin-spx-config-snapshot.ts`'s admin config-value display, which reads the function's
*configured* value for an operator-facing settings table, not to compute a trade level), so the
helper is not dead code and was not removed.

**Blast radius:** grepped the whole `src/features/spx` tree for every call site of
`playDynamicTargetPts`/`playIdealTargetPts`. `playDynamicTargetPts` has exactly one call site
(`buildLevels` in `spx-signals.ts`, used by both the live-market and closed-market read paths via
`computeSpxConfluence`). `playIdealTargetPts` (pre-fix) had exactly two call sites: the closed-market
branch fixed here, and the unrelated admin-config-display read in `admin-spx-config-snapshot.ts`
(untouched). The live open-market branch (`evaluateOpenPlay`/`evaluateFlatPlay`, gated on
`desk.market_open`) already sources `target: confluence.levels.target` directly (two call sites,
`spx-play-engine.ts:1429` and `:1448`) and was never affected by this bug — only the closed-market
"Session closed" SCANNING read was.

**Evidence (RED → GREEN):** added a regression test to
`src/features/spx/lib/spx-play-engine.test.ts` — a closed-market desk fixture with a GEX support
wall (produces a `long`-biased confluence) and `vix: 18` (16-22 band), asserting
`payload.levels.target === 7694` (`entry 7680 + 14`), not the stale fixed `7690` (`entry + 10`).
**RED** (temporarily reverted `levels.target` back to a fixed `entry ± 10` literal, keeping the
rest of the fix untouched): the new test failed with `7690 !== 7694`, reproducing the exact live
bug shape. **GREEN** (fix restored): `npx tsx --experimental-test-module-mocks --test
spx-play-engine.test.ts` → 20/20 pass. Also ran every sibling test file importing
`spx-play-engine.ts`/`spx-signals.ts`/`spx-play-config.ts` (23 files, 198 tests total) — all pass.
`npx tsc --noEmit` (Node 20): clean.
