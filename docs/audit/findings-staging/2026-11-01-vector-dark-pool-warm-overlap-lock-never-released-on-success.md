> **kind:** FINDING

## `vector-dark-pool-warm`'s self-overlap lock was never released on its success/failure path — only on a lost cross-cron-slot race — silently halving its effective warm cadence — FIXED

**Status:** FIXED. **Severity:** P2 (self-inflicted cache-staleness risk, not a wrong-answer bug —
but it undermines the rotation design's own stated coverage-timing assumption). **Area:**
`src/app/api/cron/vector-dark-pool-warm/route.ts`.

### What's wrong

This cron acquires a self-overlap lock (`cron:vector-dark-pool-warm:lock`, `sharedCacheSetNx`,
610s TTL = "10min + 10sec buffer for schedule variance", per its own in-file comment) before
dispatching its background warm work via `after()`. On 2026-10-26 a fix (confirmed via the
existing `route.test.ts`'s own regression test) made a *lost cross-cron-concurrency-slot race*
release that lock immediately, with the comment: "Without this, the self-overlap lock... sits for
its full 610s TTL even though no work ever ran, causing the next scheduled fire... to also be
skipped as 'prior run still executing' when nothing was actually running."

That fix only covered the early-return branch where the heavy-cron slot acquisition itself fails.
The function that wraps the REAL background work — `runVectorDarkPoolWarm(started, slot)` — never
released the lock at all, on either its success or failure path; its only `finally` block released
the cross-cron `slot`, not the self-overlap lock:

```ts
async function runVectorDarkPoolWarm(started: number, slot: HeavyCronSlot): Promise<void> {
  try {
    await runVectorDarkPoolWarmInner(started);
  } finally {
    await slot.release();   // <-- only the cross-cron slot; the self-overlap lock is untouched
  }
}
```

Three sibling files on the exact same self-overlap-lock pattern (`vector-pick-sweep`,
`vector-walls-warm`, `vector-full-state-snapshot`) all release their own overlap lock inside this
same kind of `finally` block, wrapping the real work — this route was the one exception.

### Why this matters (the cadence math, not just "it's inconsistent")

The lock's 610s TTL was deliberately sized to just barely outlast the ~10-minute (600s) schedule
("10min + 10sec buffer for schedule variance"). That sizing assumption is sound **only if the lock
is released as soon as the real work finishes** — otherwise a normal run that completes in well
under 610s (this cron's own comment: "measured runtime can reach 220+ seconds") leaves the lock
standing, unreleased, for the REST of its 610s lifetime. Since 610s > the ~600s gap to the next
scheduled fire, that next fire finds the lock still valid, reads `acquired === false`, and skips
with `"Prior run still executing"` — even though the prior run finished minutes earlier and nothing
is actually executing. The lock only clears via its own TTL expiry, which happens just after (not
before) the next scheduled fire — so **every other scheduled fire was silently skipped**, halving
this cron's effective cadence from ~10 minutes to ~20 minutes.

That matters because the 2-way ticker-rotation design (`rotation.ts`'s own header comment,
2026-10-07) explicitly sizes itself around a working ~10-minute cadence: "a 2-way rotation
completes full coverage in ~20 minutes (comfortably under the 25-minute [cache] TTL)". At the real
~40-minute effective cadence this bug produced, half the universe's `warmVectorDarkPool` cache
entries (25-minute TTL, `vector-dark-pool-cache.ts`) would go stale and expire empty between warms
— the exact regression class the rotation's own 2-way (not 3-way) choice was written to avoid, now
reintroduced from a different angle the rotation design never anticipated.

### Evidence

Read `vector-dark-pool-warm/route.ts` in full off `origin/main` (confirmed no drift this round —
`git fetch origin main -q && git log HEAD..origin/main --oneline | wc -l` returned `0`) and
diffed against the three sibling files:

- `vector-pick-sweep/route.ts`: `runPickSweep`'s `finally` block is
  `await sharedCacheDel(OVERLAP_LOCK_KEY).catch(() => undefined); await slot.release();` —
  releases the overlap lock AND the cross-cron slot together, every run.
- `vector-walls-warm/route.ts` and `vector-full-state-snapshot/route.ts`: same shape, confirmed via
  `grep -n "sharedCacheDel\|OVERLAP_LOCK_KEY\|finally"` on each file — both show a `finally` block
  releasing `OVERLAP_LOCK_KEY` immediately after (or inside) their real work's wrapper.
- `vector-dark-pool-warm/route.ts` (pre-fix): `grep -n "cron:vector-dark-pool-warm:lock"` returned
  exactly 3 hits — the acquisition (`sharedCacheSetNx`) and the lost-race release inside
  `if (!slot) { ... }` — zero hits inside `runVectorDarkPoolWarm`'s own `finally`.

Regression test added to `route.test.ts` (12 assertions total, 2 new) asserts both that
`OVERLAP_LOCK_KEY` is hoisted to a shared constant used at every acquire/release site, and
specifically that `runVectorDarkPoolWarm`'s own body (not just the earlier lost-race branch)
contains a `sharedCacheDel(OVERLAP_LOCK_KEY)` call. **RED→GREEN verified**: run against the
pre-fix `origin/main` source, 4/12 assertions fail (including the two new ones); against the
fixed source, 12/12 pass. Full suite scoped run:
`npx tsx --experimental-test-module-mocks --test src/app/api/cron/vector-dark-pool-warm/route.test.ts`
(12 pass) and `rotation.test.ts` (8 pass, unaffected). `tsc --noEmit` clean.

### Blast radius

Single file + its test. No other route shares this exact self-overlap-lock variable (each cron's
lock key is its own string); the three sibling files checked (`vector-pick-sweep`,
`vector-walls-warm`, `vector-full-state-snapshot`) already release correctly and needed no change.
`vector-universe-snapshot` was also checked and has no self-overlap lock of this kind at all (not
in scope for this finding).

### Fix

Hoisted the lock key to a shared `OVERLAP_LOCK_KEY` constant (previously re-typed as the literal
`"cron:vector-dark-pool-warm:lock"` at both the acquisition and the lost-race release site — small
drift risk in its own right) and added `await sharedCacheDel(OVERLAP_LOCK_KEY).catch(() =>
undefined);` to `runVectorDarkPoolWarm`'s existing `finally` block, alongside the `slot.release()`
call already there — matching the sibling files' pattern exactly. No behavior change to the
lost-race branch, the rotation logic, or the UW pooling/concurrency bounds; this only makes the
lock's actual lifetime match its documented intent (bound the overlap window, not silently
suppress every other scheduled fire).
