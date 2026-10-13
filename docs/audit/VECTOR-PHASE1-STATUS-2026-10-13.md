# Vector-Pick-Sweep Phase 1: Status Update — 2026-10-13

**Summary:** Phase 1 implementation (MAX_CONCURRENCY=2 in runUwPool) deployed successfully on 2026-10-06 (PR #5592). Phase 2 planning complete. Awaiting live RTH validation data.

---

## Completed ✅

### Phase 1 Implementation
- **PR #5592**: Merged 2026-10-06T02:57:36Z (3 commits, 172 additions, 33 deletions)
- **File changed**: `src/lib/vector/vector-pick-sweep.ts` 
  - Added `const UW_POOL_MAX_CONCURRENCY = 2;`
  - Applied to `runUwPool(tickers.map(...), UW_POOL_MAX_CONCURRENCY)`
  - Added detailed 13-line comment explaining market-open contention context
- **Deployed to production**: 2026-10-06 (ECS auto-deploy on merge)
- **Current status**: Running in production since 2026-10-06 (7 days of live data accumulated)

### Investigation Documentation
- **Baseline findings** (2026-10-05 RTH): 
  - `vector-pick-sweep` runtime: 62-793s per invocation (vs 120s schedule)
  - UW queue waits: 10-20s per call (4,655 log lines in 30 min)
  - `vector-dark-pool-warm` success rate: 1.8% → 0% → 60% (high variance)
  - Root cause: 164 concurrent UW calls (80+10+10+64) against GLOBAL_MAX_RPS=4

- **Investigation document**: `docs/audit/findings-staging/2026-10-05-vector-pick-sweep-investigation-resolution.md` (updated to reflect Phase 1 deployment status)

### Phase 2 Planning
- **Detailed plan**: `docs/audit/VECTOR-PICK-SWEEP-PHASE2-PLAN.md`
- **Scope**: Stagger three overlapping crons (vector-full-state-snapshot, uw-cache-refresh, vector-dark-pool-warm) to reduce peak concurrent UW calls from 164 → ~100
- **Proposed schedules**: 
  - snapshot: :00 (baseline)
  - cache-refresh: +1 min offset (:01, :03, :05, ...)
  - dark-pool-warm: +2 min offset (:02, :12, :22, ...)
- **Blocked**: EventBridge cron syntax doesn't natively support minute-level offsets; cross-lane coordination needed (0DTE, Helix, Thermal on cache-refresh schedule impact)

### Validation Infrastructure
- **Validation script**: `scripts/audit/vector-pick-sweep-phase1-validation.mjs`
  - Parses CloudWatch logs for `elapsed=`, queue wait, success rate patterns
  - Compares against Phase 1 targets
  - Automated metrics extraction (p50/p95/max, success rates, trends)
  - Ready to run once logs are fetched from AWS

---

## Pending ⏳

### Phase 1 Validation (CRITICAL PATH)
**What:** Measure whether Phase 1 fix improved runtime/queue waits during live RTH

**Metrics to validate:**
1. **vector-pick-sweep elapsed time**
   - Baseline (pre-Phase 1): 62-793s per invocation
   - Target (post-Phase 1): <180s consistently
   - Method: CloudWatch `/ecs/blackout-production` grep `elapsed=`

2. **UW rate-limiter queue waits**
   - Baseline: 10-20s per call
   - Target: <5s p95
   - Method: CloudWatch grep `queue wait.*ms`

3. **vector-dark-pool-warm success rate**
   - Baseline: 1.8% → 0% → 60% (high variance)
   - Target: Stable 50%+ (low variance)
   - Method: CloudWatch grep `success.*\d+\/\d+`

4. **ALB TargetResponseTime tail latency**
   - Baseline (2026-09-21): p99 spiked to 25-50s during cron windows
   - Target: Stay <5s p99
   - Method: AWS CloudWatch `AWS/ApplicationELB` metric

**Window:** RTH sessions from 2026-10-06 onward (7 available days as of 2026-10-13)

**Blocker:** AWS CLI not available in sandbox; requires manual CloudWatch log export + validation script run

**Expected timeline:** Can validate within 1 coordinator cycle if logs are accessible

### Phase 2 Execution (AFTER Phase 1 validation)
**Blockers to resolve:**
1. EventBridge schedule syntax — confirm minute-offset capability or design wrapper approach
2. Cross-lane coordination — confirm 0DTE/Helix/Thermal can absorb cache-refresh schedule shift
3. Phase 1 validation success — confirm runtime/latency improvements justify proceeding

**Timeline:** 1-2 cycles after Phase 1 validation (pending blocker resolution)

---

## Coordination Required

### From Vector Lane (internal)
- [ ] Confirm Phase 1 metrics show expected improvement during next RTH
- [ ] Resolve EventBridge cron syntax constraints (investigate Scheduler vs Rules)

### From Cross-Lane (0DTE, Helix, Thermal)
- [ ] Confirm `uw-cache-refresh` schedule shift (offset +1 min) does not degrade other lane's RTH performance
- [ ] Confirm no hidden dependencies on cache-refresh schedule (e.g., Helix's own discovery cadence)

### From Infrastructure / DevOps
- [ ] If EventBridge Rules cannot support offset natively, design/implement wrapper Lambda for delayed invocation

---

## Validation Command (for next RTH)

```bash
# From local machine with AWS credentials:
aws logs filter-log-events \
  --log-group-name /ecs/blackout-production \
  --start-time $(($(date +%s) - 7*86400))000 \
  --end-time $(date +%s)000 \
  --filter-pattern "[timestamp, ..., message]" \
  --query 'events[?contains(message, `elapsed=`) || contains(message, `queue wait`) || contains(message, `success`)].[timestamp,message]' \
  --region us-east-1 \
  --output json > vector-pick-sweep-phase1-logs.json

# Then validate:
cat vector-pick-sweep-phase1-logs.json | node scripts/audit/vector-pick-sweep-phase1-validation.mjs --json
```

---

## Risk Assessment

**Low risk:**
- Phase 1 is a localized change to a single cron's own concurrency cap
- No shared state modified; no cross-cron impact
- Graceful degradation: if throttling underperforms, can revert with single line change

**Monitoring:**
- Set CloudWatch alarm for `vector-pick-sweep` elapsed time >300s (indicates fix not effective)
- Monitor `vector-dark-pool-warm` for success rate <50% (indicates still rate-limited)
- Watch ALB p99 response time during cron windows

---

## Next Steps

1. **Immediate** (this cycle):
   - ✅ Document Phase 1 status (this memo)
   - ✅ Provide Phase 2 planning
   - ✅ Create validation infrastructure
   - Continue standing mandates (performance/latency/correctness sweeps) while Phase 1 validation data accumulates

2. **Next RTH window**:
   - Export CloudWatch logs (7 days of production data)
   - Run validation script
   - Report metrics to coordinator
   - Decide: proceed with Phase 2 or investigate further degradation

3. **Phase 2** (if Phase 1 validation succeeds):
   - Resolve EventBridge syntax constraints
   - Coordinate cross-lane schedule changes
   - Deploy and validate Phase 2

---

## References

- **Phase 1 PR**: #5592 (merged 2026-10-06)
- **Investigation**: `docs/audit/findings-staging/2026-10-05-vector-pick-sweep-investigation-resolution.md`
- **Phase 2 Plan**: `docs/audit/VECTOR-PICK-SWEEP-PHASE2-PLAN.md`
- **Validation script**: `scripts/audit/vector-pick-sweep-phase1-validation.mjs`
- **Standing mandate**: CLAUDE.md "STANDING PERFORMANCE/LATENCY AUDIT MANDATE"
