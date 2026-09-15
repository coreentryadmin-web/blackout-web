> **kind:** FINDING

## Swing play-brief roll-history date used the raw UTC calendar day instead of the ET session date (Largo C1) — FIXED

**Status:** FIXED — `fix/swing-roll-date-utc-not-et`

### Root cause

`rollHistoryLine()` (`src/lib/swing/play-brief-narrative.ts:747-750`) formatted a roll's date via
`new Date(curr.committedAt).toISOString().slice(0, 10)` — the raw UTC calendar day. `committedAt`
is a bare `TIMESTAMPTZ` instant with no ET labeling (`db.ts` stamps it via plain `.toISOString()`).
Slicing its UTC date is exactly the anti-pattern `bar-session-date.ts`'s own header warns against,
and inconsistent with the identical field elsewhere in the same brief:
`siblingPositionsNote` (`play-brief.ts:196`) already uses `etStampFromIso(r.committedAt)` for the
same `committedAt` field on a sibling position. `play-brief-narrative.ts` never imported any ET
helper at all — the one file in this cluster that reimplemented date formatting instead of using
the shared C1 helper.

### Evidence

- Direct source read confirmed the raw `.toISOString().slice(0, 10)` call and the absence of any
  ET-helper import in the file.
- Confirmed `etSessionDate(tMs)` (`bar-session-date.ts:51`) is the exact shared helper for this —
  takes epoch-ms, returns the ET calendar date.
- Confirmed the same field is correctly ET-converted at `play-brief.ts:196` via `etStampFromIso`.

### Blast radius

Currently bounded but real: the only production write path for a roll leg's `committed_at` is
`manage-sync.ts` via `swing-active-refresh`, which is `market_hours_only: true` (9:30am-4pm ET),
so no live commit crosses a UTC-midnight boundary today — no wrong date has actually been observed
in production. But it's a genuine latent bug: any roll landing near/after 8pm ET during EST (if
that gate is ever loosened, or an admin/backfill sets `committed_at` outside RTH) would display the
day *after* the true roll session, misleading a member about when the roll actually happened.

### Fix

Imported `etSessionDate` from `@/lib/largo/temporal/bar-session-date` and replaced the raw
`.toISOString().slice(0, 10)` with `etSessionDate(Date.parse(curr.committedAt))`.

### Fix rationale

Reused the existing shared C1 helper (the same one `siblingPositionsNote` already uses for the
identical field) rather than reimplementing ET conversion locally — the entire reason the shared
helper exists per its own module header.

### Tests

- `src/lib/swing/play-brief-narrative.test.ts`: new test using a `committedAt` of
  `2026-01-20T02:00:00.000Z` (9pm EST Jan 19 — straddles UTC midnight) asserting the rendered date
  reads `2026-01-19` (the true ET session date), not `2026-01-20` (the raw UTC calendar day).
- RED→GREEN proof: `git stash` on `play-brief-narrative.ts` reproduced 1 failing test against the
  pre-fix tree; restoring the fix returned the suite to green (84/84). Existing tests (which all use
  RTH-hours `committedAt` values where UTC and ET land on the same calendar day) were unaffected.
- `npx tsc --noEmit`: clean.
