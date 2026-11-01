> **kind:** FINDING

## Meridian Summary panel's evidence tally silently un-zeroes an explicitly zero-weighted signal — FIXED

**Status:** FIXED (PR opens with this finding)

### Root cause

`evidenceLean()` (`src/lib/meridian/meridian-summary-core.ts`), the function that tallies the
Meridian Summary panel's bull/bear evidence weight (feeding `evidence.net`, `evidence.contested`,
`MeridianSummary.lean`, the panel headline, and each `PlayIdea.evidenceNet`/`confidence`/`why`
bullets), resolved a signal's weight with:

```ts
const w = Math.abs(num(s?.weight) ?? 1) || 1;
```

This cannot distinguish "no weight field was given" (should default to 1, so an unweighted
signal still occupies the tally) from "the weight is deliberately, exactly 0" (should stay 0, so
an informational-only pillar can carry a `lean` without swaying the verdict). `num(0)` is `0`, and
`0 ?? 1` short-circuits to `0` (not `1`, since `??` only triggers on `null`/`undefined`) — but the
trailing `Math.abs(0) || 1` then collapses that genuine zero back up to `1`, because `0` is falsy
in JS. The exact same bug shape was already found and fixed once in this file family:
`resolveSignalWeight()` (`src/lib/meridian/meridian-viz-core.ts`) exists specifically to make this
distinction, with its own comment documenting a measured live regression — the identical
collapse-to-1 pattern understated the STRUCTURE halo dimension's weight by a third in production
(its only two pillars are `thermal` weight 2 and `vector` weight 0, and the bug read their combined
weight as 3 instead of 2) before `resolveSignalWeight` was introduced. `evidenceLean` independently
reimplemented the same weight-resolution fallback inline and never inherited that fix.

### Evidence

Added `evidenceLean: an EXPLICIT weight of 0 stays inert — it must not collapse to the 'no weight
given' default of 1` to `meridian-summary-core.test.ts`. RED before the fix (verified by stashing
only the source change and re-running):

```
not ok - evidenceLean: an EXPLICIT weight of 0 stays inert …
  error: an explicitly zero-weighted signal must not sway the tally
  expected: 0
  actual: 1
```

GREEN after switching `evidenceLean` to call the already-exported `resolveSignalWeight` instead of
reimplementing the fallback — 37/37 in `meridian-summary-core.test.ts`, 155/155 across that file
plus `meridian-viz-core.test.ts` and `meridian-drift-core.test.ts`, `tsc --noEmit` clean.

### Blast radius

Only one call site passes real data into `evidenceLean`: `buildMeridianSummary(input.signals)`,
fed by `MeridianEarningsSummaryPanel.tsx` from `intel?.report?.signals` — the array
`buildMeridianEarningsReport()` (`meridian-earnings-report-core.ts`) builds. **Today this bug is
dormant in production**: every signal that function pushes with `weight: 0` (`news`, `vector`,
`insider` — explicitly informational-only) is also pushed with `lean: "neutral"`, and
`evidenceLean` only adds a signal's weight to `bull`/`bear` when its lean is `"bullish"`/
`"bearish"`, so a weight-0 neutral signal never reaches the buggy line's consequence regardless of
which formula resolves its weight. Confirmed by reading every `pushSignal()` call in that file
(11 total) — the three `weight: 0` calls are the only ones, and all three are unconditionally
`lean: "neutral"`.

The bug is real and live-reachable the moment that invariant changes, not hypothetical in the
abstract: the architecture explicitly anticipates a weight-0 *directional* signal (that is the
whole reason `resolveSignalWeight`'s "present but inert" case exists and is documented at length),
the `EvidenceLean`/`SummaryInput` types place no restriction tying `weight: 0` to `lean: "neutral"`,
and this exact failure mode already shipped once elsewhere in this same subsystem
(`haloFromSignals`/`dimensionRollup`/`orbitalLayout`, fixed via `resolveSignalWeight`). The next
pillar added to the earnings report with `weight: 0` and a real bullish/bearish lean — e.g. a
future "sentiment-only" or "unconfirmed-rumor" signal meant to display without swaying the
verdict — would silently inflate `evidence.net`/`contested`/`lean`/the panel headline and each
idea's `confidence`, with no existing test catching it, exactly as the STRUCTURE halo regression
went unnoticed until measured live.

### Fix rationale

Replace the inline reimplementation with a call to `resolveSignalWeight` (already exported from
`meridian-viz-core.ts`, which this file already imports `clamp`/`num`/`round` from) rather than
writing a second, independently-maintainable fix to the same fallback. This keeps exactly one
definition of "how to resolve a signal's weight" across the Meridian analytics layer, so a future
fix to that semantics (if any) cannot drift between the two call sites again. Nothing else in
`evidenceLean`'s behavior changes: a signal with no `weight` field at all still defaults to 1
(covered by a new assertion in the same test), and every existing test (weights 1/2/3/4/9/10/99)
is unaffected since none of them used an explicit `0`.
