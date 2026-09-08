# 2026-09-06 — G-6 calibration verdict ignored the CONDOR exemption the live gate enforces — FIXED

> **kind:** FINDING

| Field | Value |
|-------|-------|
| **Status** | FIXED |
| **Priority** | P2 |
| **Area** | 0DTE / SPX Slayer — gate calibration |
| **PR** | (this branch) |

## Root cause

`src/lib/zerodte/gates.ts`'s live G-6 enforcement (`evaluateZeroDteGates`, ~line 1095) is scoped
`if (!isCondor)` — a delta-neutral condor has no directional side, so it structurally cannot
"oppose" another desk's take, and the code comment says exactly that ("DIRECTIONAL ONLY").

`computeGateCalibration(input)` — a *separate* function called unconditionally for every
candidate (directional or condor) to pin a diagnostic verdict onto `gate_calibration_json` for
later graduation analysis — computed its own G-6 conflict block from the *same* `ZeroDteGateInput`
but never read `input.play_type`/`isCondor` at all. So a PIN-sourced condor that happened to
correlate-and-oppose a live SPX Slayer/Night Hawk take, at a score under `CONFLICT_SCORE_FLOOR`
(65), got `conflict: true, would_block: true` pinned into calibration even though the live gate
never blocked it (never even evaluated G-6 for it).

That pinned blob is read back by `gateVerdictOf(row, "g6_conflict")` → `recommendGate("g6_conflict",
graded)` in `calibration.ts`, which buckets **all** graded rows (no play_type filter) into
would-block vs would-pass cohorts to decide whether G-6 should harden further. A mislabeled condor
row lands in the would-block cohort and gets graded on its own credit-sell WIN/LOSS geometry —
structurally unlike a directional win/loss — contaminating the win-rate-delta measurement the
graduation decision depends on.

This is the same "population/cohort mismatch" bug class found repeatedly this session elsewhere
(Thermal, Helix, Vector, Meridian, Night Hawk scorer): two related computations reading the same
underlying input under two different scopes.

## Fix

- Added `isCondor = input.play_type === "CONDOR"` inside `computeGateCalibration`, mirroring the
  live gate's own scoping, and short-circuit the G-6 verdict to `conflict: false, against: [],
  would_block: false` for a condor — the same answer the live gate gives (never blocks).
- Added a new `applicable: boolean` field to `ZeroDteConflictCalibration` (`false` for condor,
  `true` for directional) so the "not applicable" case is distinguishable from a genuine
  "evaluated, no conflict" pass — same pattern G-4 already uses (`tier: "unknown"`) to mark a
  non-observation.
- Updated `gateVerdictOf` in `calibration.ts` to return `null` (non-observation) for
  `g6_conflict` when `applicable === false`, exactly mirroring its existing `g4_vix`/`tier ===
  "unknown"` handling — so a condor row neither dilutes the would-block bucket (old bug) nor the
  would-pass bucket (the bug a naive `would_block: false` fix alone would have introduced).

## Evidence

- New tests, RED before / GREEN after (`git stash` on `gates.ts` + `calibration.ts`, tests kept):
  - `gates.test.ts`: "G-6 calibration: a CONDOR correlated-and-opposed at a low score is NOT
    flagged conflict — mirrors the live gate's exemption" — failed `true !== false` pre-fix.
  - `calibration.test.ts`: "gateVerdictOf: a CONDOR's G-6 (applicable:false) is a non-observation,
    not a pass vote" — failed `false !== null` pre-fix.
  - Both pass post-fix; `gates.test.ts` + `calibration.test.ts` together: 187/187 pass.
- `tsc --noEmit`: clean.
- Full `npm test` (Node 20): pending in this PR's evidence trail (see push).

## Blast radius

- `ZeroDteConflictCalibration` gained one required field (`applicable`). Only one construction
  site in the codebase (`computeGateCalibration` itself) — checked via repo-wide grep. Existing
  test fixtures that hand-build a `g6_conflict: {...}` blob (calibration.test.ts, scan.test.ts,
  ZeroDteBoard.test.ts) are untyped `Record<string, unknown>` literals read back via
  `gateVerdictOf`'s duck-typed access, not typed against `ZeroDteConflictCalibration` — none
  needed updating; `applicable` absent on those older fixtures is treated as "applicable" (the
  `=== false` check only fires when explicitly set).
- No change to the live gate's own enforcement (`evaluateZeroDteGates`'s G-6 block) — this fix is
  entirely in the calibration/diagnostic path, which never blocks a real commit.

## Fix rationale

Fixing only at the `gateVerdictOf` consumption layer (e.g. by inferring condor from
`entry_context.play_type` there) would have left the persisted `gate_calibration_json` blob itself
semantically wrong for any other reader (e.g. an admin UI rendering `would_block: true` for a play
the live gate never blocked). Fixing at the source (`computeGateCalibration`) and adding the
`applicable` field keeps the persisted diagnostic honest at write time, with the `gateVerdictOf`
change as the belt-and-suspenders non-observation handling that the existing G-4 pattern already
established as the house convention.

## Market-open validation

Next commit-time cycle: spot-check a fresh PIN-sourced condor's `gate_calibration_json.g6_conflict`
via `GET /api/market/zerodte/record` (or an admin export) — it should read
`applicable: false, conflict: false, would_block: false` regardless of any live Slayer/Night Hawk
conflict on a correlated ticker. No live UI surface renders this field directly today, so this is
a data-correctness check on the persisted blob, not a rendered-page check.
