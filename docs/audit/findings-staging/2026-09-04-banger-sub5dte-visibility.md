# Open Banger positions vanish once they age under 5 DTE

> **kind:** FINDING

| Field | Value |
|-------|-------|
| **Status** | FIXED |
| **Area** | Swing Command / Bangers (Engine B) |
| **Severity** | P1 |

## Symptom

An OPEN/PARTIAL `banger_positions` row with real member capital in it disappeared from every
view — Swing Command and (unchanged) the 0DTE board — once its contract aged down to 0–4 calendar
DTE, days before it actually expired or was closed.

## Root cause

`horizonPlayFromBangerPosition()` (`src/lib/swing/banger-lane-merge.ts`) gated an OPEN ledger row's
visibility with the same window as pre-entry discovery admission: `HORIZONS.SWING.dteMin (5) <= dte
<= HORIZONS.SWING.dteMax (15)`. That floor exists to keep the 0DTE and Swing discovery lanes from
double-admitting the same DTE range (FINDINGS.md 2026-08-06) — it answers "should a NEW candidate be
admitted into Swing," not "should an ALREADY-OPEN position still be shown." Nothing else reads
`banger_positions` once a row leaves this merge (the 0DTE board has no banger awareness), so once a
live position aged under dte=5 it was filtered out here and rendered nowhere at all — flagged twice
by Cursor's peer review on PR #3761 (`SWING-COMMAND-UNIFICATION.md` item 8 names the intended
behavior — "4-DTE weeklies stay on 0DTE unless spine changes" — but no code implemented it), and
confirmed still present on `main` after PR #3761 and its Bugbot-fix follow-up (#3773) both merged.

## Fix

`horizonPlayFromBangerPosition()` now floors at `dte >= 0` (contract not yet expired) instead of
`HORIZONS.SWING.dteMin`, keeping the `dte <= HORIZONS.SWING.dteMax` sanity ceiling. A row inside
what would be the 0DTE window (`dte < HORIZONS.SWING.dteMin`) is tagged "closing soon" in its
`reason` string so members understand why a sub-5-DTE row is on the Swing desk. Discovery-side
admission (`horizonPlayFromBangerWatch`, pre-entry WATCH rows — a genuine NEW admission) is
unchanged and still floors at `HORIZONS.SWING.dteMin`, so the 0DTE/Swing dual-admission boundary
this file's neighbor-boundary is guarding stays intact; only continuity of an existing open
position's *display* changed, not any admission gate.

## Blast radius

Only `horizonPlayFromBangerPosition()` — the pre-entry `horizonPlayFromBangerWatch()` path and
`mergeBangerPositionsIntoSwingPlays()`'s merge/collision logic are untouched. Considered but
rejected: routing sub-5-DTE rows onto the 0DTE board — the design doc names it as the eventual
target, but the 0DTE board has no `banger_positions` read path today, and wiring one is a real
architectural change (out of scope for a single-issue fix); left as a documented follow-up
(`SWING-COMMAND-UNIFICATION.md` item 8).

## Evidence

`src/lib/swing/banger-lane-merge.test.ts` — 4 new tests: an OPEN row at dte=2 stays visible and is
tagged "closing soon"; an expired contract (dte<0) is still excluded; a contract beyond
`HORIZONS.SWING.dteMax` is still excluded; a normal-window row (dte=8) is NOT tagged "closing soon".
Confirmed RED pre-fix (git-stash) / GREEN post-fix. Full suite + `tsc --noEmit` clean on Node 20.

## RTH validation

See `docs/audit/MARKET-OPEN-VALIDATION.md` §29 — confirm a live OPEN banger position inside its
final week before expiry still renders on Swing Command with a "closing soon" cue, rather than
disappearing.
