## 2026-10-19 — [FINDING, infra] `blackout-production-web` deploy deadlock STILL UNRESOLVED ~8h after it first appeared — zero deploys have actually rolled new code since before the 2026-10-18 ~17:23Z outage began

> **kind:** `FINDING`

| Field | Value |
| --- | --- |
| **Status** | NEEDS OPERATOR ACTION (AWS creds required — no sandbox session has working creds; same blocker as the two prior entries on this incident) |
| **Severity** | P1 (escalating — not a new mechanism, but confirmed still live and now spanning ~8 hours / 5+ merged PRs) |
| **Surface** | `blackout-production-web` ECS service (AWS) / `.github/workflows/ecr-push-production.yml` "Roll ECS production web" step |

### This is an escalation addendum, not a new root cause

This is the same `floor(desired × 1.20) == desired` deployment-arithmetic deadlock already fully
documented in the 2026-10-18 FINDINGS.md entry ("`blackout-production-web` deploy stuck for the
FULL 36-min budget — service's real desiredCount appears to have drifted back below 5..."),
itself building on the original 2026-10-18 `desiredCount=0` outage root-cause entry. This entry
exists only to record that **the prescribed fix (`aws ecs update-service --desired-count 5`) has
still not visibly taken effect**, and to correct the record on how long deploys have actually been
blocked.

### New evidence (run 39182118791, job 117838467408, this session's own live check 2026-10-19
~01:33Z)

The "Roll ECS production web" step ran the full 36-minute budget (00:55:25Z→01:33:21Z) and timed
out with the identical signature as the two prior documented occurrences:

```
[46/144] PRIMARY: running=0/1, rollout=IN_PROGRESS
... (frozen at running=0/1 for the remaining ~98 polls, ~25 more minutes) ...
[144/144] PRIMARY: running=0/1, rollout=IN_PROGRESS
Timed out waiting for PRIMARY deployment to stabilize.
##[error]Process completed with exit code 1.
```

Production itself remained healthy throughout (`/api/health` → 200 at every check this session
made across the whole window) — same as both prior occurrences, for the same reason
(`minimumHealthyPercent=100` means ECS can only add capacity before stopping an existing healthy
task, so a deadlocked rollout can never touch the already-serving fleet).

### Corrected timeline — deploys have been blocked longer than previously recorded

Checked directly against the GitHub Actions API rather than assumed: the **last `ECR push
(production)` run with `conclusion: success` is run 39161355948 (2026-10-18 20:00:56Z–20:17:25Z,
carrying PR #6248)**. But per that same incident's own FINDINGS.md entry, that run's own
"successful" roll was itself trivial/vacuous — `desiredCount` was still 0 at that point, so there
was nothing to roll and the step exited green without actually deploying anything. **No deploy has
genuinely rolled new code to `blackout-production-web` since before the outage began at
~17:23Z on 2026-10-18** — i.e. this has now been blocked for roughly **8+ hours**, not the shorter
window either prior entry's title implied at the time it was written.

Every run since has failed the same way: 39169030903 (22:10Z, desired≈2 observed), 39178212540
(23:51Z→00:27Z, timed out), 39182118791 (00:55Z→01:33Z, timed out — this entry's own evidence).
That is at least 3 independent timed-out occurrences of the identical `running=0/1` freeze,
clearing this repo's own 3-instance noise threshold for "this is a real, persistent pattern," not
a transient blip.

### Merged PRs still not live in production as of this writing

At minimum, the following merged-to-`main` fixes have never actually reached production: #6251
(security CVE patch), #6252 (Benzinga pagination test fix), #6253 (this session's own swing
structural-stop dedup fix), #6258 (SPX rawScore recompute fix), #6260 (closed-deck chain contract
mid/delta fix), #6261 (swing entry-trigger dead-reason compose fix), #6263 (swing play-brief
direction/thesis fields). None of these are implicated in the deadlock itself — this is purely an
infra capacity-state issue, independent of what is queued behind it.

### Fix — unchanged from the prior entry, still not executable from any sandbox session

```
aws ecs describe-services --cluster blackout-production-cluster \
  --services blackout-production-web --query 'services[0].desiredCount' --region us-east-1

aws application-autoscaling describe-scalable-targets \
  --service-namespace ecs \
  --resource-ids service/blackout-production-cluster/blackout-production-web --region us-east-1

aws ecs update-service --cluster blackout-production-cluster \
  --service blackout-production-web --desired-count 5 --region us-east-1
```

If the scalable target's min is not 5 (or it is missing/deregistered), that is very likely *why*
the first fix attempt (inferred from the 2026-10-18 ~20:47Z recovery) did not hold — something
keeps pulling desired back down toward 1-2 rather than settling at the documented floor of 5. This
needs the scalable target itself checked and re-registered if necessary (per this repo's standing
"check live state, do not blindly `terraform apply` against production" rule), not just another
one-off `update-service` call that could drift back down again the same way.

### Evidence gap

Same as both prior entries on this incident: this sandbox's own AWS credentials are invalid
placeholders (`InvalidClientTokenId`, re-confirmed 2026-10-19T01:3x Z). No session here can run
the diagnostic/fix commands directly.
