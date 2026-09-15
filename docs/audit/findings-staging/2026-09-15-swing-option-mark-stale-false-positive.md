> **kind:** FINDING

## Swing play-brief "option mark" freshness chip false-positives on normal, on-schedule marks — FIXED

**Status:** FIXED (`src/lib/swing/play-brief-absence.ts`)

### Root cause

`optionMarkIsStale` (the check behind the Ask Largo swing play-brief's "option mark" unavailable-source
chip and the `Data freshness` section) classified an OPEN/HOLD/TRIM position's persisted
`markAsOf` timestamp using the generic cross-product freshness bucket
(`freshnessFromObservedMs`/`freshnessFromAgeMs`, `src/lib/bie/answer-envelope.ts`): `stale` at
10 minutes old.

That bucket is correct for feeds that refresh on a much tighter cadence (0DTE/Vector's live-marks
lanes), but a swing position's persisted `markAsOf` has exactly ONE writer: the
`swing-active-refresh` cron (`cron-registry.ts`), which runs every 15 minutes during market hours.
There is no faster writer for this specific DB column — the shared ~1s "live-marks lane"
(`live-marks-active.ts`) feeds an ephemeral Redis/SSE display path for the Swing Command UI, not
the `swing_positions.last_mark_at` column `live-plays.ts` reads for the brief.

Under fully healthy, on-schedule operation this means `markAsOf` legitimately ranges from 0 to
~15 minutes old at any given read — and the 10-minute generic threshold fired "stale" on
perfectly fresh, on-schedule data for roughly the last third of every 15-minute cycle.

### Evidence

Live, 2026-09-15, ~15:13 ET (RTH): fetched `GET /api/market/swing/play-brief` for two real
committed positions, CRWD (`positionId=39`) and AAPL (`positionId=38`). Both had
`markAsOf = 2026-09-15T19:00:00.000Z` — exactly the prior `:00` `swing-active-refresh` tick, 13
minutes before the read — yet both briefs' `unavailableSources` carried:

```json
{"source": "option mark", "reason": "stale — last synced 2026-09-15 15:00 ET", "retryable": true}
```

13 minutes is well inside one healthy 15-minute refresh cycle; this is not a real data gap.

### Fix

Added a swing-specific staleness threshold (`SWING_OPTION_MARK_STALE_MS = 18 * 60_000`, 18
minutes — one full 15-minute cycle plus margin for a slightly delayed tick) in
`optionMarkIsStale`, replacing the generic 10-minute bucket for this one call site. The
future-skew fail-closed guard (Largo C2, clock-skewed marks reading stale rather than fresh) is
preserved unchanged.

### Blast radius

`optionMarkIsStale` has exactly one call site (`collectOptionMarkStalenessAbsence`, same file),
which itself has exactly one call site (`collectBriefUnavailableSources`, the swing play-brief's
absence collector) — the fix is scoped to the swing play-brief only and does not touch 0DTE or
Vector's own (correctly tight) freshness checks.

### Test

`src/lib/swing/play-brief-absence.test.ts` — two new tests: a 13-minute-old on-schedule mark must
NOT read stale (RED pre-fix, GREEN post-fix — confirmed via `git stash` before/after), and a mark
past 18 minutes (a missed scheduled refresh) must still read stale. Full suite:
`npx tsc --noEmit` clean, `npm test` 14315/14318 pass (3 pre-existing skips), 0 fail.
