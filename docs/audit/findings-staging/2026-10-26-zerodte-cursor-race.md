> **kind:** `FINDING`

## 0DTE discovery/rejection observability cursors (`ZERODTE_REJECTION_CURSOR_KEY`, `DISCOVERY_EVENT_CURSOR_KEY`) had an unlocked read-modify-write raced by multiple concurrent, unawaited call sites in a single scan cycle — FIXED

| | |
|---|---|
| **Severity** | P3 (pure observability/audit data — `zerodte_discovery_events`/`zerodte_scan_rejections` never gate a live trade — but a genuine, confirmed lost-update bug that defeats these tables' whole dedup purpose) |
| **Surface** | `src/lib/zerodte/rejections.ts` (`persistZeroDteRejections`), `src/lib/zerodte/discovery-events-persist.ts` (`persistDiscoveryDetectedEvents`/`persistDiscoveryGateBlockedEvents`/`persistDiscoveryCommitEvents`), both consumed from `src/lib/zerodte/scan.ts` |
| **Status** | FIXED |

### Root cause

Both cursor functions follow the same shape: read the ENTIRE cursor blob out of
`platform_meta` as a JSON map (`getMeta` → `JSON.parse`), mutate it in memory per-ticker, and
write the WHOLE blob back (`JSON.stringify` → `setMeta`, a plain `INSERT ... ON CONFLICT DO
UPDATE SET value = EXCLUDED.value` — no version check, no lock). That is correct when calls are
sequential, but in production both cursors are read-modify-written from **multiple concurrent,
unawaited (`void ... .catch(...)`) call sites within a single `warmZeroDteBoard` cycle**:

- `ZERODTE_REJECTION_CURSOR_KEY` (`rejections.ts`) — raced by `scan.ts:1842` and `scan.ts:2321`
  (both inside `persistZeroDteScan`, two independently-derived rejection populations — the
  initial-commit gate rejections and the atomic-commit recount rejections) and `scan.ts:2661`
  (inside `warmZeroDteBoard` itself, after `await persistZeroDteScan(setups)` — that `await` does
  **not** wait for the `void` calls fired *inside* `persistZeroDteScan`, so all three can still be
  in flight together).
- `DISCOVERY_EVENT_CURSOR_KEY` (`discovery-events-persist.ts`) — raced by `scan.ts:1845` and
  `scan.ts:2362` (both inside `persistZeroDteScan`) and `scan.ts:2662`/`scan.ts:2665` (inside
  `warmZeroDteBoard`).

When two of these interleave: both read the same base map before either writes, both mutate
their own in-memory copy (each adding a *different* ticker), then both write the whole blob back
— whichever `setMeta` resolves **last** silently clobbers the other's addition, and also discards
the dedup history for every *other* ticker already in the blob it read before the race. This
causes a duplicate `zerodte_scan_rejections`/`zerodte_discovery_events` row immediately (this
tick, since the clobbered ticker's entry never lands) and cascading duplicates on later ticks (a
clobbered ticker reads as "never logged" again, so an unchanged rejection/detection re-logs next
cycle too) — defeating the cursor's whole stated purpose: "one row per ticker per DISTINCT state
transition, not one row per scan cycle."

**Why existing tests never caught this:** `discovery-events-persist.test.ts` and
`rejections.test.ts` only ever call these functions sequentially, one `await`ed call after
another. That exercises the throttle logic correctly in isolation but can never produce the
interleaving that causes a lost update — the bug is purely about *two in-flight calls racing the
same read-modify-write*, which a sequential test harness structurally cannot reproduce.

**Explicitly not a duplicate-call-removal fix.** A first read suggests "these are redundant
calls, just drop one" — that is wrong. `gateRejections` (computed inside `persistZeroDteScan`
from `freshCandidates`' plan/precondition blocks) and the top-level `rejections` (computed
earlier in `scanZeroDteBoard` from the evidence-gate check) are **different, independently-derived
rejection populations**, not duplicate calls with the same data; dropping either would silently
drop real gate-blocked-event logging for a genuinely distinct rejection set.

### Evidence

New regression tests (RED→GREEN, confirmed via a real revert/restore cycle rather than asserted):
`src/lib/zerodte/rejections.test.ts` and `src/lib/zerodte/discovery-events-persist.test.ts` each
got a `tryAdvisoryLock`/`releaseAdvisoryLock` fake (the same non-blocking, session-scoped-mutex
shape `x-rate-budget-concurrency.test.ts` uses for `recordBudgetUse`'s identical race) plus a
real async gap on `getMeta` so two concurrent calls provably both read the cursor before either
writes.

- `persistZeroDteRejections`: two concurrent calls for *different* tickers (mirroring
  `scan.ts`'s real `gateRejections`/`recountRejections`/top-level-`rejections` race) — asserts
  BOTH tickers' cursor entries survive, then confirms the throttle still holds on a repeat.
- `persistDiscoveryGateBlockedEvents`: two concurrent calls for different tickers — same
  assertion.
- `persistDiscoveryGateBlockedEvents` + `persistDiscoveryCommitEvents` racing concurrently for
  different tickers — the cross-FUNCTION race that actually occurs in production
  (`scan.ts:2362` vs `scan.ts:2665`), not just two calls of the same function.

**Before the fix** (verified by checking out the pre-fix `rejections.ts`/
`discovery-events-persist.ts` from `origin/main` while keeping the new tests, then running
`npx tsx --experimental-test-module-mocks --test`): all 3 new tests **FAIL** —
`"AAA's cursor entry must survive the race"` / `"the gate-blocked write's cursor entry must
survive"` assertion errors, with the clobbered ticker's entry provably missing from the final
cursor JSON. All pre-existing sequential tests in both files still pass (16/19 total), confirming
the bug is specifically about concurrency, not a general regression.

**After the fix** (restoring the locked implementation): all 19 tests in both files pass,
including the 3 new regression cases.

### Blast radius

Both cursor keys and every call site listed above in `scan.ts` — none of `scan.ts`'s call sites
needed to change (the lock is acquired *inside* the existing exported functions, so every
fire-and-forget `void ... .catch(...)` caller gets the fix for free). `exit-engine.ts`,
`iron-condor.ts`, and the Vector files flagged clean in the same audit pass were **not** touched —
out of scope, no read-modify-write race was found there.

### Fix

Wrapped the full read-modify-write critical section (load cursor → mutate → save cursor) of each
function in a `tryAdvisoryLock`/`releaseAdvisoryLock` pair, mirroring the exact pattern already
used in this repo for the identical shape (`x-rate-budget.ts`'s `recordBudgetUse`,
`x-marketing-meta.ts`'s `recordPostHook`):

- `rejections.ts`: `persistZeroDteRejections` now acquires `"zerodte-rejection-cursor-write"`
  before calling the (new, internal) `writeRejectionsLocked` helper that holds the previous
  function body unchanged; bounded retry (30 × 60ms ≈ 1.8s), falls back to the old unlocked path
  with a `console.warn` if the lock can't be acquired in that window (never silently drops a
  cycle's rejections).
- `discovery-events-persist.ts`: a single shared `"zerodte-discovery-event-cursor-write"` lock
  (one global key, not per-function, since all three functions read-modify-write the SAME
  `DISCOVERY_EVENT_CURSOR_KEY` blob and must serialize against *each other*, not just against
  repeat calls of themselves) via a new `withDiscoveryEventCursorLock` helper that each of
  `persistDiscoveryDetectedEvents`/`persistDiscoveryGateBlockedEvents`/`persistDiscoveryCommitEvents`
  wraps its existing body in. Same bounded retry/fallback shape.

`scan.ts`'s call sites are deliberately unchanged — they stay fire-and-forget
(`void ... .catch(...)`), since the lock makes the underlying blob write safe regardless of
whether the outer call is awaited by its caller.

### Fix rationale

Advisory-lock serialization (not dropping any call) because, per the correction above, the
colliding call sites are not duplicates — each persists a real, independently-derived rejection
or event population, so removing any of them would silently delete real observability data for a
genuinely distinct signal. Serializing the shared blob's critical section is the only fix that
preserves all of them. Reused `tryAdvisoryLock`/`releaseAdvisoryLock` (a Postgres session-scoped
advisory lock already proven correct and tested for this exact "read whole blob → mutate → write
whole blob back, raced by multiple concurrent writers" shape in `x-rate-budget.ts`/
`x-marketing-meta.ts`) rather than inventing a new primitive, keeping the fix small and
consistent with the rest of the codebase. Left `exit-engine.ts`, `iron-condor.ts`, and the Vector
files untouched — audited clean in the same pass, no equivalent unguarded read-modify-write found
there.

### Tests

`src/lib/zerodte/rejections.test.ts` (+1 new concurrency regression case, 19 total pre-existing +
new combined across both files) and `src/lib/zerodte/discovery-events-persist.test.ts` (+2 new
concurrency regression cases). Full `npm test` and `npx tsc --noEmit` both clean on Node 20.
