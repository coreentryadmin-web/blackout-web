# Swing "Thesis health" — committed positions never received a real REGIME read — FIXED (partial)

> **kind:** FINDING

| Field | Value |
|-------|-------|
| **ID** | BO-P3-swing-thesis-health-regime-wiring |
| **Priority** | P3 |
| **Area** | Ask Largo / Night Hawk Swings — thesis health |
| **Status** | FIXED (one of three uncalibrated pillars; two remain deferred) |

## Symptom

Root-caused during the standing Ask Largo deep-dive mandate (raised on PR #4076 comments
5556702365, 5570100676, 5570557... — this session's own comments 5569898647/5570100676):
`GET /api/market/swing/play-brief` for real committed HOLD positions (NRG SWING:NRG:34,
CG SWING:CG:25) returns a "Thesis health" section reading a generic scaffold —
`"Inputs not wired for committed positions — aggregate score withheld; pillar breakdown not
shown."` — for every live position, regardless of ticker or setup, because
`computeSwingThesisHealth()` (`thesis-health.ts`) is fed `setupState`/`entryStatus`/`regime`/
`signalKinds` off `HorizonDeckSource`, and `live-plays.ts`'s `livePlayFromSwingPosition()` (the
ONE function that builds the `HorizonPlay` carrying a live/committed position into that pipeline)
never populated any of them — confirmed by grep: zero hits for `setupState:`/`entryStatus:`/
`regime:`/`signalKinds:` in that file's return object before this fix.

## Root cause

`HorizonPlay` (`horizon-plays.ts`) already declares `regime?: string | null` and `signalKinds?:
string[]` as optional fields — the type was never the blocker (an earlier comment on this thread
briefly mis-diagnosed this as a missing-field problem on the wrong interface; corrected in-thread).
The actual gap: `livePlayFromSwingPosition()` simply never set them when constructing the return
object for a live ledger row, so every committed position's `HorizonDeckSource.regime` read
`undefined` and fell through to `thesis-health.ts`'s `regimeScore()` default (`base = regime ?
0.75 : 0.45` → always 0.45, label `"unread"`).

`regime` specifically has a real, already-persisted source: `commit.ts`/`feature-vector.ts` pin a
7-pillar dossier (`SwingFeatureVector`) onto `row.feature_vector` at commit time, including
`pil_regime` — a 0-1 score, `null` when that pillar wasn't grounded, never a fabricated 0. That
value was sitting unused.

## Fix

`livePlayFromSwingPosition()` now derives `regime` honestly: the archetype label when
`row.feature_vector.pil_regime` is a real number (the dossier actually scored REGIME at commit),
`null` otherwise — never a guess. This flows through the existing, already-correct chain
(`HorizonPlay.regime` → `HorizonDeckSource.regime` → `computeSwingThesisHealth`'s `regime` input →
`regimeScore()`), so no other file needed a change.

## Blast radius

Single call site: `livePlayFromSwingPosition` (`src/lib/swing/live-plays.ts`) → every consumer of
`livePlaysFromOpenPositions`'s output (the swing command deck's live sections, Ask Largo's swing
play-brief). No schema change, no new DB read, no new IO — the value was already on the row.

## Scope explicitly NOT covered by this fix (tracked, deferred — see PR #4076 comments)

`thesisHealthUncalibrated()` gates on THREE pillar labels (persistence/entry_geometry/
flow_corroboration), not `regime` — so this fix alone does **not** flip a committed position's
Thesis Health section off the generic scaffold; that requires `setupState`/`entryStatus`/
`signalKinds` too, which are NOT cleanly recoverable from the committed position row:
- `setupState`/`entryStatus` are pre-entry WATCH-lane observables (`serving-ingest.ts`) that are
  never persisted onto the committed position row at commit — recovering them needs either a new
  commit-time write (schema/write-path change) or accepting they're inherently pre-entry-only
  concepts that may not have a committed-position equivalent (`entry_geometry` in particular —
  AT_TRIGGER/PULLBACK/CHASE describes execution stance BEFORE entry).
- `signalKinds` (discovery provenance — FLOW/STRUCTURE/CATALYST) lives on the SEPARATE
  `swing_candidate_accumulation` table, keyed by ticker+direction, and is never copied onto the
  position row at commit either. Recovering it needs a JOIN read at request time (N+1 query risk
  worth measuring first) or a write-path change — deliberately left out of this PR to keep it
  single-issue and read-only.

This is a genuine partial fix, not a full resolution — flagged as such in the PR and on the
collaboration thread so a future session doesn't read "Thesis health" as solved.

## Evidence

RED→GREEN: two new tests in `live-plays.test.ts` — `regime is honestly null when the dossier's
REGIME pillar wasn't grounded` (fails pre-fix: old code always returns `undefined`, test expects
`null` — a type-level pass either way, so verified failure mode is the SECOND test) and `regime
surfaces the archetype label when the dossier's REGIME pillar was grounded` (fails pre-fix:
`undefined !== "BREAKOUT"`). `git stash` on `live-plays.ts` alone confirmed 2/16 failing pre-fix,
16/16 passing post-fix. Full run: `node --import tsx --experimental-test-module-mocks --test
src/lib/swing/live-plays.test.ts src/lib/swing/thesis-health.test.ts src/lib/swing/play-brief.test.ts
src/features/nighthawk/command-deck/terminal-display.test.ts` — 74/74 pass. `npx tsc --noEmit` —
clean.
