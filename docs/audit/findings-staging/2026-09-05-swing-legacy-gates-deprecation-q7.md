# 2026-09-05 — Swing legacy `gates.ts` deprecation marker (deep-dive Q7 partial)

## Problem

`src/lib/swing/gates.ts` (`evaluateSwingGates`) is only called from its own unit tests. Production V2
commit uses `src/lib/swing/v2/gates.ts` (G-S3/G-S6/G-S14). The legacy module still documents
`quote_stale` and `daily_bar_incomplete` gates that never reach the live path — a footgun for future
sessions reading commit.ts's calibration story.

## Fix

- File-header `@deprecated` notice pointing to `v2/gates.ts` and Q7 triage entry
- No behavior change — explicit documentation only

## Remaining (P4)

Port `quote_stale` / `daily_bar_incomplete` into v2 commit path, or delete `gates.ts` after test migration.

## Verification

```bash
npx tsx --test src/lib/swing/gates.test.ts
npx tsc --noEmit
```
