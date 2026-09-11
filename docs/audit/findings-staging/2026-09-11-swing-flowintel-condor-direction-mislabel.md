> **kind:** FINDING

## Ask Largo — `flowIntelSection`'s 0DTE cross-desk alignment mislabels a committed CONDOR's nominal direction as a real directional call — FIXED

| **Status** | FIXED |
|---|---|
| **Severity** | P3 (currently latent — condor-record.ts's own header measured ZERO condor commits in the last 90 days as of 2026-08-21 — but a live, correctness bug the moment one commits, not hypothetical) |
| **Surface** | Night Hawk Swings — Ask Largo play-brief "Flow & positioning" section |
| **Files** | `src/lib/bie/ecosystem-context.ts`, `src/lib/swing/play-brief-intel.ts` |

### Root cause
`flowIntelSection` (`src/lib/swing/play-brief-intel.ts`) reads `eco.zerodte_today.direction` and
compares it against the swing play's own direction to print "0DTE desk: **long/short** ·
**aligned**" or "**conflict** with swing direction". `zerodte_today` is sourced from
`zerodte_setup_log`, the SAME table both directional 0DTE plays AND committed iron CONDORs persist
into (unique key `(session_date, ticker)` — one row either way).

For a CONDOR row, `direction` is explicitly documented as NOMINAL provenance only — `board.ts`'s
own `ZeroDteSetup.direction` doc comment: *"For a CONDOR, `direction` is NOMINAL provenance only
(the fade side of the pin it came from); the structure is neutral, so the directional gates and
the −50/+100 grader do NOT apply to it."* A sold iron condor is delta-neutral by construction — it
is not a directional bet in either direction. `flowIntelSection` had no way to distinguish a
condor row from a real directional row (the ecosystem query never selected `play_type` /
`entry_context`), so it would read that nominal field as if it were a genuine directional call and
print a fabricated "aligned" or "conflict" verdict against the swing thesis — exactly backwards
from what the 0DTE desk actually did.

### Why this wasn't already handled
`condor-record.ts` (2026-08-21) already solved the IDENTICAL contamination problem one layer over
— it added `isCondorRow()` specifically because `buildZeroDteRecord` never filtered condor rows
out of the directional win-rate, and separated the two lanes before the (then-latent) contamination
became visible. `flowIntelSection`'s cross-desk-alignment consumer reads the same underlying table
and has the exact same latent defect, but nobody had applied the same filter to this consumer —
each new reader of `zerodte_setup_log` has to independently know to exclude condor rows from
directional comparisons, and this one didn't.

### Fix
- `EcosystemZeroDteTake` (`ecosystem-context.ts`) gains an optional `is_condor` field, derived via
  the same `isCondorRow()` helper `condor-record.ts` already exports, off `entry_context` (now also
  selected by the query — it wasn't before).
- `flowIntelSection` gates on `z.is_condor === true`: a condor row now prints
  `"0DTE desk: **sold iron condor** (structure-neutral, not a directional call) · <conviction>
  conviction"` instead of the aligned/conflict framing.
- `is_condor` is optional (not `is_condor: false`) so the many existing test fixtures/consumers of
  `EcosystemZeroDteTake` across `spx-signals-shadow-ecosystem.ts`, `ticker-verdict.ts`,
  `ticker-compare.ts`, `ecosystem-narrative.ts` etc. needed no changes — an absent field reads as
  "unknown/non-condor", the same safe default those call sites already implicitly assumed.

### Blast radius
Checked every other reader of `EcosystemZeroDteTake.direction` for the same class of mislabeling —
`nighthawkLiveForSession`/`zerodteLiveForSession` and the other consumers in `play-brief-absence.ts`,
`ticker-verdict.ts`, `ticker-compare.ts`, `ecosystem-narrative.ts` — none of them compare the field
against another desk's direction to render an "aligned/conflict" verdict; `flowIntelSection` was the
only affected call site.

### Evidence (RED before / GREEN after)
Two new tests in `play-brief-intel.test.ts`:
- `flowIntelSection: a committed CONDOR's nominal direction must not read as a directional
  alignment/conflict claim` — FAILED before the fix (`git stash` on the two source files), PASSED
  after.
- `flowIntelSection: a non-condor directional 0DTE row still renders the aligned/conflict claim` —
  regression guard that the fix didn't just delete the feature for real directional rows.

`npx tsc --noEmit` clean. Full `play-brief-intel.test.ts` (86 tests), `ecosystem-context.test.ts`,
`condor-record.test.ts`, `play-brief-absence.test.ts`, `play-brief-narrative.test.ts` all green.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
