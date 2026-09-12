> **kind:** FINDING

## PR #4822's GEX-heatmap event-loop yield left 3 sibling `buildDepthBlockForExpiries` calls un-yielded — FIXED

| | |
|---|---|
| **Lane** | Standing performance/latency audit mandate — `src/lib/providers/polygon-options-gex.ts` (`buildGexHeatmapUncached`) |
| **File** | `src/lib/providers/polygon-options-gex.ts` |
| **Status** | FIXED (this PR) |

### Root cause

PR #4822 (merged 2026-09-12 03:13:57 UTC, task def rollout complete 04:25:19 UTC) added a
macrotask-level `setImmediate` yield to two hot loops inside `buildGexHeatmapUncached`: the
`maxPainByExpiry` per-expiry loop, and the depth-block loop over `nearKeep`. Both are correctly
yielded.

A live CloudWatch investigation (2026-09-12, after the #4822 deploy had fully rolled out) found the
ALB's `TargetResponseTime` still spiking to 41-42s p99/max in short, ~1-minute windows. Tracing the
code directly (not re-guessing) found #4822's fix was real but incomplete: the SAME expensive
`buildDepthBlockForExpiries` helper (an O(depthContracts) pass over the full ~11K-contract array for
SPX) is called from **3 additional call sites in the same function that #4822 never touched**:

1. The initial `depth = buildDepthBlockForExpiries(...)` build (the whole `nearTermKeep` scope),
   immediately before the (correctly yielded) per-expiry loop.
2. `nearPresetBlock = buildDepthBlockForExpiries(...)`, immediately after that loop — the SAME
   `nearTermKeep`/total-gamma arguments as call #1 (a pre-existing, out-of-scope duplication of work,
   not something this fix changes).
3. `farBlock = buildDepthBlockForExpiries(...)`, inside the `if (farOnly.length > 0)` branch for
   far-dated expiries.

None of these 3 had a yield after them, so on a large chain (SPX, 11K+ contracts) each one could still
run as one uninterrupted synchronous block on the shared web ECS event loop, stalling concurrent
member requests exactly like the two loops #4822 already fixed.

### Evidence

- Live `AWS/ApplicationELB` `TargetResponseTime` at 60s granularity, 2026-09-12 ~04:00-04:40 UTC (well
  after #4822's rollout completed at 04:25:19 UTC): baseline p50/avg healthy (~0.05-0.15s), but
  04:11/04:21/04:25/04:27 UTC show low p50 with p99/max spiking to 5-42s — the single-blocked-task
  signature consistent with an unyielded synchronous computation on one ECS task.
- Confirmed via ECS task-definition → image-tag → git-commit ancestry that the spikes occurred on task
  def `:1472` (image `d4cc4562b`), which DOES contain #4822's fix — ruling out "the deploy hadn't
  landed yet" as the explanation.
- Read `buildGexHeatmapUncached` directly: confirmed exactly 2 yielded loops (per #4822) and exactly 3
  additional un-yielded `buildDepthBlockForExpiries` call sites, all sharing the identical
  O(depthContracts) cost profile as the already-yielded ones.

### Fix

Added the identical `await new Promise((resolve) => setImmediate(resolve))` yield already
established in this same function (per #4822's own technique, itself borrowed from #4807's earlier
Vector-cron fix) immediately after each of the 3 previously-un-yielded calls. No computation logic
touched — same inputs, same outputs, only interleaved with real macrotask yields.

### Blast radius

- Scoped entirely to the `try` block inside `buildGexHeatmapUncached` that builds `depth` and
  `depth_by_scope` — the two already-yielded loops (`maxPainByExpiry`, the `nearKeep` depth loop) are
  untouched.
- No other caller of `buildDepthBlockForExpiries` exists outside this function (it is a
  module-private, unexported helper) — confirmed by grep.
- The pre-existing duplication between the initial `depth` build and `nearPresetBlock` (same args,
  computed twice) is a separate, independent inefficiency — left alone as out of scope for this
  single-issue PR (fixing it would mean threading `depth` through as `scopeBlocks[nearKey]` directly,
  a small refactor with its own blast radius, not a yield).

### Fix rationale

Matches #4822's own established pattern exactly rather than inventing a different technique —
`setImmediate` yields between every expensive synchronous pass over the same large array, which
already-yielded call sites in this same function demonstrate is correct and low-risk. This is
strictly additive: it cannot change what any of the 3 calls compute, only when the event loop gets a
chance to run in between.

### What was deliberately left unchanged

- `TRIM_SCALE_RULES`/gate/scoring logic: n/a, this file has none.
- The pre-existing `depth`/`nearPresetBlock` duplicate-computation inefficiency (see Blast radius) —
  a separate, real but independent finding, not fixed here.
- A second, distinct contributing mechanism to the same ALB spike pattern was also found during the
  same investigation: `runWithBackgroundUwSweep`'s cluster-wide UW rate-limiter reservation sizing
  under `nighthawk-edition`'s long overnight run (`[uw] queue wait 15000-18500ms` log lines, visible
  as p50-elevated spikes like 04:36 UTC's p50=11.2s — a genuinely different signature: many
  concurrent requests affected, not one blocked task). This is a deliberate, already-mitigated
  tradeoff from a PRIOR incident (2026-09-03) whose tuning (RPS/concurrency caps) is a bigger decision
  than a yield — NOT touched by this fix, and some ALB spikes may persist from that separate cause
  after this ships. Not a reason to hold this fix; flagged for whoever next revisits the UW
  rate-limiter's reservation sizing.

### Evidence of testing

- `npx tsc --noEmit`: clean.
- `npx tsx --experimental-test-module-mocks --test src/lib/providers/polygon-options-gex.test.ts src/lib/providers/gex-regime-invariant.test.ts src/app/api/market/gex-heatmap/route.test.ts`: 98/98 pass — no logic/output changed, confirmed by the full existing suite for this module passing unmodified.
- Full `npm test` (Node 20): run alongside this PR.
- No new regression test added, matching #4822's own precedent for this exact kind of change (a pure
  yield addition with zero computation-logic change is evidenced by the existing suite passing
  unmodified, not by a new test asserting yield-call counts against an unexported helper).
