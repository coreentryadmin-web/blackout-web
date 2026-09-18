# UW dossierFetch timeout cascading to ALB tail-latency spikes

> **kind:** FINDING

## Summary

UW flow-alerts `dossierFetch` API calls are timing out at 8 seconds repeatedly, cascading into ALB response time spikes of 50-87 seconds. This violates the standing performance mandate ("website should not lag, it should be very fast and responsive").

## Root cause

The flow-alerts data provider calls UW's dossierFetch API and blocks on the result. When UW times out at 8 seconds (appears to be a configured/enforced limit), the request is retried, causing cascading delays. Multiple tickers' flow-alert requests queue up behind timeouts, creating a pile-on effect that blocks member requests.

CloudWatch logs show repeated errors:
```
2026-09-18 21:10:21.322: [uw] flow-alerts failed: dossierFetch 8000ms local timeout
2026-09-18 21:10:17.286: [uw] flow-alerts failed: dossierFetch 8000ms local timeout
```

These occur in clusters during market hours, suggesting a systematic upstream issue with the UW dossierFetch endpoint rather than a transient network glitch.

## Evidence

**CloudWatch ALB TargetResponseTime metrics (2026-09-18, 19:40–21:05 UTC):**
- Window aggregate (3-hour span):
  - Avg of averages: **917.8ms** (baseline ~100-200ms)
  - Max of maximums: **87,212.5ms** (87 seconds!)
  - Min of averages: 110.2ms

- Recent measurements showing tail-latency spikes:
  - 19:55 UTC: Max 37.9s
  - 20:05 UTC: Max 67.6s
  - 20:10 UTC: Max 69.4s
  - 20:15 UTC: Max 75.2s
  - 20:20 UTC: Max 71.5s
  - 20:25 UTC: Max 72.2s
  - 20:30 UTC: Max 75.9s

**CloudWatch Logs errors:** 10+ instances of `dossierFetch 8000ms local timeout` in 2-hour window (21:00–21:10 UTC).

## Impact

- Member requests to any route that requires flow-alerts data are blocked for 8+ seconds per timeout
- ALB records these as slow responses (max 87s), violating latency SLA
- The timeout is systematic and repeatable, not a transient fluke

## Affected routes/features

Any route reading flow-alerts: 
- `/api/market/spx/desk` (via `resolveCanonicalDeskGex` → UW flow)
- `/api/market/spx/play`
- Thermal heatmap (flow-driven)
- Vector flow signals
- Night Hawk play discovery

## Next steps

1. **Immediate (this session):** Verify the UW endpoint itself is healthy and not rate-limiting us. If the `dossierFetch` API is returning errors or timing out on its end, escalate to UW ops.

2. **Mitigation (short-term):** Add a timeout budget/fallback in the flow-alerts provider so a single UW timeout doesn't block the entire request. Currently, the 8-second timeout is hard-blocked and retried, creating the cascade. Consider:
   - Shorter initial timeout with fire-and-forget background fallback
   - Fallback to stale cached flow-alerts if UW doesn't respond within 2-3 seconds
   - Reduce queue wait time in `uw-rate-limiter.ts` during timeout storms

3. **Investigation (parallel):** Check UW's rate limit headers and API health dashboard for 2026-09-18 19:40–21:10 UTC window. Are they throttling us, or is their endpoint genuinely slow?

## Status

**Not fixed** — this is a cross-service dependency issue requiring coordination with UW status/API team.

## Contract relevance

This violates the standing "continuously work on latency/performance" mandate from CLAUDE.md: "website should not lag, it should be very fast and responsive."
