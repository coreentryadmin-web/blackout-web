# 2026-11-09 — [FINDING, P2 0DTE / Night Hawk] WS-11 `tranches[]` still didn't let a member recompute the served headline, even AFTER #6744's fraction-rounding fix — FIXED

> **kind:** `FINDING`

| | |
|---|---|
| **Status** | FIXED — this PR |
| **Found by** | Adversarially-verified live 5-engine audit of production, `GET /api/market/zerodte/record?days=14` |
| **Scope** | `src/lib/round-floats.ts`, `src/app/api/market/zerodte/record/route.ts` |

## Summary

On `GET /api/market/zerodte/record`, a committed 0DTE play's
`entry_context.executable.tranches[]` array (the WS-11 trim-scale reconstruction's per-leg audit
trail) does not let a member or API consumer recompute the served headline
`entry_context.executable.plan_pnl_pct` from the exact tranche values served right beside it.
Recomputing `Σ fraction_i × exit_pnl_pct_i` from the served array disagrees with the served
headline by up to 0.56 percentage points, reproducing live on rows committed 2026-11-02…11-05 —
i.e. **after** `#6744` (2026-10-25, "the WS-11 `tranches[].fraction` audit trail rounds
independently and sums to 0.99 instead of 1.00") already shipped and fixed the narrower
fraction-sum problem it targeted.

Confirmed live examples:

- META 2026-11-05: `tranches=[{fraction:0.33,exit_pnl_pct:16.8},{0.33,46},{0.34,94.67}]` →
  recomputed `52.9118` (→ 52.91) vs served `plan_pnl_pct=52.49` (+0.42pp).
- QQQ 2026-10-28: `tranches=[{0.33,19.65},{0.33,49.56},{0.34,-50.15}]` → recomputed `5.7883`
  (→ 5.79) vs served `6.35` (−0.56pp).
- 8 more examples across NVDA/SPY/AMZN/SPXW in the 0.10–0.43pp range.

10 of 22 multi-tranche rows in the sampled window exceeded a 0.05pp tolerance. Every served
`fraction` array itself DOES sum to exactly 1.0000 — `#6744`'s own narrower goal is correctly
fixed and remains fixed (regression-tested below) — but the broader claim that fix's own doc
comment made ("a member who recomputes the blend from these DISPLAYED fractions gets a result
~0.5pp below the real one" — implying recompute-from-served would then agree with the served
headline) was never actually delivered; the drift just changed shape and sign.

## Root cause

1. `reconstructTrimScaleExecutableFromBars` (`src/lib/zerodte/plan.ts` ~line 1009) computes the
   headline `blended = round2(tranches.reduce((acc,t) => acc + t.fraction*t.exit_pnl_pct, 0))`
   from FULL-PRECISION, unrounded `fraction` (exact fractions like 1/3) and `exit_pnl_pct`. This
   is persisted as `execGrade.pnl_pct` → `entry_context.executable.plan_pnl_pct`
   (`src/lib/zerodte/scan.ts` ~line 2557) — mathematically correct against its true, full-precision
   inputs.
2. The SAME `execGrade.tranches` array (still unrounded) is persisted verbatim as
   `entry_context.executable.tranches` (`scan.ts` ~line 2564).
3. At serve time, `src/app/api/market/zerodte/record/route.ts` calls
   `roundFloats(record, 2, CORTEX_WIRE_KEY_DP)`, which rounds every tranche leaf (`fraction` AND
   `exit_pnl_pct`) INDEPENDENTLY to 2dp — and rounds `plan_pnl_pct` independently too, but
   `plan_pnl_pct` was already 2dp-ish from step 1's `round2`, so it does not visibly move.
4. `#6744`'s `reconcileTrancheFractions` then runs, but it ONLY touches `fraction`: when the
   rounded fractions don't sum to exactly 1.00, it dumps the ENTIRE residual onto the LAST
   (runner) leg's `fraction` alone. It never touches `exit_pnl_pct`, and never recomputes
   `plan_pnl_pct` to match the now-reconciled array.

So the served array is now internally self-consistent in the one dimension `#6744` checked
(`fraction` sums to 1.00) but the served HEADLINE is still the UNROUNDED, pre-reconciliation
blend — not a function of the served array at all. Dumping the entire fraction-rounding residual
onto the runner leg's DISPLAYED weight (structurally the leg most likely to carry an outlier
`exit_pnl_pct` — it rode furthest to target/stop) multiplies that distortion by the outlier P&L,
which is why the drift runs 0.1–0.6pp rather than the sub-0.01pp a flat 2dp rounding alone would
cause. This is a serve-layer (JSON-response) issue, not a persistence bug — the underlying DB
`entry_context.executable.plan_pnl_pct`/`.tranches` are correct and untouched; only what
`roundFloats()` + `reconcileTrancheFractions()` produce for the HTTP response disagreed with
itself.

## Fix

Added `blendTrancheHeadlinePnlPct<T extends {fraction:number; exit_pnl_pct:number}>(tranches, dp=2)`
to `round-floats.ts`: sums `fraction_i × exit_pnl_pct_i` over the array and rounds the result with
`roundFloats()` itself (reusing the same magnitude-then-sign tie-break the rest of the wire layer
already uses, rather than reimplementing it). Returns `null` on an empty/missing array or any
non-finite leaf, mirroring `reconcileTrancheFractions`'s own "leave it alone rather than fabricate"
posture.

Wired into `record/route.ts`, called AFTER `reconcileTrancheFractions` has produced the FINAL
served tranches array, writing the recomputed value back over
`entry_context.executable.plan_pnl_pct` on that one response only:

```ts
const reconciled = reconcileTrancheFractions(ex.tranches);
ex.tranches = reconciled;
const recomputed = blendTrancheHeadlinePnlPct(reconciled);
if (recomputed != null) ex.plan_pnl_pct = recomputed;
```

## Fix rationale — alternatives considered and rejected

The task identified three candidate shapes; all three were traced against the real code and
real numbers before picking one:

**(a) Chosen — recompute the served headline from the served (reconciled) tranches, at the serve
layer only.** Guarantees, BY CONSTRUCTION, that `entry_context.executable.plan_pnl_pct` always
agrees with `Σ fraction_i × exit_pnl_pct_i` computed from the EXACT `entry_context.executable.
tranches[]` array in the SAME response — closing exactly the invariant the finding tested for. It
does **not** guarantee the served headline is the mathematically truest full-precision number;
that number is sacrificed by up to the same ≤0.6pp this fix is closing, in exchange for
self-consistency. Given the field is explicitly documented (plan.ts) as "the ONE blended official
number" with `tranches` as "the audit trail BEHIND" it, self-consistency with the audit trail a
reader can see is the more defensible property for THIS specific nested pairing to guarantee — a
number nobody can independently verify from what they were just shown is not very useful as an
"official" figure, even if it is one decimal step truer. This is also the narrowest possible
blast radius: it rewrites nothing on the persisted DB row, and nothing any other in-process
reader (`officialPlanPnlPct`/`asManagedPnlPct` in `record.ts`, `feature-store.ts`,
`calibration.ts`, the WS-11 `grade_vs_asmanaged_delta` reconciliation guard in `scan.ts`) reads —
all of those read the raw, full-precision DB value directly, never this one HTTP response's
rounded copy.

**(b) Rejected — improve `reconcileTrancheFractions`'s apportionment (e.g. largest-remainder
instead of dump-all-on-last-leg).** Traced against the real numbers first, per the task's own
instruction to verify rather than assume: for an EXACT 3-way 1/3 split (the shape of every live
repro above), all three remainders are byte-identical ties (`0.3333... * 100 = 33.333...` for
each leg) — there is no "largest" remainder to prefer, so any tie-breaking rule among three equal
remainders still has to dump the leftover unit onto exactly one leg, and that leg still then
carries a `fraction` that diverges from its true 1/3 weight by the same one-cent amount. A
smarter apportionment method does not reduce the maximum single-leg distortion in the cases that
actually matter here — it is a dead end for this specific bug, confirmed by calculation rather
than assumed. It would also do nothing for the SEPARATE problem that `exit_pnl_pct` itself is
independently rounded; `reconcileTrancheFractions` only ever touched `fraction`.

**(c) Not pursued as a distinct option** — no third approach surfaced during investigation that
improved on (a) without its disclosed tradeoff.

### Deliberately left unchanged (and why)

- **The persisted DB row** (`zerodte_setup_log.entry_context.executable.plan_pnl_pct`/`.tranches`)
  — full-precision, correct, untouched. Every non-HTTP reader of it is unaffected.
- **`reconcileTrancheFractions` itself** — still correctly closes the `fraction`-sums-to-1.00
  invariant; left as-is and re-verified (see Evidence) rather than folded into the new function,
  since it is still independently useful (a tranche array can be served without a headline to
  recompute, e.g. if a future consumer only reads `tranches`).
- **The TOP-LEVEL `plays[].plan_pnl_pct` (`officialPlanPnlPct`) and `plays[].managed_pnl_pct`
  (`asManagedPnlPct`/`managedGradeView`) fields on this SAME response.** These are computed by
  `record.ts`'s `toPlay()` from the identical raw DB value, independently round2'd, BEFORE this
  route's `roundFloats()` call ever runs — so, in the common case (no real-exit override blocking
  the WS-11 reconstruction — see `officialOverridingRealExit`), they are numerically IDENTICAL to
  the pre-fix nested `entry_context.executable.plan_pnl_pct` on the wire today. **After this fix,
  in that same common case, these two top-level fields will diverge from the now-self-consistent
  nested field by the same bounded ≤0.6pp this fix closes locally** — a new, smaller version of a
  divergence that already exists today in the override case (where those two fields are, by
  design, sourced from the real exit instead of the raw reconstruction). This is a disclosed,
  genuinely out-of-scope consequence of picking fix (a): closing it would mean either re-deriving
  `officialOverridingRealExit`'s precedence logic at the route layer (duplicating record.ts's
  internals, a much larger and riskier change) or recomputing those fields unconditionally
  (which would be WRONG on override rows). Flagging for a follow-up finding rather than
  expanding this PR's scope — it needs its own judgment call, not a serve-layer patch.
  **Largo is unaffected either way**: `zerodteRecordForLargo`
  (`src/lib/largo/product-reads.ts`) strips `entry_context` entirely via
  `leanZeroDtePlayForModel` before the tool response is built, so Largo's `get_zerodte_record`
  tool never receives `tranches[]` or the nested field at all — confirmed by reading the source.
- **`GET /api/market/zerodte/board`'s `ledger[].timeline_tranches`** — the sibling WS-11 array
  `#6744` also fixed on that route. Traced and confirmed this is NOT the same bug shape: the
  board's adjacent headline (`exit_pnl_pct`) is sourced from `entry_context.exit` (the REAL,
  live-engine exit stamp), not from a blend of `timeline_tranches` — by design, a non-terminal or
  terminal tranche leg can be "fictitious" bar-walk replay once a real live-only exit (thesis-
  break/ratchet-floor/flat-timeout) has already closed the position (`play-timeline.ts`'s own
  `trancheIsAfterRealExit`/`isTerminalTrancheReason` doc comments). There is no claim anywhere
  that `timeline_tranches` sums to `exit_pnl_pct`, so there is no analogous self-consistency
  invariant to fix on that route.

## Evidence (RED → GREEN)

RED (pre-fix, via a plain file-copy backup/restore of `round-floats.ts` and `record/route.ts` to
their pre-fix `git show HEAD:...` content — not `git stash`, per this repo's shared-stash-risk
note):
- `round-floats.test.ts`: 7/51 new `blendTrancheHeadlinePnlPct` tests fail (function doesn't
  exist pre-fix) — 44/51 pass (everything else, including all `reconcileTrancheFractions` tests,
  unaffected).
- `route.tranche-headline-consistency.test.ts` (new): 2/4 fail — the META and QQQ multi-leg
  reproduction tests fail exactly on the live numbers (`52.49 !== 52.91`, `6.35 !== 5.79`); the
  single-tranche and no-tranches-array tests correctly stay GREEN even pre-fix, proving those
  cases were already provable no-ops.

GREEN (post-fix, fix restored): `round-floats.test.ts` 51/51;
`route.tranche-headline-consistency.test.ts` 4/4;
`route.weight-precision.test.ts` 1/1 (unrelated sibling fix, confirmed un-regressed).

Broader regression sweep, all green: `src/lib/zerodte/record.test.ts` (57), `plan.test.ts` (49),
`exit-engine.test.ts` (114), `play-timeline.test.ts` (12), `board/route.test.ts` (1),
`board/route.sim-precision.test.ts` (1) — 234/234 total, confirming no regression in the
grading/reconstruction/timeline logic or the sibling board route this fix sits beside.

`npx tsc --noEmit` clean. Full `npm test` run on Node 20 — see PR for the final tally.

Tests run on Node 20 (`/opt/nvm/versions/node/v20.20.2/bin`) via
`npx tsx --experimental-test-module-mocks --test <file>`.
