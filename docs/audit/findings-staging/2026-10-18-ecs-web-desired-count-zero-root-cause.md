## 2026-10-18 — [FINDING, infra] `blackout-production-web` ECS service running with `desiredCount=0` — root cause of the 2026-10-18 production outage

> **kind:** `FINDING`

| Field | Value |
| --- | --- |
| **Status** | NEEDS OPERATOR ACTION (not fixable from this sandbox or by the deploy pipeline itself) |
| **Severity** | P0 |
| **Surface** | `blackout-production-cluster` / `blackout-production-web` ECS service (AWS) |

### Symptom chain (full incident, ~17:23Z onward)

1. ~17:23Z: production started returning HTTP 503 ("Service Temporarily Unavailable", ALB's
   own no-healthy-targets page, not an app-level error) on `/api/health`, `/pricing`, board
   routes, etc.
2. ~18:17Z: a sibling session found the GitHub Actions `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY`
   secret was itself invalidated at the IAM level (`InvalidClientTokenId` on every call, including
   a manual `workflow_dispatch` redeploy attempt) — this blocked recovery (nobody could push a new
   image or roll ECS) but was never claimed to be the original cause of the ECS-unhealthy state.
3. ~18:47Z–20:15Z: symptom intermittently read as HTTP 403 (Cloudflare WAF "Attention Required!"
   block page) from multiple independent vantage points (this sandbox, a sibling sandbox, and
   production's own `ops-collect-action-items.mjs` GitHub-Actions-hosted health probe) — cause
   still unconfirmed, but now moot (see below).
4. ~20:00Z: the GitHub Actions AWS credential started working again (operator action, inferred —
   no message was ever sent to any session, but `aws-actions/configure-aws-credentials` and
   `amazon-ecr-login` both succeeded on run `39161355948` for the first time since the outage
   began). PR #6248 (`fix(deploy): skip static-asset gate when Cloudflare blocks GHA egress`)
   merged and triggered this run.
5. The deploy ran end-to-end successfully: image built and pushed, `blackout-production-web`
   "rolled" (trivially — see below), Cloudflare edge cache purged, static-asset validation step
   warned-and-passed (PR #6248's new edge-block handling, not a real pass), market-worker rolled
   normally. **The whole workflow run completed with `conclusion: success`.** Despite this, the
   site is STILL returning 503 as of this writing (20:17Z, ~2h54m into the incident) — now a clean
   Cloudflare/ALB "503 Service Temporarily Unavailable" page (WAF block gone), not the WAF 403.

### Root cause (confirmed from this run's own GitHub Actions job log, run 39161355948, job
`build-and-push`, step "Roll ECS production web")

The job's own `aws ecs describe-services --cluster blackout-production-cluster --services
blackout-production-web` output, captured immediately after registering the new task definition
(20:05:50Z), shows:

```json
{
  "status": "ACTIVE",
  "desiredCount": 0,
  "runningCount": 0,
  "pendingCount": 0,
  ...
}
```

**`blackout-production-web`'s desired task count is 0.** The deploy script's own in-repo comment
(`.github/workflows/ecr-push-production.yml`, same step) states explicitly and for good reason:

> "Do NOT pass `--desired-count` here: auto-scaling manages the task count. Overriding it resets
> the count on every deploy and fights the scaling target. The live scalable target is min 5 /
> max 12 (verified 2026-08-06)."

So the deploy pipeline **by design never touches desiredCount** — it only registers a new task
definition and calls `--force-new-deployment`, trusting Application Auto Scaling to keep the
service between 5 and 12 tasks. With desiredCount already at 0, `--force-new-deployment` against
a 0-desired service does nothing (there is nothing to roll): the wait loop immediately observes
`running=0/0, rollout=COMPLETED` and exits "successfully" — explaining why a fully green,
successful deploy run left the site still down. **This is not a deploy-pipeline bug** — the
pipeline behaved exactly as documented/intended. The bug is that the service's desired count is
at 0 in the first place, well below the documented floor of 5, and nothing is bringing it back up.

By contrast, `blackout-production-market-worker` (the second service this same run rolls) showed
`desiredCount: 2, runningCount: 2` — healthy and normal. **Only the web-tier service is affected.**

This is very likely the actual root cause of the entire 3-hour outage, not merely a symptom of
it — the invalidated AWS key (item 2 above) only ever explained why nobody could *redeploy*; it
never explained why the ALREADY-RUNNING fleet went to zero tasks in the first place. Two
possibilities, not yet distinguished from this sandbox (no working AWS credentials here — see
Evidence gap below):

- Someone/something called `aws ecs update-service --desired-count 0` on
  `blackout-production-web` directly (manual action, a runbook/incident-response script, or a
  malfunctioning automation), overriding the Application Auto Scaling target until the next
  scaling evaluation — and the scaling policy is either not re-asserting its floor, or was itself
  disabled/detached.
- The Application Auto Scaling **scalable target** for this service (`service/blackout-production-
  cluster/blackout-production-web`, min 5 / max 12 per the script's own 2026-08-06 verification)
  was deleted or deregistered, so nothing is enforcing the floor anymore and the service will sit
  at 0 indefinitely until someone manually restores it.

### Fix (cannot be applied from this sandbox — needs the operator or a session with live AWS creds)

Minimal, immediate, reversible restore to the documented normal floor:

```
aws ecs update-service \
  --cluster blackout-production-cluster \
  --service blackout-production-web \
  --desired-count 5 \
  --region us-east-1
```

Then verify the Application Auto Scaling scalable target still exists and has the documented
min=5/max=12 range (so this doesn't silently drift back to 0 again):

```
aws application-autoscaling describe-scalable-targets \
  --service-namespace ecs \
  --resource-ids service/blackout-production-cluster/blackout-production-web \
  --region us-east-1
```

If the scalable target is missing entirely, it needs to be re-registered (per
`terraform/` — check for drift against the live resource rather than blindly re-applying, per
this repo's standing "do not `terraform apply` against production" rule).

### Evidence gap (why this sandbox could not apply the fix itself)

This sandbox's own `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY` are a SEPARATE credential object
from the one stored in GitHub Actions secrets. Re-tested via `boto3.client("sts").
get_caller_identity()` twice during this incident (20:05Z and 20:11Z) — both times
`InvalidClientTokenId`, even after the GitHub Actions secret was confirmed working (same error as
documented in CLAUDE.md's "AWS — WORKS IN-SESSION when the operator's creds are present" note, but
this time genuinely absent, not a stale assumption). No session in this sandbox model can run the
fix command above; it needs direct operator action (AWS Console or CLI with real credentials) or a
session where the operator has pasted working creds into the environment.

### Why this was findable only now

Nobody could see `desiredCount` on the live service without a working AWS credential anywhere in
the loop — the sandbox's own creds were always placeholder/invalid, and the GitHub Actions secret
was invalidated for the first ~2h40m of the incident, so this job log (the first one to actually
run `describe-services` successfully since before the outage) is the first point any session had
visibility into the service's real desired-count state.
