# 2026-09-06 — G-4 calibration also ignored the CONDOR-specific VIX regime the live gate enforces — FIXED

> **kind:** FINDING

| Field | Value |
|-------|-------|
| **Status** | FIXED |
| **Priority** | P2 |
| **Area** | 0DTE / SPX Slayer — gate calibration |
| **PR** | (this branch) |

## Root cause

Same function, same bug class, as the G-6 fix earlier today (`2026-09-06-g6-condor-calibration-exemption.md`) — found while re-auditing `computeGateCalibration` for the same isCondor-awareness gap after fixing G-6.

The live G-4 enforcement in `evaluateZeroDteGates` has a dedicated `if (isCondor) { ... }` branch
(~line 790): a condor is only blocked at **extreme** VIX (≥20), unconditionally for every ticker.
17-20 (elevated) is explicitly the condor's *best* regime — fatter premium collected while the
range holds — backed by `condor-wr.mjs`'s measured 98.7% WR on shipped geometry across sessions
including the 17-20 band. Score and tape alignment play no role in this branch at all.

`computeGateCalibration`'s G-4 block computed the **directional** verdict unconditionally — VIX
≥20 → `would_block: !isIndexEtf` (index/ETF halves size instead of blocking), VIX 17-20 →
`would_block` gated on score/alignment floors — for every play, condor included. So:

- A condor at VIX 18 with a low, unaligned score got `would_block: true` pinned into
  `gate_calibration_json`, even though the live gate's condor branch never even reads score at
  that VIX level and never blocks there.
- A condor at VIX ≥20 on an index/ETF ticker (SPY/QQQ/etc.) got `would_block: false,
  would_halve_size: true` — the directional half-size carve-out — even though the live condor
  branch blocks **every** ticker outright at extreme VIX, no carve-out.

The first case is the one that actually reaches `recommendGate("g4_vix", graded)` (in
`calibration.ts`, no play_type filter): a committed, graded condor with a false `would_block: true`
verdict dilutes the would-block cohort with a row the live gate never would have blocked, using a
score-floor rule the condor's own G-4 branch doesn't apply — corrupting the same graduation
measurement the G-6 fix protected.

## Fix

Restructured both VIX-threshold branches in `computeGateCalibration` (extreme and elevated) to
check the same `isCondor` flag the function now computes once at the top (moved up from the G-6
fix so both G-4 and G-6 can share it), mirroring the live gate's condor-specific rules exactly:

- Extreme (≥20): condor → `would_block: true` unconditionally, `would_halve_size: false` (no
  index/ETF carve-out, matching the live gate).
- Elevated (17-20): condor → `would_block: false` always (best regime, no score/alignment
  dependency), directional path unchanged.
- `tier` labeling is unchanged for both play types — it still communicates the factual VIX band;
  only `would_block`/`would_halve_size` now branch on play_type.

## Evidence

- New tests, RED before / GREEN after (`git stash` on `gates.ts`, tests kept):
  - "G-4 calibration: a CONDOR at elevated VIX (18) with a low score is NOT flagged would_block" —
    failed (`would_block` was `true`) pre-fix.
  - "G-4 calibration: a CONDOR at extreme VIX (20) IS flagged would_block for every ticker, no
    index/ETF half-size carve-out" — failed pre-fix (index/ETF condor read
    `would_block: false, would_halve_size: true`).
  - `gates.test.ts`: 141/141 pass post-fix.
- `tsc --noEmit`: clean.
- Full `npm test` (Node 20): pending in this PR's evidence trail (see push).

## Blast radius

- `computeGateCalibration` only. No change to `ZeroDteVixCalibration`'s shape (no new field
  needed here — unlike G-6, a condor's G-4 verdict is a genuine, well-defined observation under
  its own rules, not a "not applicable" case, so no non-observation sentinel is required).
- `isCondor` is now computed once at the top of the function and shared by both the G-4 and G-6
  blocks (previously G-6 alone declared it, added in the same-day earlier fix) — no behavior
  change to G-6, purely a dedup of the same boolean.
- No change to the live gate's own enforcement — this fix is entirely in the calibration/
  diagnostic path.

## Fix rationale

Mirrors the G-6 fix's rationale exactly: fixing at the source (`computeGateCalibration`) keeps the
persisted `gate_calibration_json` blob honest for any reader, rather than papering over it at the
`recommendGate`/`gateVerdictOf` consumption layer. Unlike G-6, no `applicable` sentinel is needed
here — the condor's G-4 answer isn't "inapplicable," it's a real, different, well-defined verdict
(block only at extreme), so the fix computes that verdict directly rather than suppressing it.

## Market-open validation

Next commit-time cycle: spot-check a fresh PIN-sourced condor committed during an elevated-VIX
(17-20) session via `GET /api/market/zerodte/record` (or an admin export) — its
`gate_calibration_json.g4_vix` should read `tier: "elevated", would_block: false` regardless of
its own score/alignment. If VIX happens to print ≥20 intraday on a session with a condor commit,
confirm `would_block: true, would_halve_size: false` regardless of ticker (no index/ETF carve-out).
