# 2026-11-09: 0DTE record.ts's round2 still carried the sign-bias rounding tie already fixed today in ~20 sibling files

> **kind:** `FINDING`

**Status.** FIXED — this PR.

## Summary

`src/lib/zerodte/record.ts` — the module backing `GET /api/market/zerodte/record` — defined
`round2 = (v) => Math.round(v * 100) / 100` (plain `Math.round`, which ties toward `+Infinity`),
the exact bug class a large wave of commits fixed today across ~20 independent sibling files
(`board.ts`'s `computeLedgerGrade`, `fmt-money.ts`'s `fmtPct`, `TrimScaleLadder`, swing's own
`record.ts`, and others). `git log --all -- src/lib/zerodte/record.ts` confirms no sign-bias
commit had ever touched this file. Found by this cycle's Ask Largo/5-engine Workflow (unanimous
3/3 adversarial verify, 0 refuted).

## Root cause

`round2` feeds every signed P&L percentage `GET /api/market/zerodte/record` serves:
`plan_pnl_pct`, the managed/reconstructed realized pnl, the per-bucket `avg_pnl_pct` aggregate, and
`move_pct` — all genuinely negative on real losing plays (live data: `by_outcome` `"stopped"`
`avg_pnl_pct` -51.65%, `"time_stop"` -14.83%). `Math.round(-12.5) === -12` but
`Math.round(12.5) === 13`, so a losing play's magnitude at an exact rounding-tie boundary is
silently understated relative to its winning mirror — `round2(-51.655) === -51.65` but
`round2(51.655) === 51.66`.

## Evidence (RED → GREEN)

RED (pre-fix, via `git stash` isolating only the source change): 1/57 tests failed in
`record.test.ts` (the new mirror-image sign-bias regression test).

GREEN (post-fix): 57/57 pass in that file; full `src/lib/zerodte/*` suite 1787/1787 pass (1
pre-existing skip, unrelated); `npx tsc --noEmit` clean.

## Fix

`round2 = (v) => Math.sign(v) * (Math.round(Math.abs(v) * 100) / 100)` — rounds the magnitude
correctly regardless of sign (ties always round away from zero), mirroring the exact pattern
already applied today in `board.ts`, swing's `record.ts`, and the other ~18 sibling fixes.
`round1` (used only for `win_rate_pct`, always non-negative) is left untouched — it has no sign to
preserve.

## Blast radius

One function, one file. Fixes the magnitude of `plan_pnl_pct`, managed/reconstructed pnl,
`avg_pnl_pct`, and `move_pct` on every negative value at an exact 2dp rounding tie, for every
consumer of `GET /api/market/zerodte/record` — the public 0DTE track record, Ask Largo's
`get_zerodte_record` tool, and any aggregate built from this data.
