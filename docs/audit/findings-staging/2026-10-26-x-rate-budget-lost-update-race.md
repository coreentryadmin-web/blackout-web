> **kind:** `FINDING`

## X-marketing daily budget counter (`recordBudgetUse`) had an unlocked read-modify-write — concurrent crons could silently lose increments, defeating the rate cap — FIXED

| | |
|---|---|
| **Severity** | P2 (shared mutable state race — undercounts a real rate-limit/spend guard, no member-facing data corruption) |
| **Surface** | `src/lib/x-rate-budget.ts` — `recordBudgetUse`, the shared per-day X-API-action counter behind `X_DAILY_CAPS`/`resolveRunBudget`, written by `x-growth`, `x-engage`, `x-autopost`, and `src/lib/x-mention-replies.ts` |
| **Status** | FIXED |

### Root cause

`recordBudgetUse(action, count)` did an unlocked, two-round-trip read-modify-write against the
single per-ET-day Postgres key-value row (`platform_meta` key `x_marketing_budget_<date>`):

```ts
const b = await loadDayBudget();   // SELECT
b[action] += count;
await saveDayBudget(b);            // UPSERT (overwrite)
```

This row is shared by **multiple separate cron routes**, not one: `x-growth-engine.ts`'s
`runGrowthSweep` is a thin wrapper that calls the exact same `runEngagementSweep` the `x-engage`
cron route calls directly — i.e. `src/app/api/cron/x-growth/route.ts` and
`src/app/api/cron/x-engage/route.ts` are two independently-scheduled HTTP routes invoking the
identical budget-consuming function — plus `src/app/api/cron/x-autopost/route.ts` and
`src/lib/x-mention-replies.ts` (the `x-replies` cron) call `recordBudgetUse` on the same row for
their own action types. None of these four call sites held any lock around the write, and
`recordBudgetUse` itself had none either.

If two of these processes interleave — both `loadDayBudget()` before either `saveDayBudget()`
lands — both compute their increment from the same stale base, and the second write clobbers the
first: one whole action's usage is silently lost (a classic "lost update"). The real X API call
still happened; only the *recorded* count undercounts it. Since `resolveRunBudget`/`remainingDaily`
decide how much headroom is left purely from this recorded count, the undercounted row makes the
budget system believe there is spare capacity that is already spent — defeating the stated purpose
of `X_DAILY_CAPS`, whose own comment is "stay under pay-per-use spend + 429 thresholds."

Within a single `runEngagementSweep` invocation this was never a problem — every
`recordBudgetUse` call there is `await`ed sequentially, never raced against itself. The race is
strictly cross-process: two cron fires overlapping in time (or a manual run overlapping a
scheduled one), racing the *same* `platform_meta` row.

### Evidence

New test `src/lib/x-rate-budget-concurrency.test.ts` mocks `@/lib/db`'s `getMeta`/`setMeta` with a
real async gap on read (modeling an actual Postgres round-trip) so two concurrent
`recordBudgetUse("likes")` calls both read the pre-increment value before either writes — exactly
the interleaving a real overlapping-cron race produces — and mocks `tryAdvisoryLock`/
`releaseAdvisoryLock` with real non-blocking, session-scoped-mutex semantics.

RED→GREEN confirmed via `git stash` on `src/lib/x-rate-budget.ts` alone (test file untouched):
- **Before the fix:** two concurrent `recordBudgetUse("likes")` calls land as `1` instead of `2`
  (lost update); 3 concurrent different-action calls and 8 concurrent same-action calls both
  undercount the same way (`8` increments recorded as `1`).
- **After the fix:** all three cases land the full, correct count every time.

### Blast radius

Every writer of the shared per-day budget row: `x-growth`/`x-engage` (same underlying
`runEngagementSweep`), `x-autopost`, and `x-mention-replies.ts` (the `x-replies` cron). All go
through the one shared `recordBudgetUse` function, so the fix covers every call site with no
further changes needed elsewhere. `resolveRunBudget`/`remainingDaily`/`getDayBudgetSnapshot` (the
readers) needed no change — they already read whatever `recordBudgetUse` last wrote; the bug was
entirely in what got written.

### Fix

Serialized the load+mutate+save critical section in `recordBudgetUse` with the same
`tryAdvisoryLock`/`releaseAdvisoryLock` primitive this repo already uses for whole-cron-run
dedup (`flow-ingest.ts`, `welcome-sequence/route.ts`, `membership-reconcile/route.ts`,
`alert-outcome-sync/route.ts`, `helix-signal-outcomes/route.ts`) — a Postgres session-scoped
advisory lock (`pg_try_advisory_lock(hashtext(...))`), held on a dedicated pooled connection for
exactly the lifetime of one load+save. Since `tryAdvisoryLock` is non-blocking ("try", not a
queue), wrapped it in a short bounded retry (30 attempts × 60ms ≈ 1.8s max) rather than a single
try — the holder releases within one round-trip, so a competing caller only needs to wait out
that one round-trip, not indefinitely. If the lock still can't be acquired after the bound (e.g. a
genuinely stuck holder), falls back to the old unlocked behavior with a `console.warn` rather than
silently dropping the increment forever — no worse than the pre-fix behavior, and now visible in
logs if it ever actually fires.

### Fix rationale

Considered switching the whole counter to a single atomic Postgres UPSERT (e.g. JSONB
`||`-merge-with-increment in one statement) instead of a lock — that removes the retry/backoff
entirely, but it's materially harder to verify correct without a reachable Postgres instance in
this sandbox (raw TCP to Postgres is blocked here per this repo's own environment notes), and this
repo already has a proven, tested primitive for exactly this shape of problem
(`tryAdvisoryLock`/`releaseAdvisoryLock`, used by five other call sites). Reusing it keeps the fix
small, auditable, and consistent with the rest of the codebase rather than introducing a new
unverified SQL pattern for a P2-severity fix. Left `loadDayBudget`/`saveDayBudget` and the
in-memory `memoryMeta` dev/no-DB fallback untouched — `tryAdvisoryLock` already returns `true`
unconditionally when `!dbConfigured()` (matching the existing single-process dev-mode behavior),
so the lock is a no-op exactly where there's nothing to race against.

### Tests

`src/lib/x-rate-budget-concurrency.test.ts` (new, 3 cases: same-action race, different-action
race, 8-way same-action race). Existing `src/lib/x-rate-budget.test.ts` (cap/jitter sanity),
`src/lib/x-engage-engine.test.ts`, `src/lib/x-engage-replies.test.ts` all still pass unaffected
(`recordBudgetUse`'s signature and call sites are unchanged). `npx tsc --noEmit` clean. `npx
eslint` clean on both changed files.
