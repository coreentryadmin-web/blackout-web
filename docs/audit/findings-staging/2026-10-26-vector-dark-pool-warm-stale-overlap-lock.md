## `vector-dark-pool-warm` left its self-overlap lock standing after a lost cross-cron race, silently skipping the NEXT scheduled fire too

> **kind:** FINDING

### Root cause

`src/app/api/cron/vector-dark-pool-warm/route.ts`'s `GET` handler acquires two separate guards in
sequence: a per-cron self-overlap lock (`cron:vector-dark-pool-warm:lock`, `sharedCacheSetNx`,
610s TTL) first, then a cross-cron concurrency slot (`acquireHeavyCronSlot`, shared pool of 2,
see `heavy-cron-concurrency-guard.ts`). When the cross-cron slot is unavailable (another heavy
cron already holds both shared slots), the route returned early with `{ skipped: true, reason:
"heavy-cron concurrency slot unavailable" }` — but never released the self-overlap lock it had
just acquired moments earlier.

That lock's 610s TTL was chosen to exceed the cron's own worst observed runtime with margin, but
the schedule itself fires every 10 minutes (600s) — 10 seconds *less* than the lock's TTL. So a
run that loses the cross-cron race (does zero work) leaves a lock standing that the very next
scheduled fire, 600 seconds later, will still see as held. That next run then reports `"Prior run
still executing"` and skips too — even though nothing was ever actually running. The cron can
silently lose two consecutive scheduled fires (20 minutes of dark-pool cache staleness) from a
single lost cross-cron race, not one.

`heavy-cron-concurrency-guard.ts`'s own header states the intended contract explicitly: *"A cron
that cannot claim a slot skips this run with the same idempotent-skip semantics its own
self-overlap guard already uses and is picked up on its next scheduled fire, a few minutes
later"* — i.e. losing the cross-cron race is supposed to cost exactly one fire, not cascade into
a second. The sibling file using the identical two-lock pattern,
`src/app/api/cron/vector-pick-sweep/route.ts`, already implements this correctly (added in #5975):
on a lost slot race it releases its own overlap lock immediately, with the comment *"so the NEXT
scheduled fire (not this one) gets a clean shot"*. `vector-dark-pool-warm` never received the
matching fix.

### Evidence

Added a regression test (`route.test.ts`) asserting the `if (!slot) { ... }` branch releases
`cron:vector-dark-pool-warm:lock` via `sharedCacheDel` before returning, mirroring the structural
assertion already used for `vector-pick-sweep`. Confirmed RED against the pre-fix source (`git
stash` isolating `route.ts`) and GREEN after the fix — full file: 10/10 pass. `tsc --noEmit`
clean.

### Blast radius

Single call site — `vector-dark-pool-warm`'s own `GET` handler is the only place that acquires
this lock. No other route reads `cron:vector-dark-pool-warm:lock`. The fix is purely additive (one
`sharedCacheDel` call on the already-existing early-return path) and does not change behavior on
any other branch.

### Fix rationale

Release the self-overlap lock in the `if (!slot)` branch, exactly matching `vector-pick-sweep`'s
already-proven fix for the same two-lock interaction — same primitive (`sharedCacheDel`), same
placement (immediately before the early return), same reasoning in an inline comment. No TTL,
schedule, or slot-pool change needed; the bug was purely about forgetting to release a lock that
had already done its job (preventing *this* run from needing the slot check twice) once the run
decided not to proceed.

| **Status** | Fixed in PR #6799 (branch `fix/vector-dark-pool-warm-stale-overlap-lock`) |
|---|---|
