# Ask Largo lane rank always null for committed swing plays

> **kind:** `FINDING`

| **Status** | FIXED (PR pending) |
|------------|-------------------|
| **Audit** | `docs/audit/SWING-SYSTEM-CTO-AUDIT-2026-09-06.md` finding **#15** |

## Symptom

Every live OPEN/HOLD/TRIM swing play-brief omitted the "Lane rank" section and desk-leader coaching — `computeLaneRank` returned `null` for 100% of committed positions.

## Root cause

`rowInBucket()` filtered peers with `OPEN_STATUSES.has(row.status)` (`OPEN`/`HOLD`/`TRIM`), but `HorizonPlay.status` is `PlayStatus` (`COMMIT` | `WATCH`). Live committed rows are always `COMMIT`, so the peer list was always empty.

## Fix

Match open-bucket peers on `row.status === "COMMIT"` and watch-bucket peers on `row.status === "WATCH"`.

## Evidence

`play-brief-lane-rank.test.ts` — regression with real-shaped `COMMIT` lane rows asserts non-null rank; pre-fix DeckStatus literals assert null.
