## 2026-09-06 — [FINDING, infra/performance, P2] Continuous rolling deploys from today's merge velocity are producing repeated production tail-latency spikes — WRITE-UP (not fixed, no code change)

> **kind:** `FINDING`

### Symptom

Per the STANDING PERFORMANCE/LATENCY AUDIT MANDATE, pulled real `AWS/ApplicationELB` `TargetResponseTime`
for `blackout-production-app`'s target group (dimensions: `LoadBalancer=app/blackout-production-alb/…`
+ `TargetGroup=targetgroup/blackout-production-app/8841ca2aeba05d87`) over a 3-hour window
(14:50–17:19 UTC, 2026-09-06). p50 is consistently healthy (0.03–0.05s), but **p99 is consistently
2.3–5.1s and Max spikes to 17–43.6s in nearly every 15-minute bucket** — the textbook "low average,
high p99/Max" tail-latency signature this mandate's own method calls out as a saturating-job /
missing-guard problem, never a uniform-capacity one.

### Root cause

Correlated the spike timestamps against `ecs describe_services` deployment events for
`blackout-production-web`: **19 task-start events in a 75-minute window (16:04–17:19 UTC)** — the
service has been cycling a task roughly every 3–5 minutes, essentially continuously, across an
8-task desired count. This is not an anomalous incident; it is the ordinary effect of today's
extraordinary merge rate on `main` (`ecr-push-production.yml` force-deploys ECS on every merge, and
today's `git log` shows ~25+ merges in the last 3 hours — almost entirely the swing/Largo lane's
Cursor↔Claude peer-review pipeline landing small fixes in rapid succession).

Most large per-minute Max spikes land within 1–2 minutes of a captured task-start or
connection-draining event (e.g., 17:11:00 max=25.96s vs a 17:10:18 task start; 17:17:00 max=21.08s
vs a 17:17:06 "begun draining connections" event; 16:53:00 max=23.02s bracketed by 16:51:51 and
16:55:46 starts). `deregistration_delay.timeout_seconds` is 30 (set 2026-07-22 per this file's own
history, specifically to bound this kind of stale-serving/draining window) — **but at least one
observed Max (16:00:00, 33.09s; and a separate earlier pull, 43.6s) exceeds that 30s bound**,
meaning some in-flight requests are taking longer to resolve during a task swap than the
draining-window design assumes. The most likely candidates are long-lived connections (SSE
streams — this app serves several: Vector's `attachVectorStreamSubscriber`/1Hz poller,
`/spx/pulse/stream`, etc.) that stay open across a deploy rather than completing promptly.

**This is not a code bug** — no single function is wrong — but it is a real, measured, ongoing
production latency cost directly caused by deploy frequency, which is itself a byproduct of the
standing auto-merge policy having no batching/coalescing step between "PR merges" and "ECS
force-deploys."

### Why this is a write-up, not a direct fix

Per the issue-handling policy's own scope limits: this needs either (a) an infra-level change
(e.g., batching deploys, or lengthening graceful-shutdown handling for SSE connections before the
draining window expires) or (b) a product-side change to how long-lived streams behave during
`SIGTERM`/draining — both are cross-cutting, deploy-pipeline-level decisions, not a single-file
fix a DISCOVERY-lane sweep should make unilaterally. `docs/audit/FINDINGS.md`'s own precedent
(the 2026-07-22 `deregistration_delay` change) went through a deliberate, surgical `aws` CLI call
with the tradeoffs reasoned through explicitly — this deserves the same treatment, not a reflexive
value bump from one sweep's evidence.

### Evidence

- `boto3 cloudwatch.get_metric_statistics` (`AWS/ApplicationELB` `TargetResponseTime`,
  `ExtendedStatistics=[p50,p90,p99]`, Period=900s, 14:50–17:19 UTC): p50 0.031–0.048s throughout;
  p99 2.262–5.064s throughout; Max 6.07–43.6s across buckets — every bucket sampled shows the same
  shape, not an isolated incident.
- `boto3 ecs.describe_services(cluster='blackout-production-cluster',
  services=['blackout-production-web'])`: 19 "has started 1 tasks" events in 16:04–17:19 UTC;
  explicit "has begun draining connections" events logged alongside.
- `boto3 elbv2.describe_target_group_attributes`: `deregistration_delay.timeout_seconds = 30`,
  confirming the current bound and that some observed Max values exceed it.
- Finer-grained (Period=60s) pull cross-referenced against the task-start timestamp list — most
  large per-minute spikes land within 1–2 minutes of a captured deploy event.
- `elbv2.describe_load_balancer_attributes`: `access_logs.s3.enabled = false` — per-request
  URI-level attribution (which specific route/pattern is spiking) is **not** available from this
  sandbox without enabling ALB access logging, which is itself an infra change outside DISCOVERY-
  lane scope. Flagging this as the natural follow-up instrument if this finding is picked up:
  enabling access logs would let a future audit identify whether SSE/long-poll routes specifically
  are the ones exceeding the 30s drain window, rather than this write-up's evidence-backed
  hypothesis.

### No code changed by this finding

Read-only investigation only — `aws`/boto3 CLI reads via `sts`, `cloudwatch`, `ecs`, `elbv2`
describe/get calls, nothing mutated. No PR for this entry.

| **Status** | WRITE-UP — root cause identified and evidence-backed, but the fix (deploy batching, or SSE-graceful-shutdown handling) is an infra/architecture decision outside a single DISCOVERY-lane sweep's scope. Flagging for coordinator/operator visibility and as a #4076-style collaboration item if Cursor's autopilot loop wants to take the deploy-batching half. |
