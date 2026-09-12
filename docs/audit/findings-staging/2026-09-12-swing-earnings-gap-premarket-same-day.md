> **kind:** FINDING

## catalystCoaching's earnings-gap-safety check didn't account for BMO/AMC timing on a same-day expiry — FIXED

| **Status** | FIXED |
|---|---|

### Root cause

`catalystCoaching` (`src/lib/swing/play-brief-narrative-coaching.ts`) tells a member whether their
specific contract is exposed to an upcoming earnings gap — fixed 2026-09-11 (#4764 follow-up) to
check the OWN contract's expiry rather than a ticker-level fact. That fix's comparison was
`expiry <= earnings.earnings_date` → "no earnings-gap exposure". The `<=` is only correct for a
STRICTLY earlier expiry; a contract expiring on the SAME day as the print is not automatically
safe — it depends on the print's own BMO/AMC timing, which the comparison never looked at:

- **Premarket print, same-day expiry:** the stock gaps before the bell; a contract alive through
  that day's open experienced the gap despite "expiring on/before the print" — NOT safe.
- **After-hours print, same-day expiry:** the option settles at that day's close, before the print
  ever lands — genuinely safe.

The repo already carries this exact BMO/AMC distinction as established domain knowledge
(`meridian-reaction-core.ts`'s `classifyPrintTiming` — different input shape, same principle, not
directly reusable here since swing's `earnings.report_time` is a free-text string like
`"premarket"`/`"afterhours"`, not an HH:MM:SS time), so this wasn't an unknown risk, just not
threaded into this specific check. No test exercised the same-day case at all.

### Fix

`catalystCoaching` now treats "no gap exposure" as true only when:
1. the contract's expiry is STRICTLY before the earnings date (always safe, unchanged), OR
2. the expiry is the SAME day AND `report_time` is confirmed after-hours (`/^(after|post)/i`).

Unknown/unconfirmed timing on a same-day expiry defaults to NOT safe — falls through to the
original "size down or exit before report" warning — matching this file's existing honest-absence
discipline (never assume safety from missing/ambiguous data).

### Blast radius

Single call site, single function. No other consumer reads this branch's output differently.

### Fix rationale

Minimal, additive condition change — no new data fetched, no new section, just a narrower
definition of "safe" that matches what BMO/AMC timing actually implies for an at-risk position.

### Evidence of testing

- 3 new tests: same-day + premarket (must NOT be called safe), same-day + confirmed afterhours
  (still safe), same-day + unknown timing (must NOT be called safe).
- RED→GREEN proven via `git stash` — both of the first two fail pre-fix (premarket wrongly marked
  safe; unknown-timing case's assertion), pass post-fix.
- `play-brief-narrative-coaching.test.ts` (69 tests): pass.
- `npx tsc --noEmit`: clean.
- Full `npm test` (Node 20): **13789 pass / 0 fail / 3 skipped** (pre-existing, unrelated).

Found during the Night Hawk Swings standing aggressive-mode improvement-hunt mandate, reviewing
coaching functions adjacent to the just-shipped lane-rank fix (#4825).
