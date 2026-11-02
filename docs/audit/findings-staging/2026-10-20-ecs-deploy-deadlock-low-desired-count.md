> **kind:** FINDING

## ECS production web deploy deadlock when desiredCount &lt; autoscaling floor — FIXED

| **Status** | FIXED (PR pending) |
| --- | --- |

**Symptom:** `ECR push (production)` `build-and-push` timed out after 36m with PRIMARY `running=0/1` on commit `4e7f2eb22`. ECS events: "unable to stop or start tasks during a deployment because of the service deployment configuration."

**Root cause:** Live `desiredCount` was **2** while deploy uses `minimumHealthyPercent=100` and `maximumPercent=120`. At desired=2, `floor(2×1.20)=2` tasks max — no spare slot for rolling replacement. Arithmetic is guarded for **[5,12]** in `ecs-deploy-config.test.ts` but not enforced at deploy time when count drifts below 5.

**Fix:** Pre-scale web service to `WEB_AUTOSCALE_MIN=5` before `update-service --force-new-deployment` when current desired is lower; wait for `runningCount ≥ 5`. Regression test asserts workflow contains the guard.

**Blast radius:** Production deploy pipeline only; does not change steady-state autoscaling bounds. Origin remained healthy on old tasks during failed roll.

**Verify:** Next green `ecr-push-production` on `main` completes PRIMARY rollout; no ECS deployment-configuration errors at low desired counts.
