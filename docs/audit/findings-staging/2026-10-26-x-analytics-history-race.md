> **kind:** FINDING

## `saveAnalyticsSnapshot` appended to `x_marketing_analytics_history` with an unlocked read-modify-write — FIXED

| | |
|---|---|
| **Area** | X marketing analytics (`src/lib/x-marketing-meta.ts`) |
| **Status** | FIXED (#TBD) |
| **Severity** | P3 — correctness bug, not member-facing; weakens a trend/debugging history |

### Root cause

`saveAnalyticsSnapshot` (called by `collectXAnalyticsSnapshot` on every `x-analytics` cron run)
wrote the "latest" pointer with a pure overwrite (`writeMeta(ANALYTICS_KEY, ...)` — safe, no prior
value involved), but then appended to the rolling history with an **unlocked
read-modify-write**: `readMeta(ANALYTICS_HISTORY_KEY)` → parse → `history.push(snap)` →
`writeMeta(ANALYTICS_HISTORY_KEY, ...)`, two separate Postgres round-trips with no lock between
them.

This is byte-for-byte the same lost-update shape already found and fixed in this file for
`recordPostHook` (round 113) and in `x-rate-budget.ts` for `recordBudgetUse` (round 111): if two
callers interleave — both read the same base history array before either writes — the **second
write clobbers the first**, and one entire analytics snapshot silently vanishes from history. The
"latest" snapshot (`ANALYTICS_KEY`) is unaffected (each write there is self-contained), so the bug
is invisible on the admin dashboard's "current" card and only shows up as a missing day in the
trend history — the same "hard to notice, not hard to cause" shape the sibling fixes already
called out.

### Why this is a real, not just theoretical, interleaving

`x-analytics` is scheduled once/day (`cron-registry.ts`, `schedule_cron_utc: "30 23 * * *"`), which
on its own would make overlap rare. But `scripts/x-marketing-audit.mjs` calls
`GET /api/cron/x-analytics` **directly, without `?dry=1`**, to pull a fresh snapshot for its own
audit output — i.e. a real, already-committed script in this repo triggers a full
`collectXAnalyticsSnapshot()`/`saveAnalyticsSnapshot()` run on demand, through the exact same
cron-authorized route the scheduler uses. A manual audit run landing near the scheduled 23:30 UTC
fire, or two overlapping manual audit runs (e.g. two agents auditing X marketing in the same
cycle), reproduces the interleaving exactly — the same "two overlapping invocations of the same
route" scenario the `recordPostHook` fix's own comment named as the realistic case for a
once-call-site function.

### Evidence

Added `src/lib/x-marketing-meta-analytics-history-concurrency.test.ts`, modeling the real
async-gap Postgres interleaving the same way the sibling
`x-marketing-meta-hooks-concurrency.test.ts`/`x-rate-budget-concurrency.test.ts` do: a fake
`getMeta` that resolves on a macrotask tick so two concurrent `saveAnalyticsSnapshot` calls both
read the pre-update history before either writes, and a fake `tryAdvisoryLock`/
`releaseAdvisoryLock` modeling a real Postgres session-scoped advisory lock.

- **RED (pre-fix, via `git stash`):** two concurrent `saveAnalyticsSnapshot` calls → only 1 of 2
  snapshots survived in history (confirmed by test failure: `"first concurrent snapshot must be
  recorded — a lost update would drop it"`); the 8-concurrent-calls test similarly undercounted.
- **GREEN (post-fix):** both/all concurrent snapshots land in history; a third test confirms the
  "latest" pointer still correctly reflects the most recently saved snapshot (proving the fix
  didn't accidentally serialize or break that independent overwrite path).

### Fix

Wrapped the `ANALYTICS_HISTORY_KEY` read+append+write in the same
`tryAdvisoryLock`/`releaseAdvisoryLock` critical section already used for `HOOKS_WRITE_LOCK`
(`recordPostHook`) and `BUDGET_WRITE_LOCK` (`recordBudgetUse`) in this codebase — a new
`ANALYTICS_HISTORY_WRITE_LOCK` global key, bounded retry (30 attempts × 60ms), with the same
"could not acquire lock → fall back to the old unlocked behavior rather than dropping the
snapshot forever, and log it" degradation path as its siblings. The `ANALYTICS_KEY` ("latest")
write is left untouched/unlocked — it's a pure overwrite with no read dependency, so locking it
would add contention for no correctness benefit.

### Blast radius

Single call site (`collectXAnalyticsSnapshot` → `saveAnalyticsSnapshot`), single file. No other
consumer of `ANALYTICS_HISTORY_KEY`/`getAnalyticsHistory` writes to it, so no other code path needed
touching.
