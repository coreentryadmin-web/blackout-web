# Ask Largo TRIM narrative never disclosed it is advisory-only — NRG round-tripped +132.7%→+2% with zero protection banked

> **kind:** FINDING

| | |
|---|---|
| **Status** | FIXED |
| **Severity** | P2 (product-honesty / trust — no data was wrong, but the copy read as an executed action when nothing executes) |
| **Area** | Night Hawk Swings — Ask Largo play-brief narrative (`src/lib/swing/play-brief-narrative.ts`) |
| **Found by** | Standing Ask Largo × Night Hawk Swings ownership mandate, queued as `task_7363b41e` a prior cycle, investigated and fixed this cycle (2026-09-11) |

## Root cause

`actionNarrative`'s TRIM branch renders `"**Desk says TRIM** — next rail at **+X%**. Bank
partial into strength; don't give back peak."` whenever `play.recommendation === "TRIM"`. That
copy reads as an instruction that has already been carried out, or that the platform itself will
act on. Neither is true anywhere in this product: `managementFor` in
`src/features/nighthawk/command-deck/adapters.ts` already carries the in-code comment "ADVISORY
(we recommend, you execute)" — Ask Largo is a signals/analytics panel, it never places a trade —
but that disclosure never reached the member-facing narrative text.

The costliest instance of this gap is when `trimsFired === 0` (no entry in
`play.exitPolicy.trim_levels` has `fired: true`): the trigger has already been crossed — that's
the only reason `recommendation` is `"TRIM"` at all — yet nothing has actually been banked, so
the position is still 100% exposed to a full round-trip while the copy reads like protection is
already in motion. Live proof: NRG round-tripped from **+132.7% peak to +2%** on 2026-09-11 with
zero trim ever banked. The existing "Round-tripped past breakeven" bullet (added 2026-09-10, PR
history in this same file) only fires *after* the round-trip has already happened — it is a
post-mortem, not a warning a trader could have acted on beforehand.

## Blast radius

- Single call site: `actionNarrative` in `play-brief-narrative.ts`, feeding
  `tradeManagerNarrativeSection` (the "Trade manager read" section of every OPEN swing play's Ask
  Largo brief). No other section duplicates this TRIM copy (checked `play-brief-intel.ts`'s
  `holdPlanSection`, which explicitly avoids repeating recNote/rails per its own comment).
- Every currently-OPEN swing position whose peak has crossed the +100% trim trigger but whose
  status has not (yet) latched to `"TRIM"` with a real fired rung — i.e. exactly the population
  most at risk of a silent full round-trip.

## Fix

Compute `trimsFired = trimLevels.filter(t => t.fired).length` inside the TRIM branch. When it is
`0`, append a plain, unambiguous disclosure: *"Nothing's banked yet — this is advisory only;
place the trim yourself, the desk does not execute trades."* Scoped narrowly to the
`trimsFired === 0` case (per the standing mandate's own framing of "the smallest honest fix") —
once at least one rung has actually fired, the position is no longer 100% exposed, so the
costliest version of the gap (silent full exposure) no longer applies and the disclosure does not
render, keeping the bullet from growing noisy on every TRIM line.

## Alternative considered

Disclosing on every TRIM recommendation regardless of `trimsFired` was considered (the product is
advisory-only in every case, not just this one) but rejected as broader than the smallest honest
fix the live evidence actually calls for — once a rung has fired, the "silent full exposure"
failure mode this fix targets no longer exists, and the disclosure would start reading as
boilerplate rather than a genuine warning.

## Evidence (before/after)

- RED before fix: `git stash push -- src/lib/swing/play-brief-narrative.ts` then
  `npx tsx --experimental-test-module-mocks --test src/lib/swing/play-brief-narrative.test.ts` →
  56 pass / 1 fail (new disclosure test, fix stashed out).
- GREEN after fix (`git stash pop`): same command → 57 pass / 0 fail.
- Full `src/lib/swing/*.test.ts`: 956 pass / 0 fail.
- `npx tsc --noEmit`: clean.

## Market-open validation

Pull a live swing play whose peak has crossed +100% but has not yet banked a trim (`GET
/api/market/swing/play-brief?ticker=<T>` during RTH) and confirm the "Trade manager read" section
now carries the "Nothing's banked yet — this is advisory only..." sentence, and that a play with
at least one fired trim rung does NOT carry it.
