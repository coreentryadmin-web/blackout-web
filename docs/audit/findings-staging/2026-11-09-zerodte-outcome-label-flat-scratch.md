# 2026-11-09: Night Hawk 0DTE outcome labels rendered raw "flat_scratch" snake_case in two live UI components

> **kind:** `FINDING`

**Status.** FIXED — this PR.

## Summary

`GET /api/market/zerodte/record?days=14`'s `by_outcome` buckets and individual play rows carry a
coarse outcome vocabulary from `record.ts`'s `managedOutcomeLabel()`: exactly `"ratchet"`,
`"thesis_break"`, `"flat_scratch"`, `"doubled"`, `"stopped"` (plus bare `"win"`/`"loss"`/
`"breakeven"`). Two live UI components each keep their own private humanization map, both built
against an older, finer-grained vocabulary (`ratchet_breakeven_floor`, `flat_theta_bleed`,
`trim_scale_first`, etc.) that was never updated when the served vocabulary collapsed to the
coarse set above:

- `src/features/nighthawk/components/NighthawkAnalyticsPanel.tsx` — `OUTCOME_BUCKET_LABEL`,
  consumed by `humanizeOutcomeLabel(b.label)` when rendering the "By exit outcome" bars
  (`BucketRows`, visible once a member expands the Session Analytics panel).
- `src/features/nighthawk/components/PlayHistoryTable.tsx` — `OUTCOME_LABEL`, consumed by
  `humanizeOutcome(p.managed_outcome)` in every play-history row's "Outcome" column (rendered
  unconditionally, not gated behind row expansion).

Both maps had `flat_theta_bleed: "flat scratch"` but no `flat_scratch` key, and `thesis_break` was
saved by a `raw.startsWith("thesis_break")` fallback in both files (because it always carries a
variable `:<source>` suffix) — but there was no equivalent fallback for the exact string
`flat_scratch`, so it fell straight through to `return raw` and rendered literally as
`"flat_scratch"` with the underscore, instead of humanized "flat scratch".

Found by this cycle's monitoring workflow; confirmed live: `GET /api/market/zerodte/record?days=14`
returned `by_outcome: [...,{"label":"flat_scratch","n":3,...}]`, and a real MSFT 2026-10-29 play row
carried `"managed_outcome": "flat_scratch"`.

## Root cause

`record.ts`'s `managedOutcomeLabel()` (see its own `FIXED 2026-09-22` comment) deliberately
collapsed the outcome vocabulary it stamps from a long tail of live engine-exit reasons down to a
small set of coarse categories via `categorizeExitReason()`:

```ts
case "ratchet":
  return "ratchet";
case "thesis":
  return "thesis_break";
case "flat":
  return "flat_scratch";
```

Both front-end humanization maps were written against the *older*, pre-collapse vocabulary (the
literal engine-exit reason strings: `ratchet_breakeven_floor`, `flat_theta_bleed`,
`trim_scale_first`, …) and were never revisited when the server-side collapse shipped. Every one of
those old keys is now effectively dead weight (the server never emits those exact strings to this
route anymore), while the new coarse codes `ratchet`, `thesis_break`, and `flat_scratch` are the
strings that actually arrive — and only `thesis_break` happened to be caught, by a fallback that
was written for its own different reason (the variable source suffix), not because anyone added
coverage for the vocabulary collapse. `flat_scratch` had no key and no fallback, so it was the one
coarse code that fell all the way through to `return raw` in both files and rendered as raw
snake_case in production.

## Evidence (RED → GREEN)

RED (pre-fix, via `git stash` isolating only the two source-file changes, regression tests left in
place):

- `PlayHistoryTable.test.ts`: 15/18 pass, 3 fail — including a live-row fixture (MSFT, 2026-10-29,
  `managed_outcome: "flat_scratch"`) whose rendered HTML contained the literal `<td>flat_scratch</td>`.
- `NighthawkAnalyticsPanel.test.ts`: 4/7 pass, 3 fail — `humanizeOutcomeLabel` wasn't even exported
  yet pre-fix, so the three new tests failed with `is not a function` (the stronger form of RED: the
  fix is a precondition for the test to run at all, not just to pass).

GREEN (post-fix, fix restored from the stash):

- `PlayHistoryTable.test.ts`: 18/18 pass.
- `NighthawkAnalyticsPanel.test.ts`: 7/7 pass.
- Both files together: 25/25 pass.
- `npx tsc --noEmit`: clean, no errors.

## Fix

Added the missing `flat_scratch: "flat scratch"` key to both `OUTCOME_BUCKET_LABEL`
(`NighthawkAnalyticsPanel.tsx`) and `OUTCOME_LABEL` (`PlayHistoryTable.tsx`) — these two maps are
explicitly duplicated rather than shared (per each file's own code comment: "duplicated rather than
imported since that map is a private module-level const, not an export"), so the fix had to land in
both or it would reappear in whichever one was missed.

Also checked the bare `"ratchet"` code (same root cause: a coarse code with no modifier suffix,
stamped directly by `managedOutcomeLabel()`'s `case "ratchet": return "ratchet"`). Unlike
`flat_scratch`, this one was NOT a visible bug — `"ratchet"` is already a plain, legible English
word, so the `return raw` fallthrough happened to render it correctly by accident. Added an explicit
`ratchet: "ratchet"` identity entry to both maps anyway (matching the existing `doubled: "doubled"`/
`stopped: "stopped"` identity entries already in both maps), so it is a documented, intentional
mapping rather than a silent fallthrough that could regress if the raw code ever grows a suffix of
its own.

Did not unify the two maps into one shared module — out of scope for this fix (closing the gap, not
refactoring the existing, explicitly-chosen duplication), and the two files already document why
they're separate.

## Blast radius

Two files, two private lookup maps, one coarse outcome code (`flat_scratch`) that was rendering raw
in both the "By exit outcome" bars (NighthawkAnalyticsPanel's collapsible breakdown) and every
play's "Outcome" column (PlayHistoryTable's always-visible row). No other consumer of this
vocabulary exists: `ZeroDteBoard.tsx`'s own `NIGHTHAWK_OUTCOME_LABEL` was checked and confirmed to
be a different vocabulary entirely (`target`/`stop`/`open`/`ambiguous`/`pending`/`unfilled` — the
BIE cross-instrument echo note's outcome, not `record.ts`'s `by_outcome`/`managed_outcome`), already
noted as such in `NighthawkAnalyticsPanel.tsx`'s own existing code comment, and is unaffected by
this bug.
