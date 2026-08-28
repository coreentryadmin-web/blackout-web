> **kind:** `FINDING`

## Night Hawk prod-check stale LEAPS toggle heuristic — FIXED

| **Status** | Shipped in PR (cursor/nighthawk-prod-check-bangers-3d11) |
|---|---|

**Root cause:** `nighthawk-prod-check.mjs` still looked for `Swings` + `LEAPS` in served HTML. The Aug 2026 remodel renamed the segment to **Bangers** (`nighthawk-view.ts`), so every pass WARNed falsely (NH-LEAPS-LABEL).

**Fix:** Toggle probe now checks `Swings` + `Bangers`. Added `mobileStickyFaqOverlapGate` repo guard in marketing-funnel audit (locks #2799 fix in CI).
