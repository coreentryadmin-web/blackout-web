## 2026-09-12 — `db-cleanup` nightly cron deadlocked from a concurrent self-invocation; the failure alert carried zero actionable detail

> **kind:** `FINDING`

| | |
|---|---|
| **Status** | FIXED — cross-invocation overlap guard + bounded deadlock retry added to the cron; the alert-message derivation now surfaces a plural `errors[]` array instead of collapsing to the bare word "failed". |
| **Severity** | P2 — one nightly housekeeping table (`vector_wall_history`, 14-day retention) failed to prune for one night; no member-facing data loss or incorrect read (the batched DELETE either fully commits a batch or the whole statement rolls back — nothing was partially deleted). The alert-opacity half is a diagnosability defect, not a correctness one. |

### What was found

Investigated a live "Cron failure: db-cleanup" alert. CloudWatch (`/ecs/blackout-production`)
showed the real Postgres error:

```
2026-09-12 07:04:14.417 UTC  [db-cleanup] vector_wall_history prune failed: deadlock detected
```

Only 1 of ~26 tables failed in that run's `Promise.allSettled` batch (`runCleanup()` in
`src/app/api/cron/db-cleanup/route.ts`); the deadlock (`40P01`) made `pruneErrors.length > 0`,
which set `ok:false` → HTTP 500 → the standing Discord alert fired. Two things needed fixing, not
one:

**1. The deadlock itself was very likely self-inflicted by a concurrent second invocation.** This
route's own BIE-ingest log line (`ingestBieKnowledge()`, exactly one call per request) fired
**three times within ~4 minutes** that night (07:04:23, 07:07:02, 07:08:11 UTC) — i.e. the same
batched-DELETE loop, against the same ~26 tables, running concurrently with itself. `hit-cron`
(blackout-infra's EventBridge→Lambda fetch shim) throws on any non-2xx HTTP response, and AWS's
own retry-on-throw is the most likely reason a failed (500) first attempt produced a second/third
invocation shortly after. A concurrent ECS deploy was also rolling through the exact same minute
(confirmed against `ecr-push-production.yml` run `34677901584`, 06:21:11→07:27:44 UTC), a plausible
contributor to why the first attempt was slow/error-prone enough to trigger whichever AWS retry
path fired. Two concurrent invocations of the same batched-DELETE loop racing for row locks across
~26 shared tables is an ordinary, sufficient way to deadlock on its own — no exotic
DDL-vs-DML theory required, and this route had NO overlap guard at all (unlike
`vector-pick-sweep`/`banger-discovery`/`thermal-discord`/etc., which already use
`sharedCacheSetNx` for exactly this problem shape) — it was a nightly one-shot, so a same-instant
double-fire looked unlikely until it happened.

Deliberately **not** investigated further from this repo: *why* AWS delivered >1 invocation
(Lambda async-invoke retry vs. EventBridge at-least-once delivery) — that configuration lives in
`blackout-infra`, out of this repo's scope, and the exact mechanism could not be pinned down from
here. The fix below makes a second/third concurrent invocation a cheap no-op regardless of why it
was delivered, rather than depending on that root cause being fixed upstream.

**2. Even with the overlap guard, a real concurrent writer can still deadlock a batched DELETE**
(e.g. the Vector bead recorder inserting into `vector_wall_history` mid-prune) — Postgres's
deadlock detector picks a victim and rolls its statement back; the standard, safe remedy for the
losing side is exactly what Postgres's own error tells it to do: retry the statement. There was no
such retry anywhere in `deleteOlderThan`.

**3. The alert itself was contentless.** `db-cleanup`'s failure payload is
`{ ok: false, errors: [{table, error}] }` — a **plural** array — but `logCronRun`
(`src/lib/cron-run.ts`) only ever read a **singular** `result.error`/`result.reason` when deriving
the Discord alert body. With neither present, the message fell through to the bare literal word
`"failed"`. Diagnosing this incident required going straight to CloudWatch instead of the alert
itself telling us which table or why.

**Blast radius checked, not assumed:** the investigation this fix is based on flagged
`nighthawk-morning-confirm`, `x-replies`, and `nighthawk-outcomes` as similarly affected because
they also populate a plural `errors` field. Direct source inspection before fixing anything found
this is **not** actually true for any of the three as shipped: `nighthawk-outcomes` already
pre-summarizes its own `errors` array into a singular `error` string
(`nighthawkOutcomesRunHealth`, `play-outcomes.ts`) before calling `logCronRun`; `x-replies` and
`nighthawk-morning-confirm` keep `ok:true` on every code path that also carries a plural `errors`
array, so `logCronRun`'s status never becomes `"failed"` there in the first place — the
contentless-alert bug only actually fires for `db-cleanup` today. The `cron-run.ts` fix is still a
correct, general-purpose defensive improvement (it fixes today's real db-cleanup bug and protects
any future/other cron that ships the same `{ok:false, errors:[...]}` shape without a singular
summary), but this entry does not claim it was live-broken for those three today — verified, not
assumed.

### What changed

- **`src/app/api/cron/db-cleanup/route.ts`**: added a cross-invocation `sharedCacheSetNx` overlap
  lock (`db-cleanup:running`, 600s TTL — 2x the route's own 300s `maxDuration`, so a slow-but-healthy
  run's own lock cannot expire mid-run and let a genuine retry start a second real run). A lost
  race returns `{ok:true, skipped:true, reason:"previous db-cleanup run still in flight..."}`
  instead of running the prune again; the lock fails OPEN on a Redis error (a missed guard is
  safer than a permanently wedged nightly prune) and is released in a `finally` so every exit path
  (success, thrown error, early skip) frees it for the next run.
- **`src/lib/deadlock-retry.ts`** (new): a small, pure/injectable `runWithDeadlockRetry(run, opts)`
  helper that retries ONLY Postgres `40P01 deadlock_detected` (bounded, default 3 retries,
  jittered/growing backoff) and rethrows everything else — including the existing `42P01`
  undefined-table case — on the first attempt, unchanged.
- **`src/app/api/cron/db-cleanup/route.ts`**: each batch's `dbQuery(...)` DELETE now runs through
  `runWithDeadlockRetry`, so a real deadlock against a concurrent writer no longer fails that
  table's whole prune outright.
- **`src/lib/cron-run.ts`**: extracted the status/message derivation into a pure, exported
  `deriveCronRunStatus()` and added a fallback that summarizes a plural `errors` array (up to 5
  entries, `table: error` when both are present, `+N more` beyond that, capped at 500 chars like
  before) when no singular `error`/`reason` is set — instead of collapsing to the bare word
  `"failed"`.

### Fix rationale — why this, not something else

- The overlap guard, not a distributed lock or a queue: this is the exact, already-established
  pattern (`sharedCacheSetNx`) five other crons in this repo already use for the identical
  "don't let two invocations of the same job run at once" problem — reusing it keeps the fix
  small and consistent rather than inventing a new mechanism.
- Deadlock retry is scoped to `40P01` only, never a blanket "retry any DB error" — a deadlock is
  the one Postgres error code that specifically means "retry me, I was rolled back through no
  fault of my own"; retrying, say, a constraint violation or a connection drop would be wrong.
- Left unchanged: the `42P01` (undefined_table) skip-and-self-heal behavior, the batch size/loop
  structure, every retention window, and all ~26 cleanup targets — this fix is scoped to the
  concurrency/retry/alerting failure mode, not a rewrite of the cleanup logic.
- The `cron-run.ts` fix is deliberately a fallback, not a replacement: a singular `error`/`reason`
  still wins when present (unchanged for every other cron), so no existing alert's wording changes
  — only the previously-contentless case gains content.

### Evidence

- Live CloudWatch: the exact `deadlock detected` line above, plus the BIE-ingest log line firing
  3x in ~4 minutes (07:04:23 / 07:07:02 / 07:08:11 UTC) confirming concurrent invocations.
  `ecr-push-production.yml` run `34677901584` (06:21:11→07:27:44 UTC) confirms an ECS deploy was
  in flight the same window.
- `src/features/vector/lib/vector-wall-db-row.ts`'s own header documents 4 prior `deadlock
  detected` errors on a DIFFERENT `vector_wall_history` writer path (the bead recorder's own
  multi-row UPSERT) over a ~29h window on 2026-09-01, independently confirming this table is a
  real, recurring deadlock hot-spot under concurrent writers — consistent with (not proof of) this
  incident's own cause.
- RED→GREEN regression tests, each proven to fail against the pre-fix code and pass against the
  fix (file-swap method, not `git stash`, to avoid disturbing concurrent sessions in this shared
  checkout):
  - `src/lib/deadlock-retry.test.ts` (6 tests) — retries only `40P01`, bounded, jittered backoff,
    rethrows everything else including "no `.code` at all" immediately.
  - `src/lib/cron-run.test.ts` (13 tests) — the exact db-cleanup failure shape
    (`{ok:false, errors:[{table,error}]}`) now derives a real message; singular `error`/`reason`
    still takes precedence; empty `errors` array still degrades to `"failed"`; 500-char cap holds.
  - `src/app/api/cron/db-cleanup/route.test.ts` (7 tests, source-text assertions matching this
    repo's existing `vector-pick-sweep/route.test.ts` convention for the same guard shape) —
    overlap lock acquired before `runCleanup()`, lost-race skip path, fail-open on Redis error,
    single `finally`-based release site, TTL exceeds `maxDuration`, batches go through
    `runWithDeadlockRetry`, and the 42P01 skip behavior is provably unchanged.
- Full `npm test` (Node 20.20.2) post-fix: see PR for the exact pass/fail count. `npx tsc --noEmit`:
  clean.

### Not done here (deliberately out of scope)

- Fixing *why* AWS/`hit-cron` delivered more than one invocation — that is `blackout-infra`
  (Lambda + EventBridge config), not this repo; raised for awareness, not fixed here.
- Any change to `cron-run.ts`'s behavior for `nighthawk-morning-confirm`/`x-replies`/
  `nighthawk-outcomes` beyond the general fallback — verified above that none of the three
  actually hit the contentless-alert bug as shipped, so there was nothing specific to fix in them.
