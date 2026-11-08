# HELIX score-calibration `minSamples` override silently ignored below the module default — FIXED

> **kind:** FINDING

| | |
|---|---|
| **Status** | FIXED |
| **Area** | HELIX — `helix-score-context.ts` (session score-calibration tier/percentile, UI display-only) |
| **Severity** | P3 — latent, no production call site currently exercises the broken path |
| **Round** | 408 (discovery lane) |

## Root cause

`helixScoreContextForPrint(score, distribution, minSamples?)` is documented and typed to let a
caller choose its own sample-size floor before trusting a session percentile — the parameter
exists specifically so a caller other than the shipped UI badges (today all of which use the
default) can ask for a stricter or looser bar. The outer gate in that function,

```ts
const percentile = helixScorePercentile(score, sample);
if (percentile == null || sample.length < minSamples) { ...uncalibrated... }
```

correctly compares `sample.length` against the CALLER's `minSamples`. But the inner helper it
calls, `helixScorePercentile`, had its OWN floor hard-coded to the module constant
`HELIX_SCORE_CALIBRATION_MIN_SAMPLES` (8) rather than accepting `minSamples` as a parameter:

```ts
export function helixScorePercentile(score: number, distribution: readonly number[]): number | null {
  if (!(score > 0) || distribution.length < HELIX_SCORE_CALIBRATION_MIN_SAMPLES) return null;
  ...
}
```

So a caller passing a `minSamples` LOWER than 8 (e.g. 5, with a real 7-sample distribution — above
its own stated floor, below the hard-coded one) got `null` back from `helixScorePercentile`
regardless, which then tripped the OUTER function's `percentile == null` branch before the outer
`sample.length < minSamples` comparison (which WOULD have passed, 7 >= 5) ever got a chance to
matter. The caller's own, explicitly lower, floor was silently clamped up to 8 and could never
produce a calibrated verdict below that count — the parameter existed, was documented, was typed,
and was dead for exactly the one direction (asking for a LOWER bar) it would ever change behavior.

The opposite direction — a caller passing `minSamples` HIGHER than 8 — worked by accident: the
outer `sample.length < minSamples` check in `helixScoreContextForPrint` catches that case on its
own, independent of what the inner helper does, which is exactly why this asymmetry was never
noticed from either the test file or a production call site: every live caller
(`ContractDrilldownDrawer.tsx`, `HelixContextHeader.tsx`, `HelixFlowTable.tsx`,
`HighScorePrints.tsx`, `helix-csv-export.ts`) uses the default and never exercises the parameter at
all, and the one existing test of `minSamples` behavior (`helixScoreContextForPrint uncalibrated
when sample thin`) uses a sample smaller than even the 8-floor, so it can't distinguish "my custom
floor was honored" from "the hard-coded 8-floor fired first."

## Evidence (RED → GREEN)

Added three regression tests to `src/features/helix/lib/helix-score-context.test.ts`:
1. `helixScoreContextForPrint honors a minSamples LOWER than the module default` — a 7-sample
   distribution with `minSamples=5` must calibrate (`session`, real percentile). **Failed against
   the unmodified source** (`calibrationStatus: "uncalibrated"`, `percentile: null` — the exact
   wrong values the bug produces).
2. `helixScorePercentile honors an explicit minSamples below its own default` — isolates the same
   defect at the lower-level helper directly (no intermediate caller logic to obscure it). **Failed
   against the unmodified source** (`withOverride` was `null`, expected non-null).
3. `helixScoreContextForPrint still respects a minSamples HIGHER than the module default` — a
   control proving the already-working direction stays working post-fix (this one already passed
   pre-fix, by the accident described above; kept so the fix can't regress it).

Both RED failures were confirmed directly: checked out the unmodified
`src/features/helix/lib/helix-score-context.ts` from `origin/main` against the new test file
(`npx tsx --experimental-test-module-mocks --test ...`) — 2 of 8 subtests failed with exactly the
wrong values described above. Restoring the fixed source turns all 8 green. `npx tsc --noEmit`
clean. Full `src/features/helix/**/*.test.ts` run: 377/377 pass post-fix.

## Blast radius

`helixScorePercentile` has exactly two call sites in the repo: this test file (uses the default,
unaffected) and `helixScoreContextForPrint` itself (now threads its own `minSamples` through
instead of relying on the hard-coded constant). No other reader of `helix-score-context.ts` passes
a non-default `minSamples` today, so this fix changes NOTHING about current production behavior
(every shipped HELIX score badge — the contract drilldown, the context header's top-score chip,
the flow table, High Score Prints, the CSV export — keeps calibrating at exactly 8 samples as
before). The fix only unblocks the parameter for the next caller that actually wants a different
floor, which is the entire reason the parameter was added in the first place.

## Fix rationale

Pass `minSamples` through to `helixScorePercentile` as an optional third parameter, defaulting to
the same module constant so every existing call site (including the two in the test file that call
it with the 2-argument form) is byte-identical. This is the minimal fix: it makes the inner helper
agree with the outer caller about which floor is in effect, rather than inventing a second,
independent floor inside the helper that the caller's own parameter can never lower. Left
`HELIX_SCORE_CALIBRATION_MIN_SAMPLES` itself untouched — it is still the correct default for every
real caller today; this fix is about honoring an override, not about changing the default.
