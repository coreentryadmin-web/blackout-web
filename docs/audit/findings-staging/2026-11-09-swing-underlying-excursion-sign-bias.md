# `signedExcursionPct`'s sign-bias rounding tie — swing's own instance of the codebase-wide `Math.round` tie-toward-+Infinity bug

> **kind:** `FINDING`

### Summary
`src/lib/swing/underlying-excursion.ts`'s `signedExcursionPct` — the shared, direction-aware
favorable/adverse underlying-excursion calculator used by both the active-refresh cron's persisted
`running_mfe`/`running_mae` write (`manage-sync.ts`) and the member/Largo-facing live serve path
(`live-plays.ts`, which feeds every play-brief's "Underlying excursion since entry: ... favorable /
... adverse." narrative line) — had its own internal `pct()` helper round with plain
`Math.round(n * 1e4) / 1e4`.

`Math.round` ties toward `+Infinity` (`Math.round(-7812.5) === -7812` but `Math.round(7812.5) ===
7813`). Since MFE is seeded `>= 0` and MAE `<= 0` by this module's own documented convention, a
mirror-image favorable/adverse move from the same entry price should always report EQUAL
magnitudes — but a move sitting exactly on a tie at the 4th-decimal rounding boundary instead
rounded asymmetrically, the adverse side reading a smaller magnitude than the identical-distance
favorable side.

### Root cause
Exactly the same shape as 14 other confirmed instances across this codebase this session
(`fmt-money.ts`'s `fmtPct`, `round-floats.ts`, `thermal/lib/gex-heatmap/shift-math.ts`,
`debrief.ts`'s `round2`, `gamma-desk.ts`'s `distance_pts`, and others) — a plain
`Math.round(signedValue)` with no magnitude/sign separation. This was the one instance of the
pattern living in the Swing engine's own code; `grep -rn "Math.round([^)]*\* *100[^)]*) */ *100"
src/lib/swing/*.ts` surfaced several other local `round2` helpers in this directory
(`archetype.ts`, `closed-plays.ts`, `grade.ts`, `record.ts`, `swing-allocation.ts`), but those all
round values that are either always non-negative by construction (allocation percentages,
classification-fit scores) or — for `grade.ts`'s `mfePct`/`maePct` specifically — belong to the
5-truth grader's own admin-diagnostic-only output (zero production narrative call sites, per
`grade-retrace.ts`'s own header), so they were checked and correctly left untouched rather than
"fixed" speculatively.

### Evidence (RED → GREEN)
New test file `src/lib/swing/underlying-excursion.test.ts` (none existed before — the function had
only ever been exercised indirectly via `play-brief.test.ts`/`live-plays.test.ts`). A constructed
dyadic fixture (`entry=2`, `lo=1.984375`, `hi=2.015625` — both exact binary fractions of a
power-of-two entry, landing the raw `percent*1e4` value EXACTLY on a `±7812.5` tie, not merely
close to one, since ordinary floating-point division noise would otherwise mask the bug on an
inexact near-tie) reproduces it directly:

```
RED (pre-fix, git-stash of just underlying-excursion.ts): 3/5 pass, 2 fail
  mfePct: 0.7813, maePct: -0.7812  (asymmetric — maePct should also be 0.7813 in magnitude)
GREEN (post-fix): 5/5 pass
  mfePct: 0.7813, maePct: -0.7813  (symmetric)
```

Also confirmed the SHORT-direction path (which negates `pct(lo)`/`pct(hi)` relative to LONG)
inherits the fix correctly, that a non-tie move rounds unaffected, and that honest-null/fresh-seed
behavior is unchanged.

Full regression: `src/lib/swing/*.test.ts` — 2303/2303 pass. `npx tsc --noEmit` clean.

### Blast radius
Single function, `signedExcursionPct`'s internal `pct()` helper — its only two callers
(`manage-sync.ts`'s persisted snapshot write, `live-plays.ts`'s live serve path) both inherit the
fix automatically with no call-site changes needed. User-visible narrative impact is real but
narrow: the bias is introduced at 4-decimal-place (0.0001 percentage-point) precision, while the
narrative's own `fmtPct()` display round is 1dp — so in the vast majority of cases the bias is
invisible after the coarser display round. The genuinely consequential consumer is the PERSISTED
`running_mfe`/`running_mae` values, which `feature-store.ts`'s trajectory studies compare against
named thresholds at full precision (`studyIvKillsGoodSetups`: `running_mae` vs a `-3%` threshold)
— a borderline position sitting exactly on a tie at that boundary could have been classified on
the wrong side of the threshold purely from this rounding bias, not from a real difference in the
underlying's own move.

### Fix rationale
Round by magnitude, then reapply sign (`Math.sign(raw) * Math.round(Math.abs(raw))`) — the
identical, already-reviewed fix shape every prior sibling instance of this bug class in this
codebase used, rather than inventing a new one. Kept local to `signedExcursionPct`'s own `pct()`
closure (not refactored into a shared import) since the module is explicitly documented as having
exactly one job (this one calculation, shared by its two callers) and already defines its own
small helper rather than depending on another feature's formatter. Output precision (4dp) and
every other behavior (null-honesty, MFE/MAE seeding, the SHORT-direction mirror) are unchanged.

| **Status** | FIXED — this PR. |
