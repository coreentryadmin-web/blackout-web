> **kind:** `FINDING`

## X-marketing engagement-target rotation index (`bumpEngageRotation`) had an unlocked read-modify-write — concurrent crons could silently lose a rotation step — FIXED

| | |
|---|---|
| **Severity** | P3 (shared mutable state race — cosmetic: a repeated/skipped target-rotation offset, no spend/dedup/safety impact) |
| **Surface** | `src/lib/x-marketing-meta.ts` — `bumpEngageRotation`, the shared engagement-target rotation counter behind `x-engage-engine.ts`'s `runEngagementSweep`, called from both the `x-growth` and `x-engage` cron routes |
| **Status** | FIXED |

### Root cause

`bumpEngageRotation()` did an unlocked, two-round-trip read-modify-write against the single
Postgres key-value row (`platform_meta` key `x_marketing_engage_rotation`):

```ts
const next = ((await getEngageRotationIndex()) + 1) % 1000;  // SELECT
await writeMeta(ENGAGE_ROTATION_KEY, String(next));          // UPSERT (overwrite)
```

This row is shared by **two separate cron routes**: `src/app/api/cron/x-growth/route.ts` and
`src/app/api/cron/x-engage/route.ts` both invoke `x-engage-engine.ts`'s `runEngagementSweep`
directly (`x-growth-engine.ts`'s `runGrowthSweep` is a thin wrapper around the exact same
function `x-engage`'s route calls), and every call to `runEngagementSweep` calls
`bumpEngageRotation()` exactly once to decide which engagement targets rotate in next. Neither
call site held any lock, and `bumpEngageRotation` itself held none either — the same
unlocked-read-modify-write shape as `recordBudgetUse` (round 111, PR #6906) and `markTweetReplied`
(round 112, PR #6908).

If two of these processes interleave — both `getEngageRotationIndex()` before either
`writeMeta()` lands — both compute `base + 1` from the same stale base, and the second write
clobbers the first: one whole rotation step is silently lost (a classic "lost update"). This is
the exact same race shape as the two already-fixed siblings, just on a lower-stakes field: the
rotation index only decides which targets get engaged next, so a lost step means a target is
revisited slightly sooner (or a different one slightly later) than intended — a cosmetic drift,
not a correctness, spend, or dedup problem (unlike the budget counter undercounting real spend,
or the replied-ids race risking a duplicate public reply/quote).

### Evidence

New test `src/lib/x-marketing-meta-rotation-concurrency.test.ts` mocks `@/lib/db`'s
`getMeta`/`setMeta` with a real async gap on read (modeling an actual Postgres round-trip) so two
concurrent `bumpEngageRotation()` calls both read the pre-increment value before either writes —
exactly the interleaving an overlapping `x-growth`/`x-engage` race produces — and mocks
`tryAdvisoryLock`/`releaseAdvisoryLock` with real non-blocking, session-scoped-mutex semantics.

RED→GREEN confirmed via `git stash` on `src/lib/x-marketing-meta.ts` alone (test file untouched):
- **Before the fix:** two concurrent `bumpEngageRotation()` calls from a `0` base both land as
  `1` instead of advancing to `1` and `2` (lost update); 8 concurrent calls land the index at `1`
  instead of `8`; two concurrent calls from a `998` base land at `999` instead of correctly
  wrapping to `0` (one step lost at the modulo boundary too).
- **After the fix:** all three cases advance the index by exactly one per call, every time,
  including the wraparound case.

### Blast radius

The only writer of `ENGAGE_ROTATION_KEY` is `bumpEngageRotation` itself, and its only caller is
`runEngagementSweep` — reached from both the `x-growth` and `x-engage` cron routes. The fix covers
both call sites with no further changes needed elsewhere. `getEngageRotationIndex` (the reader)
needed no change — it already reads whatever `bumpEngageRotation` last wrote; the bug was
entirely in what got written.

### Fix

Serialized the load+mutate+save critical section in `bumpEngageRotation` with the same
`tryAdvisoryLock`/`releaseAdvisoryLock` primitive `recordBudgetUse`/`markTweetReplied` already
use — a Postgres session-scoped advisory lock, held on a dedicated pooled connection for exactly
the lifetime of one load+save. Gave it its own dedicated lock key
(`x-marketing-engage-rotation-write`), distinct from `recordBudgetUse`'s
(`x-marketing-budget-write`) and `markTweetReplied`'s (`x-marketing-replied-ids-write`), so this
unrelated critical section never serializes against those — the three fields are independent and
have no reason to contend with each other. Since `tryAdvisoryLock` is non-blocking ("try", not a
queue), wrapped it in the same short bounded retry (30 attempts × 60ms ≈ 1.8s max) used by the two
sibling fixes — the holder releases within one round-trip, so a competing caller only needs to
wait out that one round-trip, not indefinitely. If the lock still can't be acquired after the
bound (e.g. a genuinely stuck holder), falls back to the old unlocked behavior with a
`console.warn` rather than stalling the rotation forever — no worse than the pre-fix behavior, and
now visible in logs if it ever actually fires.

### Fix rationale

Same rationale as the two already-merged/in-flight siblings: reuse the existing, proven
`tryAdvisoryLock`/`releaseAdvisoryLock` primitive rather than redesigning the storage as a single
atomic UPSERT, for consistency and because raw Postgres isn't reachable from this sandbox to
verify a new SQL pattern. Deliberately gave this fix its own lock key rather than reusing
`recordBudgetUse`'s or `markTweetReplied`'s — bumping the rotation index has nothing to do with
either of those fields, and sharing a lock key across unrelated critical sections would add false
contention (a growth sweep incrementing the budget counter would needlessly block an engage sweep
bumping rotation, and vice versa) for no correctness benefit.

Also evaluated, during round 113, whether this fix was even worth forcing given its purely
cosmetic impact (no spend, dedup, or safety consequence) — concluded yes, now that the two
higher-severity siblings are already fixed/in-flight: the remaining risk is zero and the fix is a
direct, cheap copy of an already-reviewed pattern, closing out this file's known race-condition
class rather than leaving one known-but-deferred item on it indefinitely.

### Tests

`src/lib/x-marketing-meta-rotation-concurrency.test.ts` (new, 3 cases: 2-way race from a 0 base,
8-way race, 2-way race across the `998 -> 999 -> 0` modulo wraparound boundary). Existing
`src/lib/x-rate-budget.test.ts`, `src/lib/x-rate-budget-concurrency.test.ts`,
`src/lib/x-engage-engine.test.ts`, `src/lib/x-engage-replies.test.ts`,
`src/lib/x-marketing-env.test.ts`, `src/lib/x-marketing-meta-freshness.test.ts` all still pass
unaffected (`bumpEngageRotation`'s signature and call sites are unchanged). `npx tsc --noEmit`
clean. `npx eslint` clean on both changed files.
