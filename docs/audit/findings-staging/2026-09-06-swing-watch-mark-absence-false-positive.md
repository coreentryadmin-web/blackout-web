# Swing WATCH rows falsely flagged as option mark unavailable — FIXED

> **kind:** FINDING

| Field | Value |
|-------|-------|
| **Status** | FIXED |
| **Priority** | P1 |
| **Area** | Night Hawk Swings / Ask Largo (C3 absence) |
| **PR** | (this branch) |

## Symptom

WATCH candidates on the Swings desk carry a static chain mid with no `markAsOf` timestamp
(`markIsSync: true` by design in `adapters.ts`). The play-brief absence collector treated this
as a structured C3 failure (`option mark: sync quote without freshness timestamp`), surfacing
an `UnavailableChip` on the most common Ask Largo surface even though the quote shape is
expected pre-entry.

Same false positive appeared in `dataHonestyCoaching` and `dataFreshnessSection` prose.

## Root cause

`markIsSync === true && status !== "CLOSED"` was too broad — it included WATCH (and SKIP)
rows that never expect a live-synced mark.

## Fix

Introduced `playExpectsLiveOptionMark()` — only OPEN/HOLD/TRIM rows expect live mark freshness.
Applied consistently in `play-brief-absence.ts`, `play-brief-narrative-coaching.ts`, and
`play-brief-intel.ts`.

## Validation

- `npx tsx --test src/lib/swing/play-brief-absence.test.ts`
- `npx tsx --test src/lib/swing/play-brief-narrative-coaching.test.ts`
- `npx tsx --test src/lib/swing/play-brief-intel.test.ts`

## RTH check

On a WATCH row in Night Hawk Swings, open Ask Largo — confirm no `UnavailableChip` for
"option mark" when the only issue is the expected static chain mid.
