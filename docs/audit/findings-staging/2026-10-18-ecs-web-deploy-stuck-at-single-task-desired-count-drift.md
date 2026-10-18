## 2026-10-18 — [FINDING, infra] `blackout-production-web` deploy stuck for the FULL 36-min budget — service's real desiredCount appears to have drifted back below 5, re-triggering the exact deployment-arithmetic deadlock `ecr-push-production.yml`'s own comments warn about

> **kind:** `FINDING`

| Field | Value |
| --- | --- |
| **Status** | NEEDS OPERATOR ACTION (AWS creds required — this sandbox's own creds are invalid) |
| **Severity** | P1 |
| **Surface** | `blackout-production-web` ECS service (AWS) / `.github/workflows/ecr-push-production.yml` "Roll ECS production web" step |

### Symptom

Deploy run [39169030903](https://github.com/coreentryadmin-web/blackout-web/actions/runs/39169030903)
(carrying merged PRs #6251 security-CVE fix, #6252 benzinga-pagination test fix, #6253 swing
dedup fix) ran the "Roll ECS production web" step for the **entire 36-minute budget** and failed:

```
Waiting for PRIMARY deployment to stabilize (up to 36 min)...
  [1/144] PRIMARY: running=0/0, rollout=IN_PROGRESS
  [2/144] PRIMARY: running=0/1, rollout=IN_PROGRESS
  ... (stays at running=0/1 for all 144 polls, 36 minutes straight) ...
  [144/144] PRIMARY: running=0/1, rollout=IN_PROGRESS
Timed out waiting for PRIMARY deployment to stabilize.
##[error]Process completed with exit code 1.
```

This is the **second consecutive failure of this exact step** (the first, earlier today, was the
root cause of the 2026-10-18 production outage — `desiredCount=0`, already documented in
`docs/audit/findings-staging/2026-10-18-ecs-web-desired-count-zero-root-cause.md` / folded into
`FINDINGS.md`). **This is a different failure mode, not a repeat of the same bug** — the evidence
below rules out `desiredCount=0` this time.

Production itself was **unaffected throughout** — `/api/health` returned fresh `200 {"ok":true}`
at every check during the stuck window. This is expected and by design: `minimumHealthyPercent=100`
means ECS can only ADD capacity before it ever stops a currently-healthy task, so a stuck new-task
rollout can never touch the already-serving fleet. This is a **deploy-pipeline / capacity problem,
blocking 3 already-merged, tested fixes from reaching production** — not a renewed site outage.

### Root cause (read directly from the job's own log, run 39169030903, job 117802978940)

Before calling `update-service`, the step's own `aws ecs describe-services` snapshot (captured at
22:10:06Z) showed **three distinct service revisions already coexisting**:

```json
"currentServiceRevisions": [
  { "requestedTaskCount": 0, "runningTaskCount": 0, "pendingTaskCount": 0 },
  { "requestedTaskCount": 2, "runningTaskCount": 2, "pendingTaskCount": 0 },
  { "requestedTaskCount": 1, "runningTaskCount": 0, "pendingTaskCount": 0 }
]
```

The middle revision (2 requested / 2 running) is the currently-stable serving fleet — **note this
is 2 tasks, not the documented floor of 5.** The third revision (1 requested / 0 running) was
*already* a stuck, unconverged deployment **before this run's own `update-service` call even
fired** — i.e. a prior deploy attempt left the service in a non-stable intermediate state.

This run then registered its own new task definition and called `update-service
--deployment-configuration minimumHealthyPercent=100,maximumPercent=120`. The workflow's own
extensive in-file comment (lines ~247-280) proves the exact arithmetic of why this can deadlock
below the documented floor:

> "max=120 → deadlocks NOWHERE in [5,12]. The binding case is the autoscaling FLOOR: floor(5\*1.20)
> = 6, one spare slot... if the min capacity is ever reduced, this whole block must be re-solved."

That assumes the service's real desired count stays in `[5,12]`. **At desired=2** (what this run's
pre-update snapshot shows as the actual running/serving count), `floor(2 × 1.20) = 2` — i.e. **zero
spare slots**: ECS cannot start a replacement task without first stopping an old one, and
`minimumHealthyPercent=100` forbids stopping an old one before a replacement is healthy. That is a
genuine, deterministic deadlock, not a transient hiccup — which is exactly consistent with the
observed symptom: `running=0/1` *frozen* for the full 36 minutes, never progressing by even one
tick, because there is structurally no slot for the one new task this run managed to request to
ever become healthy without first evicting a currently-healthy one.

**This both corrects and extends the Night Hawk Swings lane's same-day hypothesis** (journaled in
`docs/audit/nighthawk-swings-live-journal.json`'s `deploy_stuck_22_31` entry: *"if the Application
Auto Scaling scalable target... was never actually re-verified/restored after the outage, a
force-new-deployment... could hang indefinitely"*) — correct in spirit and now confirmed with the
precise mechanism: it is not merely "could hang with no capacity," it is the **specific
floor(desired×1.20)==desired deadlock** the workflow's own comment names as the exact failure mode
for `desired < 5`, and the job's own pre-update snapshot shows desired sitting well below that floor
(2 running, not 5) at the moment this deploy started.

### Why this isn't `desiredCount=0` again

The earlier outage's root cause was `desiredCount=0` (nothing running, nothing to roll, the step
completed *trivially and instantly* because there was nothing to wait for). This run's own
"Roll ECS production web" step ran the **full 36-minute budget and genuinely timed out** — 2 tasks
were already running and serving (hence production stayed healthy), and the deployment mechanism
itself deadlocked trying to ADD one more. The earlier operator fix
(`aws ecs update-service --desired-count 5`) brought the service back from 0 — but these numbers
show the service's live desiredCount is NOT currently 5, so either that fix was later overridden
by Application Auto Scaling settling toward a lower target, or the scalable target's floor was
never actually restored to 5 (the exact follow-up risk the earlier finding's resolution addendum
already flagged as unverified).

### Fix (needs an operator/session with real AWS credentials — this sandbox's own are invalid placeholders)

1. Check the service's actual current desired count:
   ```
   aws ecs describe-services --cluster blackout-production-cluster \
     --services blackout-production-web --query 'services[0].desiredCount' --region us-east-1
   ```
2. Check whether the Application Auto Scaling scalable target still has its documented min=5/max=12:
   ```
   aws application-autoscaling describe-scalable-targets \
     --service-namespace ecs \
     --resource-ids service/blackout-production-cluster/blackout-production-web \
     --region us-east-1
   ```
3. If desired is below 5, restore it (same command the first outage's finding prescribed):
   ```
   aws ecs update-service --cluster blackout-production-cluster \
     --service blackout-production-web --desired-count 5 --region us-east-1
   ```
4. If the scalable target is missing/deregistered or its min is not 5, re-register it per
   `terraform/` (check live state for drift first — do not blindly `terraform apply` against
   production, per this repo's standing infra-change policy).
5. Once desired is restored to >=5, **re-run (or let the next merge re-trigger) the deploy** —
   do NOT expect a bare retry to succeed before step 3 above, since the deadlock is deterministic
   arithmetic, not a transient placement blip; retrying without raising desiredCount first will
   very likely hit the identical `running=0/1` freeze for another 36 minutes.

### Evidence gap (same as the first outage's finding)

This sandbox's own `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY` are invalid placeholders
(`InvalidClientTokenId`, re-confirmed 2026-10-18T22:44Z). No session in this sandbox can run the
diagnostic/fix commands above directly; this needs direct operator action or a session with
working AWS credentials pasted into its environment.

### Blast radius

Blocks deployment of three already-merged, CI-green, tested fixes to production:
- #6251 — Next.js cache-poisoning CVE + transitive vuln patch (security fix, otherwise correctly
  shipped and verified, just not yet live)
- #6252 — benzinga-pagination test POLYGON_API_BASE fix (test-only, no production behavior change)
- #6253 — swing play-brief dedup fix (bug fix, not yet live)

None of these are themselves implicated in the deploy failure — the failure is purely
infra-capacity-state, independent of what image is being rolled.
