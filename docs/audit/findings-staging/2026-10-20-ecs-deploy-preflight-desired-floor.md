> **kind:** FINDING

## ECR deploy hung 36m when web desiredCount was below autoscaling floor — FIXED

| **Status** | FIXED (pending merge) |
|------------|----------------------|

**Symptom:** `build-and-push` on `main` @ `4e7f2eb` timed out with PRIMARY `running=0/1` for 144 polls; ECS events repeated *unable to stop or start tasks during a deployment because of the service deployment configuration*.

**Root cause:** `minimumHealthyPercent=100` / `maximumPercent=120` requires `floor(desired×1.20) >= desired+1`. For `desiredCount` 1–4 this is impossible (binding case: `desired=4` → ceiling 4, needs 5). After the Oct-18 outage (`desiredCount=0` / low count recovery), unattended merges re-applied 100/120 and deadlocked instead of failing fast.

**Fix:** `resolveWebRollDeploymentConfiguration()` + `print-web-deploy-configuration.mjs`; `ecr-push-production.yml` reads live `desiredCount` and exits before `update-service` when below floor 5 (or above 12 without headroom).

**Verify:** Next deploy with `desiredCount>=5` proceeds; if scaled low again, job fails in ~seconds with scale-up instructions instead of 36-minute timeout.
