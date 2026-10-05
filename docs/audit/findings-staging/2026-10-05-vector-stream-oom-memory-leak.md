# Vector stream SSE memory leak → OOM crash — URGENT

> **kind:** `FINDING`

**Date:** 2026-10-05  
**Status** | Critical — production memory leak with confirmed OOM crash  
**Severity** | P0 — Active memory growth, task replacement cycle

## Problem

Measured live (CloudWatch AWS/ECS MemoryUtilization, 2026-10-05 12:41–15:39 UTC):
- blackout-production-web service memory: 20.6% → 45.1% avg, 42.1% → 73.3% max (3 hours, RTH open)
- **One task OOM-crashed at 15:39:36 UTC:** "FATAL ERROR: Reached heap limit Allocation failed - JavaScript heap out of memory"
- Error immediately preceded by: `TypeError: controller[kState].transformAlgorithm is not a function` in `vector/stream` SSE route
- ECS auto-replaced the task within 1 minute (desired=8/running=8 restored 15:40:42 UTC)
- **Memory still climbing as of 15:51 UTC** — issue is unresolved

Concurrent pattern: "tick failed unexpectedly: a:" errors repeated throughout RTH in the same route's log stream (same line from compiled route.js), suggesting repeated failures in the SSE tick loop.

## Root Cause (Suspected)

Vector stream route (`src/app/api/market/vector/stream/route.ts`) has a resource-leak pattern in the ReadableStream lifecycle:

**Issue 1: Abort listener never removed (line 131)**
```javascript
req.signal.addEventListener("abort", cleanup);
```
- Listener is attached when stream starts
- **Never explicitly removed** — accumulates per connection
- Each listener holds closures referencing the `controller` and intervals
- Closed connections' listeners persist, keeping controller references alive

**Issue 2: Race condition between async tick and cleanup (lines 74-125)**
- `sendTick()` is async, invoked via `void send()` from intervals
- If cleanup clears intervals while `sendTick()` is awaiting something, the controller might be used after `close()`
- Error `controller[kState].transformAlgorithm is not a function` suggests controller used in invalid state

**Issue 3: Interval cleanup may not fire for all error paths**
- Multiple try/catch blocks catch enqueue errors and call cleanup (lines 80, 94, 118)
- But if the error happens during the interval callback setup, or in a higher-order async context, cleanup might not fire
- Intervals then continue running with closed/invalid controller

## Evidence

- Memory growth is **linear over 3 hours**, not random spikes → systematic leak, not GC churn
- OOM crash specifically in SSE route context (confirmed via log stream)
- Repeated "tick failed" errors in same route suggest interval callbacks continuing despite errors
- ECS task replacement cycle suggests the problem is cumulative and recurring

## Impact

- **Live:** Active memory leak during RTH peak hours
- **Blast radius:** Single-point failure — entire ECS task OOM'd, but service recovered quickly via auto-replacement
- **Pattern:** Will recur every RTH open with enough concurrent connections (~2000 max streams per route)

## Fix (Proposed)

**Option A: Remove abort listener on cleanup (minimum change)**
```javascript
req.signal.removeEventListener("abort", cleanup);
```
- Add inside `cleanup()` function to complement the abort listener registration
- Prevents listener accumulation
- **Risk:** Low — removing an already-fired listener is safe

**Option B: Use AbortController to manage stream lifecycle (preferred)**
- Create an AbortController per stream
- Pass to intervals/closures instead of manual `closed` flag
- Automatically unsubscribe on cleanup
- More robust for complex async hierarchies

**Option C: Stricter cleanup guards**
- Add counter to prevent cleanup from running if already running
- Move all interval clearing before any controller operations
- Add assertions to verify controller state before use

## Validation

Post-fix monitoring:
1. **ECS memory utilization:** Should stabilize ~20-30% during RTH (not climb to 45%+)
2. **Task stability:** Zero OOM crashes during next 10 RTH sessions
3. **Error rate:** "tick failed unexpectedly" rate should drop to near-zero (only network/entitlement failures)
4. **Concurrent connections:** Sustain max 2000 streams without memory degradation

## Files to Check

- `src/app/api/market/vector/stream/route.ts` (FIXED IN THIS PR)
- `src/app/api/market/zerodte/marks/stream/route.ts` (SAME PATTERN — apply same fix)
- `src/app/api/market/flows/stream/route.ts` (SAME PATTERN — apply same fix)

All three SSE routes have identical lifecycle structure and are likely all leaking.

## Files Changed

- None yet (this finding documents the issue; fix PR will follow)
