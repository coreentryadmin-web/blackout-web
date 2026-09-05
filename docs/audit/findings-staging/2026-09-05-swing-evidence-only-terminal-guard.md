# 2026-09-05-swing-evidence-only-terminal-guard.md

> **kind:** FINDING

## Swing Q36 — stale refresh mutates closed positions

| Field | Value |
|-------|-------|
| **Status** | FIXED |
| **Priority** | P1 |
| **Area** | swing-active-refresh evidence-only path |
| **PR** | (this branch) |

### Root cause

`updateSwingLiveState` updated `last_mark`/peak/trough/MFE on `WHERE id = $1` only — status CASE froze terminal status but still overwrote mark columns. `applyEvidenceOnly` appended snapshots before latching, so a stale overlapping pass could write HOLD evidence onto an already-graded CLOSED/ROLLED row.

### Fix

- `updateSwingLiveState` returns rowcount and adds `AND status NOT IN ('CLOSED','ROLLED')` to WHERE.
- `applyEvidenceOnly` latches live state first; skips snapshot append when rowcount is 0.

### Evidence

- `npx tsx --test src/lib/swing/manage-sync-q36.test.ts`
- `npx tsx --test src/lib/db-swing-ledger.test.ts` (Q36 WHERE assertion)
