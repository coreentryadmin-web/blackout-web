## `buildSpxDeskPulse` served stale, one-session-too-recent `pdh`/`pdl` during the cross-midnight off-hours window — the sibling of an already-fixed `prior_close` bug, left unfixed when that fix landed — FIXED

> **kind:** `FINDING`

| Field | Value |
| --- | --- |
| **Status** | FIXED |
| **Severity** | P2 (live, member-facing data-correctness defect, but narrow trigger window and self-corrects once the next session starts) |
| **Component** | `src/features/spx/lib/spx-desk.ts`, `buildSpxDeskPulse` (feeds `/api/market/spx/pulse` and, via `mergePulseIntoDesk`'s `stickyStructureLevel("pdh"/"pdl", ...)`, `/api/market/spx/merged` — the live SPX dashboard's "Prior-day high"/"Prior-day low" tiles, `SpxSniperHeader`) |

### Root cause

This exact off-hours branch has a documented history of three prior live incidents, all the same
shape: a value gets re-anchored for one calendar-date corner case, but a sibling value that should
move in lockstep is left reading the pre-correction object. The specific chain for this instance:

1. Line ~2103 snapshots the TRUE, exclusive-of-today prior session's levels:
   `const priorDayLevels = { pdh: prior.pdh, pdl: prior.pdl, pdc: prior.pdc };`
2. Line ~2139, once today's own session has settled: `prior = { ...todaysOwnClose, pdh:
   priorDayLevels.pdh, pdl: priorDayLevels.pdl };` — `prior.pdh`/`prior.pdl` are captured **by
   value** from `priorDayLevels` as it stood at that instant.
3. Lines ~2155-2158 (only once `todaysOwnClose.prior.pdc != null`, i.e. specifically in the
   cross-midnight stretch where `priorDayLevels`'s own `todayEtYmd()`-anchored walk-back has
   already rolled onto the wrong day): `priorDayLevels.pdh = todaysOwnClose.prior.pdh;
   priorDayLevels.pdl = todaysOwnClose.prior.pdl; priorDayLevels.pdc = todaysOwnClose.prior.pdc;`
   — this corrects `priorDayLevels` **in place**, but nothing re-syncs `prior.pdh`/`prior.pdl`,
   which were already copied out at step 2, before this correction ran.
4. The final return (was line ~2182-2184) read `prior_close: priorDayLevels.pdc` (correctly
   reflecting step 3's correction) alongside `pdh: prior.pdh, pdl: prior.pdl` (the stale, step-2
   values — never touched by step 3).

So for the entire window this correction block exists to handle, the payload served a correctly
re-anchored `prior_close` next to a `pdh`/`pdl` pair one trading session too recent — internally
inconsistent within the same response.

### Why this wasn't caught earlier

Confirmed via `git blame`: `prior_close: priorDayLevels.pdc` was fixed on 2026-10-08 (commit
`9cf7af54df`) as part of the "midnight-rollover" fix series for this file (PRs #5729/#5735/#5740/
#5744, all in `FINDINGS.md`/the file's own header comments). `pdh: prior.pdh, pdl: prior.pdl`
dates back to commit `771089d8db` (2026-09-05) and was never touched by any of those fixes — the
2026-10-08 fix correctly identified and fixed the bug for `prior_close` but didn't notice `pdh`/
`pdl` needed the identical treatment, despite sitting two lines below in the same return statement.
The existing test file (`spx-desk-offhours-spot.test.ts`) has a dedicated regression test for the
`prior_close` sibling fix (`"buildSpxDeskPulse: EXTENDED-hours override must NOT roll prior_close
forward..."`) but had no equivalent assertion for `pdh`/`pdl` reading from the corrected object —
only an earlier, narrower test guarding the 2026-10-07 "`prior = todaysOwnClose` wholesale
replacement" bug, which is a different failure mode than this one.

### Evidence

RED→GREEN, via `git stash`: with the fix reverted, the new regression test
(`"buildSpxDeskPulse: off-hours return must serve pdh/pdl from the corrected priorDayLevels, not
the stale pre-correction prior (2026-10-11 fix)"`) fails (1 fail / 12 pass in
`spx-desk-offhours-spot.test.ts`); with the fix restored, 13/13 pass. Full `src/features/spx/lib/
*.test.ts` suite: 832/832 pass. `npx tsc --noEmit`: clean.

### Fix

`pdh: prior.pdh, pdl: prior.pdl` → `pdh: priorDayLevels.pdh, pdl: priorDayLevels.pdl`, mirroring
the already-correct `prior_close: priorDayLevels.pdc` immediately above it. Outside the
cross-midnight correction window the two objects hold identical values (step 2 above copies
`priorDayLevels` into `prior` verbatim when the correction never fires), so this is a no-op change
in every other case — same reasoning the original `prior_close` fix relied on.

### Fix rationale

Read from the single object (`priorDayLevels`) that the correction block is defined to mutate,
rather than from the two-steps-removed `prior` object that only transiently held the same values.
No alternative considered: this is the literal sibling of the already-shipped `prior_close` fix,
same root cause, same remedy shape, deliberately matched rather than re-derived independently.

### Blast radius

Single call site — `prior.pdh`/`prior.pdl` are not read anywhere else in this return block or
function. The sibling `buildSpxDesk` route (`priorFromBars`, a structurally different code path per
this file's own 2026-10-09 fix history) was checked and does not share this bug — it never builds a
`priorDayLevels`/`prior` pair with this two-object correction shape.

### Regression guard

New test added to `src/features/spx/lib/spx-desk-offhours-spot.test.ts`, matching the file's
existing source-pattern-regex convention (this is a 2500+ line function where mocking the full
async provider chain for a true runtime unit test is impractical — same tradeoff every other test
in this file already makes, each with its own documented live-repro evidence in its comment).
