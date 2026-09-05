> **kind:** FINDING

## `blackout-production-web` ECS deploy rolls one task at a time — CONFIRMS existing 2026-09-04 finding, does NOT reopen the `maximumPercent` fix

| Field | Value |
|-------|-------|
| **Status** | OBSERVED ONLY — duplicate confirmation of an already-tried-and-rejected fix; no new action proposed |
| **Severity** | P2 |
| **Area** | Infra / deploy pipeline (`blackout-production-web` ECS service) |

## Supersedes / relates to

This finding's *root-cause observation* (serialized one-task-at-a-time rollout) independently
re-confirms `docs/audit/FINDINGS.md`'s existing entry **"`blackout-production-web` deploy speed:
`maximumPercent` 120→200 change had NO measured effect — corrected finding"** (2026-09-04, tracked
as **OPS-001** in `docs/ops/RTH-VALIDATION-LEDGER-2026-09-05.md`). That finding already:
- tried raising `maximumPercent` 120→200 via a surgical `update_service` call,
- watched the *next real deploy* after the change, and
- found **identical** one-task-at-a-time cadence (~2:45/wave) — the extra headroom was never used,
  because ECS's ROLLING controller's batching behavior is not something `maximumPercent` alone
  controls.

**This PR originally proposed raising `maximumPercent` 120→150 as a new fix. That proposal is
wrong and is withdrawn** (per Cursor's independent peer review, which caught both problems below
before this shipped as an infra change):

1. **Already disproven by the identical, larger experiment.** 200% is a bigger headroom increase
   than 150% would have been, and it measurably did not change the rollout cadence. There is no
   reason to expect 150% would behave differently.
2. **150% would violate the account's own documented Fargate vCPU quota window.** `.github/workflows/ecr-push-production.yml`
   (lines 253-263) derives and hard-codes the *only* safe `maximumPercent` range given the Fargate
   On-Demand vCPU quota (`L-3032A538` = 30 in this account) across the service's autoscaling range
   `desiredCount ∈ [5, 12]`: **`maximumPercent ∈ [120, 124]`**. At `desired=12`,
   `maximumPercent=150` permits `floor(12×1.50)=18` web tasks × 2 vCPU = 36 vCPU, plus the
   market-worker's 2 vCPU = 38 vCPU — over the 30 vCPU quota. 120 is deliberately the smallest
   value in that window (clears every deadlock case at the low end of autoscaling); the workflow
   itself re-applies `minimumHealthyPercent=100,maximumPercent=120` on **every** deploy
   (`update-service --deployment-configuration ...`, same file), so even a one-off `update_service`
   bump would be silently reverted by the very next deploy.

Both defects mean the original "Proposed fix" section below (kept for the historical record, struck
through) should never be applied.

## What this finding actually adds

A **fresh, independent 2026-09-05 measurement** confirming the 2026-09-04 finding's "still open"
status holds a day later — useful as a recency data point, not as a new root cause or a new
proposed remedy. The real open question remains exactly what the 2026-09-04 finding already
identified as unresolved: what specifically paces ECS's ROLLING controller to one task at a time
regardless of `maximumPercent` headroom (candidates already named there: container `healthCheck`
`startPeriod`/`interval` pacing, or something internal to the ROLLING deployment controller itself)
— and, separately, `ecr-push-production.yml`'s `concurrency: {cancel-in-progress: false}` deploy-queue
serialization (raised independently as CLQ-045 in the 360° cross-exam batch 1). Neither is something
this finding resolves; both are legitimate follow-up investigation, not a `maximumPercent` change.

## ~~Original proposed fix (WITHDRAWN — do not apply)~~

~~Raise `maximumPercent` on `blackout-production-web` from `120` → `150`...~~ — see "Supersedes /
relates to" above for why this is wrong. Do not raise `maximumPercent` above 124 (the documented
quota ceiling) or apply it without also updating `ecr-push-production.yml`'s own re-applied
`--deployment-configuration` value and `src/lib/ecs-deploy-config.test.ts`'s quota-guard assertions
— an out-of-band `update_service` call alone will not survive the next deploy.

## Why this matters

Deploy-pipeline latency is in-scope for the standing performance/latency audit mandate. This
confirms the bottleneck is real and still open as of 2026-09-05, but the fix is NOT a
`maximumPercent` bump — that avenue is closed per the evidence above. The genuine next steps
(ECS ROLLING controller batching, container health-check pacing, or the separate build/push queue
serialization) remain open work for a future investigation, not something to guess at here.

## Evidence

- `aws ecs describe-services --cluster blackout-production-cluster --services blackout-production-web` →
  `deploymentConfiguration: {maximumPercent: 120, minimumHealthyPercent: 100, deploymentCircuitBreaker: {enable: true, rollback: true, resetOnHealthyTask: true, thresholdConfiguration: {type: BOUNDED_PERCENT, value: 50}}, strategy: ROLLING, bakeTimeInMinutes: 0}`, `desiredCount: 8`, `launchType: FARGATE`.
- Same call for `blackout-production-market-worker`: `maximumPercent: 200`, `desiredCount: 1` —
  confirms the sibling service's different config is a correct fit for its own (singleton) fleet
  size, not evidence that 200%/150% would help an 8-task service (the 2026-09-04 finding already
  tested exactly that on this same service and it did not help).
- ECS service events for `blackout-production-web` (`describe-services` → `.events`) for the window
  11:42:57Z–12:11:42Z on 2026-09-05 show 8 distinct `has started 1 tasks` / `has stopped 1 running
  tasks` cycles, each followed by a `registered 1 targets` / `deregistered 1 targets` pair, spaced
  ~3 minutes apart — matching the 2026-09-04 finding's own measured ~2:45/wave cadence almost
  exactly, a day later and after that finding's `maximumPercent=200` change was in place.
- GitHub Actions job `33962805600` → job `101300318355`, step "Roll ECS production web":
  `started_at: 2026-09-05T11:42:57Z`, `completed_at: 2026-09-05T12:11:42Z`.
- `.github/workflows/ecr-push-production.yml:253-263` — the vCPU-quota derivation comment
  establishing `maximumPercent ∈ [120, 124]` as the only safe window given `L-3032A538=30`.
- `docs/audit/FINDINGS.md` (2026-09-04 entry) — the prior `maximumPercent` 120→200 experiment and
  its null result.
- `docs/ops/RTH-VALIDATION-LEDGER-2026-09-05.md` line 96 — `OPS-001`, tracking the same open issue.

## Correction note

This finding was originally staged proposing a `maximumPercent` 120→150 change and asking Cursor for
independent verification/execution. Cursor's peer review caught both the prior-experiment
duplication and the vCPU-quota violation before any AWS mutation was made — no infra change was
ever applied. Filed as a corrected, no-new-action finding rather than deleting the branch, per this
repo's standing "no auto-merge without evidence" discipline: the observation itself remains true and
worth a durable record even though the proposed remedy was wrong.
