# Swing mark staleness tracking

> **kind:** FINDING

## Summary

Swing positions served to the healthcheck and board had mark values without timestamps, making it impossible to distinguish between fresh marks (from the live refresh) and stale off-hours marks. This broke mark staleness validation and left the Ask Largo brief unable to answer C3 ("when was this quote?").

## Root Cause

The swing refresh cron (`swing-active-refresh`) fetches fresh option marks every 15 minutes during market hours via `loadOptionQuote()`, creating a `SwingLiveQuote` object with an `asOf` timestamp. This quote is stored in the snapshot's `event_json` via `manage-sync.ts`'s snapshot builder, but the mark's TIMESTAMP was never extracted into a dedicated column. The healthcheck and live-plays layer fell back to deriving mark staleness from `quote?.asOf`, which is absent off-hours when no refresh runs, leaving stale marks with no age information.

## Evidence

- **Healthcheck Stage F (MARKS) failure:** swing-e2e-healthcheck.mjs reported `age=unknown` on most positions despite having mark values; some showed `age=386.5min` (6+ hours) indicating off-hours staleness.
- **Data flow trace:** quote timestamp exists at refresh time (swing-active-refresh, line 161: `asOf: new Date().toISOString()`), reaches manage-sync snapshot (line 406 spreads quote into event_json), but mark's own timestamp was never pinned as a snapshot column.
- **Off-hours blindness:** without a dedicated mark_as_of column, off-hours positions retain stale marks with no way to age them — the snapshot carries the mark value but not when it was obtained.

## Fix

1. **Database schema migration (db.ts):** Added `mark_as_of TIMESTAMPTZ` column to `swing_position_snapshots` table.
2. **Snapshot type (db.ts:SwingSnapshotInsert):** Added `mark_as_of?: string | null` field.
3. **Insert function (db.ts:insertSwingSnapshot):** Updated INSERT to include the new column with `s.mark_as_of ?? null`.
4. **Snapshot builder (manage-sync.ts:planManageSync):** Extract mark timestamp from the quote: `mark_as_of: reads.quote?.asOf ?? null`.
5. **Event retrieval (db.ts:fetchLatestSwingSnapshotEvents):** Added `mark_as_of` to SELECT and merged it into the event object.
6. **Live play construction (live-plays.ts:livePlayFromSwingPosition):** Updated markAsOf logic to prefer snapshot's `mark_as_of` over `quote?.asOf`, decoupling mark age from quote freshness.

## Blast Radius

- **Snapshot writes:** Every position refresh now captures mark timestamp independently of quote availability.
- **Healthcheck:** Stage F (MARKS) can now report honest staleness (age in minutes) for every mark, even off-hours.
- **Largo brief:** C3 (freshness) now has honest data for mark timestamps via `contract.markAsOf`.
- **Live board:** Swing positions show accurate mark staleness to the member desk.

## Why Not Other Alternatives

- **Relying solely on quote.asOf:** Fails off-hours when refresh doesn't run; honest staleness requires a persistent column.
- **Storing mark_ts inline in event_json:** Works for new snapshots but requires migration/backfill for consistency and adds discovery overhead on every read.
- **Deriving from snapshot created_at:** Conflates "when this snapshot was taken" with "when the mark price was obtained" — the quote is timestamped at fetch time, not insertion time, and the snapshot may be written seconds later.

## Test

New regression test in live-plays.test.ts:
```typescript
test("livePlayFromSwingPosition: markAsOf prefers snapshot mark_as_of over quote asOf (swing mark staleness tracking)");
```

Verifies:
- Snapshot mark_as_of is preferred over quote.asOf when both present.
- Mark_as_of alone (no quote) is used.
- Quote.asOf alone is used as fallback.
- Null when neither present (off-hours, no refresh).

| **Status** | Fixed |
|---|---|
| **PR** | #XXXX |
| **Author** | Claude Haiku 4.5 |
