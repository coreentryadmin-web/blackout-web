> **kind:** FINDING

## Ask Largo — BANGER-origin swing plays never show a Trough/MAE (column never existed) — FIXED

| | |
|---|---|
| **Area** | `src/lib/banger/positions-db.ts`, `src/lib/db.ts` (`banger_positions` schema), `src/lib/swing/banger-lane-merge.ts`, `src/lib/swing/live-marks-active.ts` |
| **Status** | FIXED |
| **Severity** | P3 — narrative/data-completeness gap, no wrong-number risk (the field was honestly omitted, never fabricated) |
| **Found via** | Ask Largo × Night Hawk Swings standing ownership mandate (`CLAUDE.md`), live deep-dive of `GET /api/market/swing/play-brief` |

### Root cause

`swing_positions` (the native swing-dossier ledger) has always tracked BOTH `peak_premium` (MFE,
running max mark since entry) and `trough_premium` (MAE, running min mark since entry), latched with
the standard `GREATEST`/`LEAST` pair in `updateSwingLiveState` (db.ts). `banger_positions` (Engine
B's separate ledger table, whose OPEN/PARTIAL rows are folded into the Swing lane as
BANGER-signal-kind plays by `banger-lane-merge.ts`) never got the same treatment: the table only ever
had a `peak_premium` column, and `updateBangerLiveState`'s SQL only ever ratcheted it up
(`GREATEST`) — there was no `trough_premium` column to latch a running minimum into at all.

Three consumers downstream all inherited the gap, each in a slightly different shape:
- `BangerPositionRow` (positions-db.ts) had no `trough_premium` field, so `mapBangerPositionRow`
  could never surface one even if the column existed.
- `horizonPlayFromBangerPosition` (banger-lane-merge.ts) built its `HorizonPlay` with
  `peakPremium: row.peak_premium` but the `troughPremium` key was **entirely absent** from the
  returned object (not merely `null` — never assigned), the same "field never wired" shape a prior
  finding in this file described for `unavailableSources`.
- `bangerRowToActivePlay` (live-marks-active.ts, the shared live-marks lane) **hardcoded**
  `trough_premium: null` regardless of the row's real state.

Live-confirmed on RBRK (2026-09-21, real production `GET
/api/market/swing/play-brief?playId=SWING:RBRK&ticker=RBRK`, a real committed BANGER-origin swing
position, entry $2.05 → mark $2.00, i.e. genuinely below entry): the "Position" section rendered
`Peak: +91.5%` correctly but `Trough: —`, even though the position's own live P&L (-2.4%) proves the
mark has been below entry at least once. The play-brief's own "never fabricate a missing field" rule
(`play-brief.ts` shows `—` rather than inventing a number) worked correctly — the bug is one layer
upstream: there was no column anywhere in the pipeline for a real trough to land in.

This also silently degrades the closed-play "Drawdown before outcome" narrative
(`play-brief-narrative-coaching.ts`, already shipped and correctly wired for native swing-dossier
positions — see the live INTC repro in this same audit cycle: *"this position dipped to -43.1% at
its worst before closing at -33.2%"*) for every BANGER-origin closed position: that narrative reads
`troughPremium`/`peakPremium` off the closed record, so a banger-origin loss can never show its real
intra-trade drawdown, only its final exit — a real trade-manager insight quietly unavailable for an
entire, and growing, class of Swing lane positions.

### Blast radius

Same root cause, four call sites, all fixed together (a single column + latch fixes all four):
1. `banger_positions` schema (db.ts) — added `trough_premium NUMERIC` column, mirroring the
   `last_mark_at` ALTER immediately above it (same precedent shape, FINDINGS 2026-09-11).
2. `updateBangerLiveState` (positions-db.ts) — added the `LEAST(COALESCE(trough_premium, $3), $3)`
   latch alongside the existing `peak_premium` `GREATEST` latch.
3. `BangerPositionRow` type + `mapBangerPositionRow` (positions-db.ts) — added `trough_premium`.
4. `horizonPlayFromBangerPosition` (banger-lane-merge.ts) — now forwards `troughPremium: row.trough_premium`.
5. `bangerRowToActivePlay` (live-marks-active.ts) — now forwards the real value instead of the
   hardcoded `null`.

`swingRowToActivePlay` (the native swing-dossier sibling in the same file) was already correct and
untouched.

### Fix rationale

Mirrors the existing `swing_positions.trough_premium` pattern exactly (same column type, same
`GREATEST`/`LEAST` latch shape, same `?? null` forwarding convention) rather than inventing a new
mechanism — this is the same "give banger_positions the column swing_positions already has" fix
`last_mark_at` (2026-09-11) already established as the right shape for this table's recurring
gap-vs-swing_positions pattern. Rows written before this migration keep `trough_premium` NULL
forever (Postgres does not backfill an ALTER ADD COLUMN with historical data that was never
recorded) — this is honest, not a regression: the play-brief already renders a null trough as `—`,
never fabricated, so old rows simply keep showing what they've always shown, while every row that
gets a fresh live-marks tick from here forward starts filling in for real.

### Evidence

- `npx tsx --experimental-test-module-mocks --test src/lib/banger/positions-db.test.ts
  src/lib/swing/banger-lane-merge.test.ts src/lib/swing/live-marks-active.test.ts` — 5 new
  assertions added across the three files; confirmed RED (5 failures) with `git stash` isolating
  only the source-file fix (tests unchanged), GREEN (30/30 pass) with the fix restored.
- `npx tsc --noEmit -p .` clean.
- Live repro above (RBRK play-brief, 2026-09-21).
