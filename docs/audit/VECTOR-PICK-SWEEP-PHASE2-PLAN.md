# Vector-Pick-Sweep Phase 2 Plan: Schedule Stagger

**Status:** Planning (Phase 1 deployed 2026-10-06, validation in progress)

**Scope:** Schedule three overlapping background crons to reduce simultaneous UW rate-limiter demand during market open.

---

## Background

Phase 1 (deployed 2026-10-06) reduced concurrent UW calls per cron via `MAX_CONCURRENCY=2` in `vector-pick-sweep`'s `runUwPool()` call. However, the root cause is deeper: three crons with independent, non-coordinated schedules converge during market open, creating peak 164 concurrent UW calls against a `GLOBAL_MAX_RPS=4` rate-limiter budget.

**Phase 2 solves the schedule overlap** by staggering the three crons across the 10-minute window, so they never run simultaneously.

---

## Current Schedules (2026-10-05 Baseline)

| Cron | Schedule | Duration | Peak UW Calls | Notes |
|------|----------|----------|---------------|-------|
| `vector-full-state-snapshot` | Every 5 min (11-21 UTC) | ~55-90s | ~80 | Largest fan-out; warmer for Vector cache |
| `uw-cache-refresh` | Every 2 min (RTH only) | ~20-40s | ~10 | UW pre-warm for plan cap headroom |
| `vector-dark-pool-warm` | Every 10 min (RTH only) | variable | ~10 | Dark-pool pre-fetch for SSE path |
| `vector-pick-sweep` | Every 2 min @ :01-:59/2 (11-21 UTC) | 62-793s pre-fix, target <180s post-fix | ~64 (then ~43 post-fix) | Server-side sweep; **benefits from reduced budget contention** |

**Problem:** All three run within each 5-minute window, creating:
- :00 min: all three converge (80+10+10+64 = 164 concurrent calls)
- :01-:04 min: snapshot still running + pick-sweep + cache-refresh overlap
- Sustained queue depth = 164 calls ÷ 0.067 calls/ms = ~2450ms at baseline, 10-20s observed

---

## Proposed Phase 2 Schedules

Stagger the three crons across the 10-minute window to avoid overlap:

| Cron | Current | Phase 2 | Offset from :00 | Details |
|------|---------|---------|-----------------|---------|
| `vector-full-state-snapshot` | `:00, :05, :10, ...` (5-min schedule) | Keep as-is | :00 | Baseline; largest job, benefits others from being first |
| `uw-cache-refresh` | Every 2 min (11-21 UTC) | `:01, :03, :05, :07, :09, ...` (offset +1 min) | +1 | Shift all fires by +1 minute → never overlaps with :00 snapshot |
| `vector-dark-pool-warm` | `:00, :10, :20, ...` (10-min schedule) | `:02, :12, :22, ...` (offset +2 min) | +2 | Shift by +2 minutes → runs after both snapshot and cache-refresh clear |

**Result after stagger:**
- :00 → snapshot alone (80 calls over ~90s)
- :01 → cache-refresh starts (adds 10 calls, snapshot still running)
- :02 → dark-pool-warm starts (adds 10 calls, snapshot/cache clearing)
- :03 → cache-refresh fires again (snapshot done, cache alone)
- :04 → pick-sweep fires (cache clearing, dark-pool running — competition down from 164 to ~50 concurrent calls)

**Peak concurrent reduction:** 164 → ~100 at :01-:02 (a 39% reduction), vs the alternative of bumping global RPS (which affects all lanes and requires provider coordination).

---

## Implementation

### Files to Change

1. **`src/lib/cron-registry.ts`**
   - Already contains `schedule_cron_utc` for `vector-pick-sweep`: `"1-59/2 11-21 * * 1-5"` ✓
   - `uw-cache-refresh` and `vector-dark-pool-warm` schedules NOT explicitly defined here; check deployment infra

2. **`blackout-infra` (deployment configuration)**
   - EventBridge rules for the three crons defined in terraform
   - Look for `aws_cloudwatch_event_rule` resources matching `blackout-production-uw-cache-refresh`, `blackout-production-vector-dark-pool-warm`, `blackout-production-vector-full-state-snapshot`

### Changes Required

**Option A: Define schedules in `cron-registry.ts`** (preferred — keeps all cron metadata in one place)
```typescript
{
  key: "uw-cache-refresh",
  name: "UW Cache Refresh",
  kind: "http",
  path: "/api/cron/uw-cache-refresh",
  schedule_label: "Every 2 min (offset +1), market hours",
  schedule_cron_utc: "1-59/2 11-21 * * 1-5",  // ← Add this
  // ... rest of entry
},
{
  key: "vector-dark-pool-warm",
  name: "Vector Dark Pool Warm",
  kind: "http",
  path: "/api/cron/vector-dark-pool-warm",
  schedule_label: "Every 10 min (offset +2), market hours",
  schedule_cron_utc: "2-59/10 11-21 * * 1-5",  // ← Add this (means :02, :12, :22, etc.)
  // ... rest of entry
},
```

**Option B: Update deployment infra** (if schedules are only in terraform)
- Modify EventBridge rule expressions in `blackout-infra/terraform/modules/crons/main.tf` or similar
- Apply with `terraform plan` first to validate no side effects

### Steps to Implement

1. **Determine current schedule sources**
   - Check `blackout-infra` for where `uw-cache-refresh` and `vector-dark-pool-warm` schedules are defined
   - Confirm whether they are already in `cron-registry.ts` (grep for `schedule_cron_utc`)

2. **Update cron schedules**
   - Add `schedule_cron_utc` to `uw-cache-refresh`: `"1-59/2 11-21 * * 1-5"` → no change needed, already every 2 min
   - BUT: shift the odd minutes to :01, :03, :05, :07, :09 → cron expression doesn't support "every other odd minute" directly
   - **Actual expression:** needs clarification on whether EventBridge supports minute-level jitter or if a custom lambda is needed

3. **Cross-lane coordination required**
   - `uw-cache-refresh` is a **shared** cron (used by 0DTE, Helix, Thermal, other lanes)
   - Changing its schedule impacts all consumers
   - **Coordinate with:** 0DTE lane, Helix lane, Thermal lane before deploying

4. **Testing strategy**
   - **Pre-deploy validation:**
     - Measure rate-limiter queue depth at current schedules (baseline: 10-20s waits)
     - Deploy Phase 2 → re-measure queue depth (target: <5s waits, ~50% reduction in peak)
   - **Post-deploy validation:**
     - Monitor `vector-pick-sweep` elapsed time (should stay <180s consistently vs pre-Phase-1 793s peak)
     - Monitor `vector-dark-pool-warm` success rate (should stabilize vs pre-Phase-1 1.8% → 0% → 60% variance)
     - Check ALB `TargetResponseTime` p99 (should drop from 25-50s spikes observed 2026-09-21)

5. **Deployment rollback plan**
   - If Phase 2 causes unexpected degradation, revert cron schedules to current
   - Phase 1 remains deployed; system degrades gracefully to Phase 1-only behavior

---

## Cron Expression Syntax Notes

EventBridge EventBridge classic Rules use **cron-like syntax**, but with limitations:

- `*/2 11-21 * * 1-5` = every 2 minutes, between 11:00 and 21:59 UTC, Mon-Fri
- `:01, :03, :05, :07, :09` offset cannot be expressed as a single cron expression directly
- **Workaround options:**
  1. Use a **custom Lambda** to dispatch the delayed invocation (adds latency/complexity)
  2. **EventBridge Scheduler** (not Rules) supports `RATE` and timezone-aware schedules
  3. **Accept the asymmetry:** keep all crons on 2-min cadence but shift START times by running them inside a wrapper cron that applies the offset

**Recommended:** Evaluate whether moving to EventBridge Scheduler would simplify this, or stick with Rules and use a wrapper approach.

---

## Success Criteria

After Phase 2 deployment during an RTH window:

- [ ] `vector-pick-sweep` elapsed time consistently <180s (vs 793s pre-Phase-1 baseline)
- [ ] UW rate-limiter queue waits <5s p95 (vs 10-20s pre-Phase-1)
- [ ] `vector-dark-pool-warm` success rate stable (vs 1.8% → 0% → 60% pre-Phase-1)
- [ ] ALB `TargetResponseTime` p99 stays <5s during the staggered cron window (vs 25-50s observed 2026-09-21)
- [ ] No cross-lane regressions reported by 0DTE, Helix, Thermal on cache-refresh availability

---

## Blocked / Open Questions

1. **Cron expression for minute-level offset:** EventBridge syntax limitations
   - Confirm whether EventBridge supports per-second or per-minute offsets natively
   - If not, design the wrapper/Lambda approach

2. **Cross-lane impact:** `uw-cache-refresh` is shared
   - Confirm with 0DTE lane that a schedule shift does not degrade their own RTH cadence
   - Check Helix and Thermal similarly

3. **Schedule stagger vs. other improvements:**
   - Measure Phase 1 improvement first before committing to Phase 2
   - If Phase 1 alone reduces peak contention to acceptable levels, Phase 2 may be optional

---

## Validation Script

See `scripts/audit/vector-pick-sweep-phase1-validation.mjs` for the Phase 1 validation harness. Phase 2 validation will use the same metrics:

- CloudWatch `elapsed=` grep for vector-pick-sweep, vector-dark-pool-warm, vector-full-state-snapshot
- UW rate-limiter queue wait patterns
- ALB TargetResponseTime p99 tail latency

---

## References

- **Investigation**: `docs/audit/findings-staging/2026-10-05-vector-pick-sweep-investigation-resolution.md`
- **Phase 1 PR**: #5592 (merged 2026-10-06)
- **Validation script**: `scripts/audit/vector-pick-sweep-phase1-validation.mjs`
- **Standing mandate**: CLAUDE.md "STANDING PERFORMANCE/LATENCY AUDIT MANDATE" + "ASK LARGO × NIGHT HAWK SWINGS"
