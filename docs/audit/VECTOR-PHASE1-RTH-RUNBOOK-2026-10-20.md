# Vector-Pick-Sweep Phase 1 Validation Runbook — 2026-10-20

**Status:** Phase 1 deployed 2026-10-06 (14 days of production data). RTH validation scheduled 2026-10-20 14:30 UTC.

**Objective:** Confirm Phase 1's concurrency guard (MAX_CONCURRENCY=2 on runUwPool) achieved the targeted 793s → <180s improvement in vector-pick-sweep elapsed time.

---

## Phase 1 Summary

**Deployed:** 2026-10-06 (PR #5592)
**Change:** Single line in `src/lib/vector/vector-pick-sweep.ts` — added `MAX_CONCURRENCY=2` to `runUwPool()` call
**Baseline (2026-10-05 RTH):**
- vector-pick-sweep: 62-793s elapsed per invocation (target: 120s schedule)
- UW rate-limiter queue waits: 10-20s per call
- vector-dark-pool-warm success rate: 1.8% → 0% → 60% (volatile)
- Root cause: 164 concurrent UW calls (80+10+10+64) against GLOBAL_MAX_RPS=4 limit

**Target (post-Phase 1):**
- vector-pick-sweep elapsed: <180s consistently
- UW queue waits: <5s p95
- vector-dark-pool-warm: stable 50%+ success rate
- ALB TargetResponseTime p99: <5s (vs 25-50s observed 2026-09-21)

---

## RTH Validation Plan

### Step 1: Prepare (before RTH opens, ~14:30 UTC)
```bash
# Authenticate as temp admin (one-time)
node scripts/audit/lib/clerk-audit-session.mjs --premium
# Output: __session=eyJ...

# Save the JWT for use below
ADMIN_SESSION="__session=eyJ..."
```

### Step 2: Start Monitoring (at RTH open, 14:30 UTC)
Monitor will capture cron health every 30 minutes during RTH window (14:30-20:00 UTC, 11 samples).

```bash
# Run continuously during RTH
node scripts/audit/vector-phase1-rth-monitor.mjs \
  --base=https://blackouttrades.com \
  --cookie="$ADMIN_SESSION" \
  --interval=30 \
  --json > /tmp/phase1-monitor-2026-10-20.jsonl &

# Or for local testing (single probe):
node scripts/audit/vector-phase1-rth-monitor.mjs \
  --base=https://blackouttrades.com \
  --cookie="$ADMIN_SESSION" \
  --interval=0 \
  --json
```

### Step 3: Analyze Results (after RTH close, ~20:00 UTC)
```bash
node scripts/audit/vector-phase1-rth-analyze.mjs \
  --data=/tmp/phase1-monitor-2026-10-20.jsonl
```

Expected output format (if JSON):
```json
{
  "analysis": {
    "total_samples": 11,
    "cron_stats": {
      "vector-pick-sweep": {
        "elapsed_ms": {
          "min": 45000,
          "max": 125000,
          "avg": "87000",
          "p95": 110000
        }
      }
    }
  },
  "verdict": {
    "passed": true,
    "findings": [...]
  }
}
```

---

## Success Criteria

### ✅ Phase 1 PASSED (all criteria met):
1. **vector-pick-sweep elapsed_ms.max < 180,000ms** (vs 793,000 baseline)
2. **vector-dark-pool-warm success_rate avg ≥ 50%** (vs 1.8-60% volatile baseline)
3. **No critical errors** in cron health (last_status not "error")

### ❌ Phase 1 FAILED (any criterion not met):
- Elapsed time still peaks >180s
- Dark-pool success rate unstable or <50% average
- Other cron health degradation observed

---

## Decision Logic

### If Phase 1 PASSED:
- ✅ Confirm Phase 1 is working as intended
- ✅ Document improvement percentage (e.g., 793s → 87s = 89% reduction)
- → **Phase 2 decision:** Is further improvement needed, or is Phase 1 sufficient?
  - **Proceed to Phase 2** if: p99 ALB tail latency still >5s, or queue waits still significant
  - **Hold Phase 2** if: All metrics within target and no member complaints on latency

### If Phase 1 FAILED:
- ❌ Investigate why concurrency guard didn't improve elapsed time
  - Are UW calls still hitting rate limiter despite concurrency cap?
  - Is the bottleneck elsewhere (DB, cache, network)?
- ❌ Check for regressions (did some other change break it post-2026-10-06?)
- → **Next step:** Root-cause analysis before proceeding to Phase 2

---

## Metrics to Log

For post-RTH analysis and decision-making:

| Metric | Expected | Unit | Phase 1 Improvement |
|--------|----------|------|---|
| vector-pick-sweep max elapsed | <180s | ms | 793s → ~100-150s (87-81% reduction) |
| vector-pick-sweep p95 elapsed | <180s | ms | (peak capped) |
| UW queue wait p95 | <5s | ms | 20s → <5s (75% reduction) |
| vector-dark-pool-warm success avg | >50% | % | 1.8-60% → stable 50%+ |
| vector-dark-pool-warm success std | <10pp | pp | volatile → stable |
| vector-full-state-snapshot elapsed | unchanged | ms | baseline (no change expected) |
| ALB TargetResponseTime p99 | <5s | ms | 25-50s → <5s (if cron-driven) |

---

## Known Limitations

1. **Admin health endpoint staleness:** `/api/admin/cron-health` reflects last cron invocation state, not real-time streaming. A 30-minute interval may miss transient spikes.

2. **No CloudWatch logs:** This runbook uses app health endpoint, not CloudWatch logs, so queue-wait details may be less granular than Phase 1 Status doc's original validation plan.

3. **Single RTH session:** One day of data (11 samples) is the minimum viable confirmation. Ideally, collect 3-5 RTH sessions to rule out day-of-week patterns or outliers.

---

## Post-Analysis Actions

1. **Document result** in this runbook (add date + verdict)
2. **Update FINDINGS.md** with Phase 1 validation result
3. **Decide on Phase 2**: proceed or hold
4. **Notify operator** of validation outcome and recommendation

---

## References

- **Phase 1 implementation:** PR #5592 (merged 2026-10-06)
- **Phase 2 plan:** `docs/audit/VECTOR-PICK-SWEEP-PHASE2-PLAN.md`
- **Phase 1 status:** `docs/audit/VECTOR-PHASE1-STATUS-2026-10-13.md`
- **Monitoring scripts:**
  - Monitor: `scripts/audit/vector-phase1-rth-monitor.mjs`
  - Analyze: `scripts/audit/vector-phase1-rth-analyze.mjs`

---

## Validation Results (to be filled in post-RTH)

### 2026-10-20 RTH Session

**Time window:** 14:30-20:00 UTC (RTH open to close)

**Monitoring start:** [timestamp]
**Monitoring end:** [timestamp]
**Samples collected:** [n]

**Verdict:** [ ] PASSED / [ ] FAILED / [ ] INCONCLUSIVE

**Key findings:**

| Metric | Target | Measured | Status |
|--------|--------|----------|--------|
| vector-pick-sweep max | <180s | __s | [ ] PASS [ ] FAIL |
| vector-dark-pool success | >50% | _% | [ ] PASS [ ] FAIL |
| ALB p99 latency | <5s | __s | [ ] PASS [ ] FAIL |

**Improvement from baseline:**
- elapsed time: 793s → __s (__% reduction)
- queue waits: 20s → __s (__% reduction)
- dark-pool success: 1.8-60% → stable __%

**Next action:**
- [ ] Phase 1 validated; proceed to Phase 2 planning
- [ ] Phase 1 validated; hold Phase 2 (acceptable improvement)
- [ ] Phase 1 inconclusive; re-run next RTH
- [ ] Phase 1 failed; investigate root cause

