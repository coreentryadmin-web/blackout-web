# Ask Largo swing thesis-health dead-wired to identical reading for every live position — FIXED

> **kind:** `FINDING`

| Field | Value |
|-------|-------|
| **ID** | BO-CRIT-LARGO-002 |
| **Priority** | Critical |
| **Area** | Night Hawk Swings / Ask Largo |
| **Status** | FIXED |
| **Source** | `docs/audit/SWING-SYSTEM-CTO-AUDIT-2026-09-06.md` findings #3, #8, #9, #17, #20 |

## Symptom

Every live/committed swing position's Ask Largo play-brief rendered the byte-identical
`46% · Degraded` thesis-health score, regardless of actual play quality — confirmed live on all
4 currently-committed positions (NRG +98.0% P&L, NN 0.0% P&L, CG +33.7% P&L, CRWD +24.6% P&L all
showed the same reading with identical pillar labels: Persistence "unknown", Entry geometry "n/a",
Signal stack "no signals", Regime fit "unread").

## Root cause

`computeSwingThesisHealth()` (`thesis-health.ts`) is real, non-trivial weighted scoring logic — not
a stub. The bug is upstream: `livePlayFromSwingPosition` (`live-plays.ts`), which builds the
`HorizonPlay` for every OPEN/HOLD/TRIM committed position, never populates `factors` or `regime`.

`serving-lane.ts`'s `getSwingServingLane()` already fixed this exact symptom for the main
`/horizons` board via `attachThesisExplanation()` — its own header comment begins "THE BUG." and
explains that a committed row evicts its pre-entry twin (the only carrier of `factors`/`regime`)
the moment it commits. But `play-brief-resolve.ts`'s `loadOpenTerminalPlay` — the resolver behind
`GET /api/market/swing/play-brief`, the Ask Largo endpoint — called `livePlayFromSwingPosition`
directly with no equivalent restoration step, so the board-level fix never reached Ask Largo.

## Fix

- Exported `attachThesisExplanation` and `dossiersByTicker` from `serving-lane.ts` (previously
  module-private).
- `loadOpenTerminalPlay` now calls `discoverSwingFromPersisted()` to get the current dossier index,
  and applies `attachThesisExplanation(lanePlay, dossier, reads)` before converting to a
  `TerminalPlay` — mirroring exactly what the main board already does.
- Exported `loadOpenTerminalPlay` (previously module-private) for direct testability.

## Evidence

- New regression test suite `play-brief-resolve.test.ts` — 2 new tests: a committed row with a
  matching dossier gets a non-"unread" regime pillar; a committed row with no matching dossier is
  left honest (regime pillar stays "unread", never an invented value).
- RED→GREEN proven via `git stash` isolating the fix commit: pre-fix, `mod.loadOpenTerminalPlay is
  not a function` (neither the export nor the wiring existed); post-fix, both tests pass.
- `npx tsc --noEmit` — clean.
- `node --experimental-test-module-mocks --import tsx --test src/lib/swing/*.test.ts
  src/features/nighthawk/**/*.test.ts` — 1948/1948 pass, no regressions.

## Blast radius

- `src/lib/swing/serving-lane.ts`: two functions changed from module-private to exported — pure
  API-surface widening, no behavior change to existing callers.
- `src/lib/swing/play-brief-resolve.ts`: `loadOpenTerminalPlay` now makes one additional cache read
  (`discoverSwingFromPersisted()`, a shared-cache GET — matches the existing convention in this same
  function, which already independently calls `readSwingServingSnapshot()`) per Ask Largo request
  for a live/committed position. No change to closed-play or WATCH-lane resolution paths.

## Scope note — partial fix, by design

This restores the **regime** pillar (15% of thesis-health's weight — reads both `regime` and
`factors[0]`) with real per-position data whenever a matching dossier exists. It does **not** fix
the **persistence** (28%), **entry_geometry** (22%), or **flow_corroboration** (20%) pillars, which
read `setupState`/`entryStatus`/`signalKinds` — fields `attachThesisExplanation` deliberately does
NOT copy onto a live row (copying them risks moving a managed position back into a pre-entry
section, a worse bug than the one being fixed here). Wiring those three pillars needs either a live
equivalent derived from the ledger row's pinned entry/invalidation/target prices, or a redesign of
what those pillars mean for an already-committed position — tracked as follow-up work, not in scope
for this fix.
