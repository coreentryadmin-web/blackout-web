# 2026-11-09: `src/lib/correctness/data-integrity-verifier.ts` — every "pass"-outcome check was silently demoted to "consistency-only" at the metric level

> **kind:** `FINDING`

**Status.** FIXED — this PR.

## Summary

`src/lib/correctness/data-integrity-verifier.ts` is the DATALAYER surface of the platform's own
meta-level correctness auditor (`run-correctness.ts`'s `runFullCorrectness`) — it checks whether
the data layer itself (Postgres tables, Redis caches, pipeline hops, writer crons) is actually
present/fresh/sane, as distinct from every sibling verifier's "is the served NUMBER correct"
question. Its own module-doc HONESTY note states the design intent explicitly: *"a PASS here means
'the layer is present + fresh + sane', which is a STRONGER, independent claim than the per-surface
consistency checks ... so freshness/presence/writer checks that hold are reported PASS."*

That intent never reached the shared rollup. Every `CheckResult` this file emits with
`outcome: "pass"` (Postgres flow-alerts freshness/row-count/garbage-rate, the editions/outcomes
sanity checks, Redis cache sanity/freshness, the raw Redis TTL probe, and the writer-cron
healthy branch — nine call sites across the file) set `outcome: "pass"` but never set the
`independentlyConfirmed` field. `types.ts`'s `rollUpMetricStatus` — the SAME shared rollup every
verifier in `src/lib/correctness/**` funnels its checks through — only promotes a *metric* to
`"pass"` when at least one of its checks carries `independentlyConfirmed: true`; a metric whose
only checks are `outcome: "pass"` with no `independentlyConfirmed` instead demotes to
`"consistency-only"`.

## Blast radius

This is not cosmetic. `run-correctness.ts`'s `collectCoverageGaps()` lists every metric whose
rolled-up status is `"consistency-only"` as a reported DATALAYER "coverage gap" — with the generic
reason text "No independent second source confirmed this metric." — and `flattenTotals()` counts
it toward `totals.consistencyOnly` rather than `totals.pass` / `totals.independentlyConfirmed`. So
on a perfectly healthy run, nearly every DATALAYER metric (a fresh `flow_alerts` write, a non-empty
row count, a clean outcome vocabulary, a sane/fresh Redis cache, a bounded TTL, a live writer cron)
was BOTH rendered `[pass]` in its own per-check detail line in `renderScorecardMarkdown` AND listed
as an unconfirmed coverage gap in the same scorecard — a direct contradiction a reader of the
markdown report would see side by side.

This is the identical mislabeled-outcome class already fixed twice elsewhere in this same
directory (documented in this file's own test suite): `largo-verifier.ts`'s
self-consistency-miscounted-as-independent fix, and `nighthawk-verifier.ts`'s L4 premium check
that used to emit `"pass"` when the chain comparison never actually ran. Here the direction is the
opposite of those two (a real pass being falsely DEMOTED rather than a non-confirmation being
falsely PROMOTED), but the root cause is the same: a `CheckResult`'s raw `outcome` string and its
`independentlyConfirmed` field drifting out of sync with each other.

## Fix

Set `independentlyConfirmed` to match each check's own pass/fail verdict at every `"pass"`-outcome
call site in `data-integrity-verifier.ts` (`checkPostgres`, `checkRedis`, `classifyRedisTtlProbe`,
`checkWriters`'s healthy branch). The genuinely single-underlying `checkPipelineHops` cross-tool
checks are deliberately left untouched — those stay `"consistency-only"` by design (no independent
oracle), which the module doc also states explicitly. `classifyRedisTtlProbe`'s return type gained
an optional `independentlyConfirmed` field, consumed at its one call site.

## Evidence (RED → GREEN)

Added two tests to `data-integrity-verifier.test.ts`:
- a direct test on `classifyRedisTtlProbe`'s pass branch asserting `independentlyConfirmed === true`;
- an end-to-end test exercising `verifyDataIntegrity` with a mocked clean `nighthawk_play_outcomes`
  vocabulary check, asserting the metric rolls up to status `"pass"` with
  `independentlyConfirmed === true`, not `"consistency-only"`.

Both failed before the fix (`git stash` on the source file alone, keeping the tests):
```
a pass-outcome check must set independentlyConfirmed or rollUpMetricStatus demotes it to consistency-only
+ actual - expected
+ undefined
- true

a clean (bad=0) outcome-vocabulary check must roll up to metric status "pass", got "consistency-only" ...
+ actual - expected
+ 'consistency-only'
- 'pass'
```
Both pass after the fix; the full `src/lib/correctness/*.test.ts` suite (107 tests) passes clean,
and `npx tsc --noEmit` is clean.

## Files

- `src/lib/correctness/data-integrity-verifier.ts`
- `src/lib/correctness/data-integrity-verifier.test.ts`
