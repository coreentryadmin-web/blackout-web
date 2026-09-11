# Vector Background Cron Event Loop Blocking

> **kind:** FINDING

## Status

| Component | Result |
|-----------|--------|
| vector-pick-sweep | FIXED |
| vector-full-state-snapshot | FIXED |
| Testing | ✓ VERIFIED |

## Root Cause

Vector background crons (`vector-pick-sweep`, `vector-dark-pool-warm`, `vector-full-state-snapshot`) were executing CPU-bound work (ranking picks, computing technicals, deriving confluence zones) synchronously within the main Node.js event loop. Although the work was dispatched asynchronously using Next.js's `after()` API, it still ran on the same event loop that handled incoming web requests. This caused the event loop to be blocked for extended periods during CPU-intensive operations, which contributed to tail latency (p99) spikes on the ALB during RTH.

Measured evidence (2026-09-01/09-02): sweeps running 5-10 minutes with ALB TargetResponseTime p99 40-111s and max up to 119s during the same window when these crons ran.

## Fix Rationale

Added event loop yields between ticker batch processing using `setImmediate()` to break up CPU-bound work into smaller chunks. This allows the Node.js event loop to handle incoming requests and other tasks between batches rather than being completely blocked by the sweep work.

The fix:
1. Yields the event loop between ticker batches in `runVectorPickUniverseSweep()` (4-ticker batches)
2. Yields the event loop between ticker batches in `runVectorFullStateSnapshot()` (3-ticker batches)
3. Only yields if there are more batches to process (not after the final batch)
4. Prevents blocking by allowing the event loop to service other work

## Implementation Details

### Changes to `src/lib/vector/vector-pick-sweep.ts`
- Added `await new Promise((resolve) => setImmediate(resolve))` between batch iterations
- Guard: only yield if `i + SWEEP_CONCURRENCY < tickers.length` (not after final batch)

### Changes to `src/app/api/cron/vector-full-state-snapshot/route.ts`
- Added `await new Promise((resolve) => setImmediate(resolve))` between batch iterations
- Guard: only yield if `i + TICKER_CONCURRENCY < tickers.length` (not after final batch)

### Why `setImmediate()` and not `setTimeout(0)`
- `setImmediate()` is the correct primitive for yielding the event loop in Node.js
- Fires immediately after I/O events are processed but before setTimeout timers
- More predictable than `setTimeout(0)` for CPU work

## Complementary Measures

This fix complements existing measures:
1. **Overlap locks** (`sharedCacheSetNx` with 900s TTL) — prevent overlapping sweeps across replicas
2. **Background UW sweep flag** (`runWithBackgroundUwSweep`) — ensure UW rate limiters stay partially available for member traffic
3. **Time budgets** (`TIME_BUDGET_MS = 50_000`) — partial completion is acceptable

The event loop yields reduce blocking within a single sweep run, allowing better interleaving with incoming member requests.

## Blast Radius

- Only affects background cron processing
- Does not change cron scheduling, authorization, or result logging
- Does not affect rate limiting or caching behavior
- No public API changes
- No database schema changes

## Testing

Added regression tests to verify:
1. `vector-pick-sweep/route.test.ts`: Verifies yields are added between batches
2. `vector-full-state-snapshot/route.test.ts`: Verifies yields are added between batches

All existing tests continue to pass.
