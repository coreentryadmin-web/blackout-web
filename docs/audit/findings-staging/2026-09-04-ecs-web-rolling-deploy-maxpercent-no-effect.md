> **kind:** FINDING

## `blackout-production-web` deploy speed: `maximumPercent` 120→200 change had NO measured effect — corrected finding

| | |
|---|---|
| **Status** | MEASURED, NOT FIXED — config change made, does not solve the problem, real bottleneck still open |
| **Severity** | P2 (operations/performance — production runs stale merged code for extended periods, no correctness impact) |

### Original observation (correct)

`ecr-push-production.yml` uses `concurrency: {group: ecr-push-production, cancel-in-progress: false}` —
a deliberate design (see the workflow's own header comment, added 2026-08-19 after a prior incident
where cancelling in-flight deploys left partial/unverified rollouts in production). This queues
deploys and lets each one finish fully, but only cancels PENDING (not-yet-started) runs when
superseded — so during a burst of rapid merges, only the deploy that happens to be "in flight" when
things quiet down actually reaches production; everything else gets superseded in queue.

Measured live 2026-09-04 ~01:53 UTC: the last successful deploy was at 00:32:33 (commit `6c527fcd`).
Between then and the next real completion, **7 merged fixes queued up and were superseded without
ever deploying** — production ran on hour-old code despite continuous merging. Root cause of the
SLOW deploy itself: `blackout-production-web`'s ECS service (`desiredCount: 8`) had
`deploymentConfiguration.maximumPercent: 120` — only 1 extra task headroom above the steady-state 8,
forcing a strictly sequential one-task-at-a-time rollout. Confirmed via `describe_services`: the
deployment that started 01:36:28 didn't reach steady state until 02:02:10 — **~26 minutes** for 8
tasks, replacing exactly 1 task every ~2.3 minutes (start → ALB-register → stop old, repeat).

### The fix that was tried

Raised `maximumPercent` from 120 to 200 via a surgical `ecs.update_service` call (deliberately
NOT via `terraform apply`, per this repo's own standing rule that terraform state doesn't match
production — see CLAUDE.md's AWS section). `minimumHealthyPercent` (100) and the deployment circuit
breaker (enabled, rollback:true) were left unchanged — only the rollout headroom increased, in
principle allowing all 8 new tasks to start in parallel instead of one at a time.

### Why this finding says NOT FIXED

Watched the **next real deploy** (task definition revision `:1238` → `:1239`, deployment started
02:13:35 — confirmed via `describe_services`' `deployments[].createdAt`, well after the config
change was applied and confirmed saved). Its actual rollout cadence, read directly from
`describe_services()['events']`:

```
02:13:53 started 1 task   →  02:14:23 registered  →  02:15:04 stopped 1 old
02:16:38 started 1 task   →  02:17:09 registered  →  02:17:49 stopped 1 old
02:19:23 started 1 task   →  02:19:54 registered  →  02:20:35 stopped 1 old
```

**Identical one-task-at-a-time cadence, same ~2:45 per wave, as the deploy that ran under the OLD
120% config.** The extra headroom from `maximumPercent: 200` was not used — ECS's ROLLING strategy
did not launch a larger batch even though it now had room to.

### What's actually pacing it (partial lead, not yet a confirmed root cause)

The container's own Docker `healthCheck` (`describe_task_definition`): `interval: 30s, timeout: 5s,
retries: 3, startPeriod: 90s`. This bounds how fast ECS can consider ANY one new task
"stable," but does not by itself explain why ECS's scheduler chooses to launch tasks one at a time
rather than in a batch sized by the available `maximumPercent` headroom — that batching behavior is
internal to ECS's ROLLING deployment controller and isn't something `maximumPercent` alone
guarantees will be exploited. This needs more investigation (possibly AWS support, or testing
whether a much larger `maximumPercent` or splitting into more `desiredCount` behaves differently)
before concluding a real fix.

### Current state

`maximumPercent` is left at 200 (harmless — `minimumHealthyPercent` and the circuit breaker are the
safety-relevant settings and are unchanged, so this doesn't introduce risk) but it did **not**
solve the actual problem. The deploy-queue-starvation issue described in the original observation
is still real and open.

### Lesson for this file's own discipline

Caught by literally watching the next real deploy rather than assuming the config change worked —
exactly the "a merge is not a verification" / "measure, don't guess" standing rule this file's own
CLAUDE.md states elsewhere, applied to an infra change instead of a code change.
