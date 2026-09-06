> **kind:** `FINDING`

## Swing play-brief: prior-session scan stamped `recent`; closed plays falsely flagged mark absence — FIXED

| Field | Value |
|-------|-------|
| **Status** | FIXED |
| **Pri** | P2 (Largo C2/C3 contract) |
| **Area** | Night Hawk Swings — Ask Largo play-brief |

### Symptom

1. **C2:** When `scanSessionDay !== sessionDate`, envelope evidence still used `freshness: "recent"` while `unavailableSources` and `dataFreshnessSection()` correctly labeled the scan as prior-session stale.
2. **C3:** Closed plays always have `markIsSync: true` (no live `markAsOf`), but `unavailableSources`, `dataFreshnessSection()`, and `dataHonestyCoaching()` warned "mark age unknown" / "option mark" absence beside a settled `Outcome` section.

### Fix

- Stamp prior-session scan evidence `freshness: "stale"`.
- Skip `markIsSync` absence/warning paths when `play.status === "CLOSED"`.

### Evidence

- `npx tsx --test` on `play-brief*.test.ts` + `play-brief-absence.test.ts` + `play-brief-intel.test.ts` + `play-brief-narrative-coaching.test.ts`: **89/89 pass**.

| **Status** | FIXED — PR opened |
