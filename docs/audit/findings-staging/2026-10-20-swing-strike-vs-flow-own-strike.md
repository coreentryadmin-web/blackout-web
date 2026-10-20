## "Strike vs flow" mismatch line named the flow's magnet strike but never the pick's own strike — FIXED (enhancement)

> **kind:** `FINDING`

| | |
|---|---|
| **Status** | Fixed (`src/lib/swing/play-brief-intel.ts`) |
| **Severity** | P3 — narrative-completeness enhancement, not a correctness bug |
| **Found via** | Ask Largo standing audit mandate (Night Hawk Swings lane), live play-brief deep audit against `docs/audit/LARGO-PRODUCT-CONTRACT.md` after the "Invalid time value" outage cleared |

### Live repro

A real committed NVDA play-brief's "Why this setup" section read:

> **Strike vs flow:** the accumulation flow's magnet strike was **$225**; this pick landed at a
> different strike (chosen independently on tradability/fit).

The Verdict section two sections above names the actual pick ("NVDA 212.5C 1DTE"), but a member
reading only this section — the one specifically meant to explain the setup's relationship to the
flow signal — has no way to tell *how far* $212.5 is from the $225 magnet without cross-referencing
a different section. The matched-pick branch right above it already names its one shared strike
("this contract's strike (**$180**) matches...") — the mismatch branch is the one place the
comparison was one-sided.

### Root cause

`whyThisSetupSection` (`play-brief-intel.ts`) only has `play.topFlowProvenance.topFlowStrike`
(the flow's magnet strike) in scope for this line — the pick's own strike was never threaded in,
even though it's readily available: `play.occ` (the OCC symbol already carried on every
`TerminalPlay`) encodes it, and the shared `parseOccSymbol` helper (`@/lib/largo/core/entities.ts`)
is already the established pattern this exact file family uses for this exact need (see
`play-brief-narrative-coaching.ts`'s `parseOccSymbol(play.occ ?? null)`).

### Fix

Parse `play.occ` via the shared `parseOccSymbol` and, when it resolves, include the pick's own
strike directly in the mismatch sentence: `"...magnet strike was **$225**; this pick used
**$212.5** instead (chosen independently on tradability/fit)."` When `occ` is absent or doesn't
parse, falls back to the pre-existing generic wording — never fabricates a strike, matching this
section's own honest-absence discipline for every other field.

### Blast radius

Single call site; the matched-pick (corroboration) branch is untouched since it already names its
one shared strike. No other section reads `topFlowProvenance`.

### Regression test

Added two tests to `src/lib/swing/play-brief-intel.test.ts`:
- `"the mismatch line names the pick's OWN strike too, when occ resolves it"` — RED before the fix
  (`occ: "NVDA261121C00212500"` produced the old generic wording), GREEN after (`$212.5` resolved
  and rendered).
- `"mismatch line falls back to the generic wording when occ can't be parsed (never fabricated)"` —
  proves the fallback path still works when `occ` is null.

RED→GREEN proven via `git stash` isolation on `play-brief-intel.ts` alone. Full
`play-brief-intel.test.ts` suite: 270/270 pass. Full `npm test`: 16383 pass / 0 fail / 3 skipped on
Node 20. `tsc --noEmit`: clean.
