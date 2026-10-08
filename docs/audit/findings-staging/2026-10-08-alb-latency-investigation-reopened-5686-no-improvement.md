## 2026-10-08 — [FINDING, performance/investigation-status, ECS web tier] ALB tail-latency investigation incorrectly read as "done" after PR #5686 — live re-measurement shows NO improvement — investigation REOPENED (not a new code defect)

> **kind:** `FINDING`

| Field | Value |
| --- | --- |
| **Status** | REOPENED — correction to investigation status, not a code fix. No source change in this entry; see "What this is / is not" below. |
| **Severity** | P1 (the underlying recurring ALB `TargetResponseTime` p99/Max tail-latency symptom is still live and unexplained — this entry corrects the record so no future session treats it as resolved) |
| **Component** | Investigation-tracking only: `docs/audit/MARKET-OPEN-VALIDATION.md`, `docs/audit/RUN-LOG.md`. No `src/` change. |
| **PR** | fix/alb-latency-investigation-reopen-5686-no-improvement (docs-only) |

### What this is / is not

This is **not** a new code bug and ships **no source change**. It corrects the investigation's own
working record: PR #5686 (`fix(perf): heatmap-warm's bulk ticker fetch used an unbounded fan-out,
starving the task it ran on`) is a real, correctly-diagnosed, correctly-fixed bug — and it is
**confirmed, by live post-deploy re-measurement this cycle, to NOT be the dominant cause of the
CURRENT sustained ALB `TargetResponseTime` p99/Max spike pattern**. Per the standing issue-handling
policy's instruction for a staged entry with a real outcome and no code change, this is logged as a
`FINDING` describing a reopened investigation state, not a `NEGATIVE-RESULT` about #5686 in
isolation — the underlying P1 symptom (recurring 40-100s ALB tail latency on
`blackout-production-app`) is unambiguously still open and unexplained, which is the actionable
fact a future session needs, not merely "one hypothesis was ruled out."

### Evidence — independently re-derived this cycle, not re-quoted from chat

**Deployment confirmed live.** `ecs.describe_services` on `blackout-production-web` showed the
#5686 image (`...blackout-web:bb61d961b7674da07cc73c111ac34f5c8154ac9a` — exactly PR #5686's merge
commit) as task-definition revision 1865, with the service's own event log recording
`deployment completed` / `has reached a steady state` at **12:54:07 UTC, 2026-10-08**.

**Post-deploy `AWS/ApplicationELB TargetResponseTime` (1-min granularity,
`blackout-production-app`), independently re-pulled for the window immediately after steady
state:**

| minute (UTC) | p50 | p99 | Max |
| --- | --- | --- | --- |
| 12:54 | 0.018 | 68.89 | 69.52 |
| 12:55 | 0.042 | 7.87 | 8.01 |
| 12:56 | 0.024 | 68.58 | 68.90 |
| 12:57 | 0.228 | 48.35 | 48.55 |
| 12:58 | 0.047 | 34.41 | 34.44 |
| 13:00 | 0.019 | 60.68 | 61.33 |
| 13:01 | 0.276 | 32.46 | 32.65 |
| 13:02 | 0.017 | 49.14 | 49.49 |

p50 stays under 0.3s throughout (tail-latency signature, not fleet capacity) — **statistically
indistinguishable from the pre-deploy baseline** measured the same morning before #5686's rollout
even started (e.g. 11:05 p99=80.28s/Max=80.40s, 11:45 p99=97.97s/Max=100.21s). A companion
live measurement the same cycle (a sibling run) independently found the same non-improvement across
a 12:22-12:57 UTC window (p99/Max 57-91s throughout), corroborating rather than duplicating this
pull. `HTTPCode_Target_5XX_Count` summed to **0** across the full trailing 3-hour pull, before and
after the deploy — this has never been an outage, purely tail latency.

### Why this needed correcting

A prior cycle's framing treated the #5686 deploy as the capstone of the ALB-latency investigation
arc (it was the fix that finally traced the TRIGGER #5680 found down to a concrete, fixable
mechanism, with a detailed before/after validation plan already logged in
`docs/audit/MARKET-OPEN-VALIDATION.md`). That framing is not supported by the live data: the fix is
real and deployed, but the symptom it was validated against persists at the same magnitude. Per this
repo's own standing discipline (CLAUDE.md's "a merge is not a verification" / "verify against `main`,
never trust a list at face value"), this correction exists specifically so a future session reading
only the prior entry's hopeful validation-plan language does not skip the re-measurement step and
wrongly report this investigation as closed.

### Read-only correlation analysis (Part 2, no AWS write attempted) — result: WEAK/MIXED, not confirmed

Tested whether the independently-raised, still-open cron-schedule-collision hypothesis (#5692:
`desk-warm`/`meridian-warm`/`zerodte-warm` all on `cron(*/5 11-21 ? * MON-FRI *)`,
`swing-active-refresh` on `cron(*/15 ...)`, `market_hours_only`) correlates with the CURRENT spike
pattern, using only CloudWatch Logs/Metrics reads (no `events.put_rule` write attempted — confirmed
blocked twice already by this sandbox's permission classifier, not re-attempted here).

Over a 4h10m window (09:00-13:09 UTC) matching 251 one-minute ALB buckets:

- **Only a 2-way test was possible, not the full 4-way.** `swing-active-refresh` had not fired at
  all (it's gated to cash RTH, which opens 13:30 UTC, after this window). `desk-warm`'s own
  EventBridge-triggered heavy pass (`[cron/desk-warm] background done ... elapsed=Nms`) logged
  **zero** completions in the full window despite `AWS/Events Invocations` confirming EventBridge
  fired its Lambda target 26 times with 0 failures — every `desk-warm` log line was instead the
  leader's cheap `backup warm 'desk-warm' ok (Nms)` check (138 of them, all <200ms). This is an
  unconfirmed anomaly in `desk-warm`'s own overlap/staleness semantics, disclosed here as a lead for
  a future cycle, not root-caused in this pass.
- With only `meridian-warm` (25 runs, 19.8-79.2s each) and `zerodte-warm` (46 runs, mostly
  0.6-3s) producing measurable overlap: mean concurrently-active-cron-count was **0.52** on spike
  minutes (p99>=20s, n=81) vs **0.30** on non-spike minutes (n=169) — a real but modest ~1.7x
  enrichment, never exceeding a 2-way overlap in this window.
- Of the 7/251 minutes with both crons active together: 4/7 coincided with a real spike, 3/7 did
  not — small-n, mixed.
- Broken out individually: `meridian-warm` active in 35.8% of spike minutes vs 8.9% of non-spike
  minutes (~4x enrichment, but this reconfirms the SAME meridian-warm correlation this file's own
  2026-10-07 entries already found, not new information). `zerodte-warm` showed no positive
  correlation (16.0% vs 21.4%, if anything inverted).
- 53% of all spike minutes (43/81) had ZERO overlapping elapsed-time from any of these four crons —
  evidence AGAINST the identical-minute collision being the dominant mechanism, though it does not
  rule out a smaller contributing role once a cleaner 4-way sample (post-cash-open, with
  `desk-warm`'s real heavy pass actually observed) can be pulled.

**Verdict: WEAK/MIXED — reported honestly, not rounded up to confirmation.** #5692 remains the
leading unconfirmed alternative/compounding hypothesis; this pass neither confirms nor rules it out,
and its own fix (EventBridge minute-stagger) stays blocked on the same AWS permission boundary.

### Standing operator-actionable blockers (unchanged, named again so a future session doesn't
re-discover them from scratch)

1. **#5692's EventBridge minute-stagger fix** — fully designed, blocked twice (a month apart, two
   independent sessions) by this sandbox's "Modify Shared Resources" permission classifier. Needs
   operator action, not more investigation.
2. **ALB access logging** — identified since 2026-09-02 as the single highest-leverage next step
   (real per-request path/latency/status attribution instead of minute-level metric-correlation
   inference). Also blocked on an AWS permission boundary in this sandbox. Not attempted this cycle
   per explicit instruction.

### Blast radius

None on application behavior — this entry changes no source file. Blast radius is entirely on
investigation-tracking accuracy: `docs/audit/MARKET-OPEN-VALIDATION.md` now carries the corrected,
reopened status ahead of the #5686 entry it corrects, and this file gives the full evidence trail
for whoever folds it into `FINDINGS.md`.
