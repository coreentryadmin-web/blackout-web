# 2026-09-05-swing-active-refresh-roll-close-race.md

> **kind:** FINDING

## Swing Q37 — overlapping active-refresh passes race ROLL vs CLOSE

| Field | Value |
|-------|-------|
| **Status** | FIXED (partial — singleton claim + execution revalidation) |
| **Priority** | P1 |
| **Area** | swing-active-refresh cron / manage-sync roll executor |
| **PR** | (this branch) |

### Root cause

Two overlapping `swing-active-refresh` background passes could read the same OPEN row at different times, reach opposing verdicts (ROLL vs CLOSE), and whichever `gradeParent` committed first won — with no cross-invocation arbitration that CLOSE must beat ROLL when the structural stop has broken.

### Fix

1. **Singleton Redis claim** (`swing:active-refresh:running`) — second pass skips while the first is in flight.
2. **`executionVerdictForGating`** — at roll execution time, re-check structural stop with the tick's underlying price; force CLOSE-not-ROLL if broken after async chain fetch.

### Evidence

- `npx tsx --test src/lib/swing/active-refresh-claim.test.ts src/lib/swing/manage-sync-q37.test.ts`
- `npx tsx --test src/app/api/cron/swing-active-refresh/route.test.ts`

### Remaining scope

Per-position `SELECT FOR UPDATE` or advisory locks if overlapping passes are ever intentionally allowed (e.g. force recovery).
