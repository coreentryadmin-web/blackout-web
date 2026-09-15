> **kind:** FINDING

## `uwGetSafe`'s retry loop had no total-elapsed-time budget — an orphaned retry sequence could starve the shared UW concurrency pool for ~48s, dropping tickers from Night Hawk Legacy's dossier build — FIXED

| **Status** | FIXED (this commit) |
|---|---|

**Root cause:** `uwGetSafe` (`src/lib/providers/unusual-whales.ts`) retries a failed UW call
(429/5xx/transient-network) up to `retries` (default 2) times with exponential backoff
(`1000 * 2^attempt + jitter(0-500)`), with no ceiling on the TOTAL wall-clock time the loop was
allowed to spend. Each individual attempt can itself take up to `trackedFetch`'s own
`DEFAULT_FETCH_TIMEOUT_MS` (15s), so the worst case for the default `retries=2` is 3 attempts ×
up to 15s each + backoff between them — roughly ~48.5s. Nothing above this function ever cancels
that loop once started: `dossierFetch` (`src/features/nighthawk/lib/fetch-timeout.ts`) races each
dossier call against an 8s `Promise.race` that does not actually abort the underlying work when it
loses (a held finding from PR #4990 — the architectural fix was explicitly deferred pending
operator sign-off, which has now been given), and `fetchTickerDossierWithWall` (`dossier.ts`)
races the WHOLE per-ticker dossier build against a 45s wall that likewise only stops the CALLER
from waiting. So a slow/flaky UW call can keep an `uwGetSafe` retry loop running, orphaned, for up
to ~48.5s after every caller that was ever waiting on it has already given up and moved on.

That orphaned loop is not merely wasted work — it actively harms every OTHER concurrent UW caller.
`throttleUw` (`uw-rate-limiter.ts`) enforces `GLOBAL_MAX_CONCURRENCY` (env
`UW_GLOBAL_MAX_CONCURRENCY`, default **2**) as a single ceiling shared by EVERY UW call across the
entire application, not scoped per-ticker or per-caller. An orphaned retry loop holds one of only 2
global slots for its full remaining runtime, so one abandoned sequence can more than halve the
effective UW throughput for everything else in flight during that window — including the OTHER
dossier builds racing their own 45s wall in the same batch.

**Evidence (live, production, 2026-09-14):** traced tonight's thin (1-play) Night Hawk Legacy
evening edition via real CloudWatch Logs (`/ecs/blackout-production`, `[nighthawk/candidates]`
diagnostic lines) end to end: 14 raw candidates → 6 (ASML, KLA, AI, FTFT, PCLA, XHLD) lost to
`fetchTickerDossierWithWall`'s 45s per-ticker wall before ever being scored → 8 scored → 7 below
the 38-point publish floor → 1 published. Live-tested `fetchUwSpotExposuresByStrike` (one of the
~10 second-wave UW calls `dossier.ts` makes per ticker, run via `runUwPooled` at local
concurrency=2) in isolation for FTFT/PCLA/XHLD directly against production UW: fast and clean,
ruling out that specific call as slow on its own. The remaining explanation consistent with all of
it — a full dossier build timing out at 45s while individual calls test fast in isolation,
worsening specifically under concurrent load — is queue starvation from an orphaned retry
sequence eating the shared `GLOBAL_MAX_CONCURRENCY=2` pool, not any one endpoint being genuinely
slow.

**Blast radius:** `uwGetSafe` backs essentially every UW-sourced read in the app (dossier.ts's
~10-call second wave, Vector, Meridian, SPX, swing dossiers, screeners) — anything that calls it
through any of the ~30+ exported `fetchUw*` wrappers in this file inherits the same unbounded
worst-case retry runtime and the same shared-pool-starvation risk. This fix benefits all of them,
not only Night Hawk Legacy's dossier build (which is simply where it was traced this time).

**Fix:** added a 20s total-elapsed-time budget to `uwGetSafe`'s own retry loop
(`UW_GET_SAFE_MAX_RETRY_BUDGET_MS`, env-overridable — comfortably under `DOSSIER_TICKER_WALL_MS`'s
45s so a call that blows the budget has already fallen back to stale-cache-or-null well before the
caller's own wall would have force-skipped the ticker anyway). `attemptStartMs = Date.now()` is
captured once at the top of the loop; each of the three retryable branches (429/5xx/transient-
network) now checks whether the UPCOMING backoff delay would push elapsed time past the budget
(`elapsedMs + delay > maxRetryBudgetMs`) before scheduling it, instead of just `attempt < retries`
— once the budget would be exceeded, the loop falls straight through to the existing
stale-cache-or-null fallback instead of scheduling another attempt. Checking against the upcoming
delay (not just the already-elapsed time) means the loop never overshoots the configured budget by
a whole extra backoff increment.

**A second, independent bug found and fixed while landing this:** an earlier version of this fix
(pushed concurrently to the same branch by a parallel session working the same live incident — see
the "Reconciliation" note below) computed the budget as `uwEnvSec("UW_GET_SAFE_MAX_RETRY_BUDGET_MS",
20) * 1000` — `uwEnvSec` is this file's existing SECONDS-based env helper (used elsewhere here only
for its `_SEC`-suffixed cache-TTL knobs, e.g. `UW_IV_RANK_CACHE_SEC`), so an operator setting
`UW_GET_SAFE_MAX_RETRY_BUDGET_MS` — an `_MS`-suffixed name — to `20000` expecting 20 seconds would
silently arm a ~5.5-HOUR budget instead (20000 SECONDS). Fixed by reading the value directly in
milliseconds via `rateLimiterEnvNumber` (`provider-rate-limiter-shared.ts`), the same helper
`uw-rate-limiter.ts` already uses for its own `_MS`-suffixed knobs (e.g. `UW_CIRCUIT_PAUSE_MS`) —
matching the file's own established `_MS`-means-milliseconds / `_SEC`-means-seconds convention
instead of crossing it. Proven with the same regression test: it fails `3 !== 1` against the
seconds-based version (a 40ms-intended budget was silently treated as 40 SECONDS, so the budget
was never actually exhausted and all 3 attempts ran) and passes at `fetchCount===1` against the
corrected milliseconds-based version.

**Fix rationale — why NOT thread an `AbortSignal` down to `trackedFetch` instead:** the original
plan was to pass an `AbortSignal` from `dossierFetch`'s own 8s timeout down through the ~10
provider functions `dossier.ts`'s second wave calls, into `trackedFetch` (which already correctly
supports an optional caller `signal`, combined via `AbortSignal.any([...])` — so the low-level
plumbing exists). Rejected after reading `throttleUwCoalesced` (`uw-rate-limiter.ts`): it dedupes
identical concurrent UW requests onto ONE shared in-flight promise, so multiple unrelated callers
can be waiting on the exact same fetch. Aborting that fetch because ONE caller's timeout fired
would break every OTHER caller still legitimately waiting on it — a real correctness hazard, worse
than the problem being fixed. Bounding `uwGetSafe`'s own loop instead only stops it from
SCHEDULING a new attempt; an attempt already in flight (possibly shared via coalescing) is left to
resolve or fail on its own, never aborted. Single file, no signature threading through ~10
functions, no coalescing risk, and it benefits every caller of `uwGetSafe`, not just the dossier
path.

**What this does NOT fix (deliberately out of scope):** `dossierFetch`'s own 8s `Promise.race`
still does not cancel the underlying work when it loses the race (the held #4990 finding). This fix
reduces how long an abandoned sequence can run (from ~48.5s to ~20s) and stops it from starving
other concurrent callers past that point, but does not make the race itself cancelling. That
remains a separate, larger architectural change (would need the same `AbortSignal`-threading this
fix deliberately avoided, now safe to revisit in a follow-up specifically BECAUSE this fix caps the
downside in the meantime).

**Reconciliation note, UPDATED (this is the SECOND time reconciling this same collision):** a
parallel session, working the same live incident independently, pushed its own commit
implementing the same fix idea to this same branch name while this fix was in flight, and
force-updated the branch — its implementation (env-read via `uwEnvSec`, the seconds/ms bug
described above) became the branch's head commit. This was reconciled once already (adding the
unit fix, tests, and this doc on top of that commit) — but a SECOND force-push/rebase from what
appears to be the same parallel session subsequently discarded that reconciliation and reset the
branch back to just its original 27-line commit again, rebased onto a newer `main`. This is the
second reconciliation pass, redone on top of that reset state. See the PR's own comment thread for
a durable record of this pattern, since branch content alone has now proven unreliable as the
single place this information lives. No functional behavior from the parallel session's commit was
discarded either time — only the literal unit mismatch was corrected, plus test coverage and this
write-up.

**Test:** `src/lib/providers/unusual-whales.test.ts` — two tests. (1) "uwGetSafe: stops retrying
once its own retry-budget elapses, even with retries left" — sets
`UW_GET_SAFE_MAX_RETRY_BUDGET_MS=40`, mocks `fetch` to sleep a real 80ms (deliberately NOT a
mocked/fake clock — see the test's own comment on a 3+ minute real hang that resulted from mocking
`Date` here, since `uwGetSafe` flows through the REAL production admission path
(`throttleUwCoalesced`/`acquireSlot`/`QueueBudget`/token-bucket refill), all of which also measure
real elapsed time via `Date.now()`, and a frozen/fake clock desyncs from their real
`setTimeout`-driven loops) then throws a transient-network error; asserts exactly 1 fetch attempt.
RED→GREEN proved twice over: against the ORIGINAL pre-fix code (no budget check at all) it fails
`3 !== 1`; against the parallel session's seconds/ms-bugged intermediate version it ALSO fails
`3 !== 1` (the 40ms-intended budget silently became 40 seconds and was never exhausted); against
the final corrected version it passes at `fetchCount===1`. (2) "uwGetSafe: still exhausts all
retries when comfortably within budget" — control, budget=60s, asserts the unchanged behavior
(3 total attempts) still holds when never budget-limited, proving the guard doesn't regress the
normal retry path. `npx tsc --noEmit` clean.
