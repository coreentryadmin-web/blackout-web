> **kind:** `FINDING`

## Swing play-brief: timestamped but stale option marks invisible to C2/C3 — FIXED

| Field | Value |
|-------|-------|
| **Status** | FIXED |
| **Pri** | P2 (Largo C2/C3 contract) |
| **Area** | Night Hawk Swings — Ask Largo play-brief |

### Symptom

`markIsSync === true` (no timestamp) correctly surfaced in `unavailableSources`, Data freshness, and coaching. A mark **with** `markAsOf` but older than `ZERODTE_MARK_STALE_MS` only got `provenance.freshness: "stale"` on an evidence row — no `UnavailableChip`, no freshness-section callout, no coaching line. PlayTerminal already dims stale marks; the brief did not.

### Fix

- `optionMarkIsStale()` in `play-brief-absence.ts` (same 5s window as PlayTerminal).
- Surfaces through `collectBriefUnavailableSources`, `dataFreshnessSection`, `dataHonestyCoaching`.

### Evidence

- `npx tsx --test` on `play-brief-absence.test.ts` + `play-brief-intel.test.ts` + `play-brief-narrative-coaching.test.ts`: **85/85 pass** (4 new regression tests).

| **Status** | FIXED — PR opened |
