## 2026-09-04 — [P3, observability] UW rate limiter had no way to log a successful-but-slow admission — a request that queued 15s+ and then SUCCEEDED left zero trace — FIXED

> **kind:** `FINDING`

| | |
|---|---|
| **Severity** | P3 — observability gap, not a functional defect. Directly blocks the follow-up two prior RUN-LOG entries today (18:11 UTC, 19:19 UTC) both named as the correct next step: measuring UW rate-limiter queue wait time to determine whether it, not the throttle itself, explains the measured member-facing tail latency. |
| **Found by** | Reading `queue-budget.ts`/`uw-rate-limiter.ts` while following up on the 19:19 UTC `contract-picks` timeout corroboration entry |
| **Status** | FIXED |

### Root cause

`QueueBudget.waitedMs()` already tracks how long an admission attempt has been waiting, but the
only place that value was ever surfaced was `assertWithinBudget()` throwing
`RateLimiterQueueTimeoutError` — which fires exclusively once the budget is **fully exhausted**.
A request that queued for, say, 15 seconds and then successfully acquired a slot left absolutely
no trace anywhere: not in `console.warn`, not in CloudWatch Logs. The only other observable signal
(`maybeFlushRateLimitSummary`'s `[uw] N rate-limited endpoints in last 60s`) counts 429 responses,
which says nothing about admission queueing. This meant the entire "admitted but slow" middle of
the distribution — exactly the range a tail-latency investigation needs — was invisible.

### Fix

`acquireSlot()` now returns the total ms it waited (previously `Promise<void>`) instead of
discarding it. `throttleUw` — the single choke-point every UW call goes through — captures that
value and, when it's at or above `QUEUE_WAIT_LOG_THRESHOLD_MS` (500ms — chosen so the common,
uncontended path stays silent), logs `[uw] queue wait <ms>ms` via `console.warn`, appending
`(background sweep)` when `isBackgroundUwSweep()` is true so a live-traffic wait is never
conflated with an expected background-sweep wait when reading logs back.

The formatting logic is extracted into a pure, exported `formatQueueWaitLog(waitedMs,
isBackgroundSweep)` function specifically so it's unit-testable without simulating real
rate-limiter contention (Redis mocking, concurrent-slot exhaustion, etc.) — `throttleUw` itself
just calls it and logs if non-null.

### Evidence

RED (`git stash` on just the source change, test kept applied): 2 new tests fail —
`formatQueueWaitLog is not a function` (`TypeError`). GREEN after restoring: 12/12 pass in
`uw-rate-limiter.test.ts`, including the two new tests (`formatQueueWaitLog: below threshold is
silent`, `formatQueueWaitLog: at/above threshold logs the wait, tagged by caller type`).

`npx tsc --noEmit` clean — confirms the only caller of `acquireSlot()` (`throttleUw`, same file)
was updated for the new `Promise<number>` return type and no other file depends on its signature.

### Blast radius

Single file (`uw-rate-limiter.ts`) plus its test file. No behavior change to admission timing,
concurrency, or rate limiting itself — `acquireSlot()`'s control flow is byte-identical, it now
just returns a value it was already computing (`budget.waitedMs()`) instead of discarding it. The
only new runtime effect is an occasional `console.warn` line when a wait crosses 500ms.

### Fix rationale

A pure formatter over inlining the string-building directly in `throttleUw` because the threshold
and tagging logic is exactly what the next investigation cycle needs to trust — this way it's
tested the same way the rest of this toolkit's pure helpers are (`lib/helix-score-eval.mjs`,
`lib/print-window-eval.mjs`, etc.), not just asserted by comment. 500ms threshold chosen to keep
the log line meaningful (below that, admission is effectively uncontended and logging it would
just be noise) while still catching anything a member would plausibly notice.

### What this enables, not yet done

This is instrumentation, not a fix to the underlying tail latency itself. The next RTH session's
CloudWatch Logs will show real `[uw] queue wait` lines — filtering on `(background sweep)` vs not
will finally let someone directly measure whether the shared rate limiter's queue is the actual
bottleneck behind the `vector-pick-sweep` cron slowness and the `contract-picks` timeout (both
logged earlier today), or whether the slowness lives elsewhere in the pipeline (Polygon chain
fetch latency itself, DB round-trips, etc.).
