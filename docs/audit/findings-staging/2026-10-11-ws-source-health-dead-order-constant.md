## Dead `SOURCE_HEALTH_ORDER` export in `source-health.ts`, previously flagged not fixed — FIXED

> **kind:** `FINDING`

| Field | Detail |
|---|---|
| **Symptom** | `SOURCE_HEALTH_ORDER` (`src/lib/ws/source-health.ts:29`, the WS-21 UW-socket recovery-lifecycle module) had zero callers anywhere in `src/`, including its own test file — confirmed via repo-wide grep both before and after the fix. Its own doc comment claims "Ordered, low→high, so callers can compare 'at least as healthy as'," but no caller ever did that comparison: `commitAuthorizedBySourceHealth`, the module's one behavior-changing consumer, gates purely on a direct `state === "HEALTHY"` equality check, never an ordering comparison against this array. |
| **Root cause** | This was first SURFACED, not fixed, during an earlier DISCOVERY sweep this session (the 0DTE-engine dead-exports finding, folded via #5849): `POLYGON_UPSTREAM_HEALTH_ORDER` in `polygon-rest-health.ts` cited `SOURCE_HEALTH_ORDER`'s "shape" as its own design justification, and in verifying that claim the earlier sweep noticed `SOURCE_HEALTH_ORDER` itself was zero-caller too — but flagged it as "out of scope here (WS-21, a different subsystem)" rather than fixing it in that PR. This entry closes that loop directly rather than leaving it open indefinitely. |
| **Why this matters** | Same shape as every other dead-export finding this session: an exported helper whose own comment describes a real, sensible use ("at least as healthy as" comparisons are a genuinely useful thing to want for a 5-state recovery lifecycle) that nothing in the codebase ever actually needed — looks load-bearing, isn't. |
| **Blast radius** | 1 file, 1 export removed. `SourceHealthState` (the type the array was built from) is untouched — still the return type of the module's state machine and widely used. No other code anywhere referenced the array. |
| **Fix** | Deleted the dead export. |
| **Fix rationale** | Direct removal — no protective "kept for X" doc comment, and (unlike `POLYGON_UPSTREAM_HEALTH_ORDER`, which at least had a live sibling citing it) nothing in the codebase currently depends on or references this array's existence at all. |
| **Regression guard** | No behavior to regression-test (pure deletion of unreachable code). `grep -rn "SOURCE_HEALTH_ORDER" src/` → zero hits post-fix. Full `src/lib/ws/**/*.test.ts` sweep (2 suites): 185/185 pass. `tsc --noEmit` clean. |
| **Gates** | `find src/lib/ws -name "*.test.ts" -print0 \| xargs -0 npx tsx --experimental-test-module-mocks --test` (Node 20) — 185/185 pass. `npx tsc --noEmit` — clean. |
| **Status** | FIXED — branch `fix/ws-source-health-dead-order-2026-10-11`. |
