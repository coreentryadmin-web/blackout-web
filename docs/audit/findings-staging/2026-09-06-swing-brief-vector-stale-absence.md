> **kind:** `FINDING`

## Ask Largo swing brief warned on stale Vector in prose but not in `unavailableSources` — FIXED

| Field | Value |
|-------|-------|
| **Status** | FIXED |
| **Pri** | P3 (Largo C2/C3 contract gap — structured absence channel) |
| **Area** | Night Hawk Swings — `play-brief-absence.ts` |
| **PR** | (pending) |

### Symptom

When Vector desk state was present but older than 120s (`dataAgeMs > 120_000`), `dataFreshnessSection`
and `dataHonestyCoaching` already warned in narrative prose — but `collectBriefUnavailableSources`
had no matching row. Consumers reading `envelope.unavailableSources` alone (Largo C3) saw nothing
wrong despite the brief internally knowing the snapshot was stale.

### Fix

After the existing missing-Vector check, push `{ source: "Vector snapshot", reason: "stale desk state" }`
when `vectorOf(ctx).dataAgeMs > 120_000`.

### Evidence (RED → GREEN)

2 new tests in `play-brief-absence.test.ts`: stale Vector surfaces; fresh Vector does not.
Full file: 19/19 pass.
