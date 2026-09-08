# Largo stress shape harness — broken import after dynamic-format.ts deletion

> **kind:** FINDING

| Field | Value |
|-------|-------|
| **Status** | FIXED |
| **Priority** | P2 |
| **Area** | Largo / audit harness |

## Symptom

`npm run validate:largo-stress-shape` crashed with `ERR_MODULE_NOT_FOUND` for `src/lib/bie/dynamic-format.ts`.

## Root cause

PR #3203 deleted `dynamic-format.ts` as dead production code, but `scripts/largo-stress-shape.mjs` still imports `applyDynamicFormat` from it — the only remaining consumer named in repo-hygiene comments.

## Fix

Restored `src/lib/bie/dynamic-format.ts` from pre-deletion history and added regression tests. Harness now passes 17/17 shape cases.

## Verify

```bash
npm run validate:largo-stress-shape
npx tsx --test src/lib/bie/dynamic-format.test.ts
```
