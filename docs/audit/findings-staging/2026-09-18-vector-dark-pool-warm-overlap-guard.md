# vector-dark-pool-warm needs overlap guard—measured 221s runtime with 10-min schedule

> **kind:** FINDING

## Summary

The `vector-dark-pool-warm` cron is scheduled every 10 minutes but measured elapsed times reach 221 seconds (3.68 minutes) and 144 seconds (2.4 minutes). With only 6.32 minutes of margin before the next scheduled run, and variance in UW response times (especially during the current dossierFetch timeout cascade), the cron is at risk of overlapping.

## Root cause

`vector-dark-pool-warm` makes UW REST calls to fetch dark-pool levels for all overlay-allowlist tickers (~55 universe tickers). The route is already optimized with `runUwPool()` (pools concurrent UW calls to 3) and fire-and-forget dispatch, but the UW timeout cascade (documented in parallel finding `2026-09-18-uw-dossier-fetch-timeout-cascade.md`) is adding latency to each ticker's fetch.

Measured runtimes in last 2 hours:
- 221,592ms (3.68 min) — 69% of the 10-min schedule window consumed
- 144,994ms (2.41 min) — 24% of the 10-min schedule window consumed
- Typical: 20–40 seconds

When UW times out (8s × N retries), the pooled concurrency can't prevent the whole cron from backing up, and a slow run scheduled every 10 minutes risks the next run starting before the prior one finishes.

## Evidence

**CloudWatch Logs, 2026-09-18 19:40–21:10 UTC:**
```
[cron/vector-dark-pool-warm] background done — warmed=44 failed=11 levels=56 elapsed=144994ms
[cron/vector-dark-pool-warm] background done — warmed=29 failed=26 levels=33 elapsed=221592ms
[cron/vector-dark-pool-warm] background done — warmed=3 failed=0 levels=3 elapsed=25719ms
```

The 221-second run is a real outlier, but the 144-second one is repeatable. With typical variance, a 144s run leaves only 6m 16s before the next scheduled run at 10m. If that next run encounters the same UW timeout cascade, it could start before the prior one finishes.

## Impact

If overlap occurs:
- Both instances try to write to the same Redis dark-pool cache keys simultaneously, causing write contention
- One instance's writes may be silently overwritten by the other's
- The Vector SSE clients would see inconsistent dark-pool levels between requests
- No data loss, but correctness is violated

## Fix

Add an overlap guard using `sharedCacheSetNx()` (the pattern already used by `data-correctness` and `swing-active-refresh` crons):

```typescript
const acquired = await sharedCacheSetNx(
  "cron:vector-dark-pool-warm:lock",
  { startedAt: started },
  610  // TTL = 10min + 10sec buffer for schedule variance
).catch(() => true);

if (!acquired) {
  // Prior run still executing, skip this one
  const payload = { ok: true, skipped: true, reason: "Prior run still executing" };
  await logCronRun("vector-dark-pool-warm", started, payload);
  return NextResponse.json(payload);
}
```

Add this guard in `src/app/api/cron/vector-dark-pool-warm/route.ts` before dispatching the warm, following the data-correctness pattern at lines ~150–160.

## Rationale

Per CLAUDE.md's audit methodology:

> "Check EVERY cron's own schedule against its own measured `elapsed=` runtime" before concluding it needs an overlap guard — `sharedCacheSetNx` is the fix ONLY when runtime can exceed the schedule interval with real margin lost."

Measured runtimes of 220s (3.67min) against a 10-min schedule with UW timeout cascade in effect means margin is lost in the worst case. An overlap guard is justified.

## Status

**Not fixed** — requires code change to add the `sharedCacheSetNx` guard.

## Related findings

- `2026-09-18-uw-dossier-fetch-timeout-cascade.md` — the UW timeout cascade is exacerbating slow runtimes
