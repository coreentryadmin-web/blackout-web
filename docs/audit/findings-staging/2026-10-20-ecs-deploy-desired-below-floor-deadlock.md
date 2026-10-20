# ECR deploy timeout — web desiredCount below autoscaling floor deadlocks roll

> **kind:** FINDING

| **Status** | FIXED (PR pending) |
|------------|-------------------|

## Symptom

`main@4e7f2eb22` (and several prior merges 2026-10-20): **build-and-push** failed after 36 min with `PRIMARY: running=0/1, rollout=IN_PROGRESS` → `Timed out waiting for PRIMARY deployment to stabilize.` Prod `/api/health` stayed 200 on old tasks; new SHA never completed roll.

## Root cause

`blackout-production-web` was at **desiredCount=2** while the workflow applies `minimumHealthyPercent=100,maximumPercent=120`. For desired&lt;5, `floor(desired × 120/100) < desired + 1` — no spare slot for a replacement task, so the PRIMARY deployment never progresses (same arithmetic documented in `ecr-push-production.yml` and `assertDeploymentConfigSane`).

## Fix

Before `update-service --force-new-deployment`, if `desiredCount < 5`, restore the autoscaling floor (`update-service --desired-count 5`) and wait for `runningCount >= 5`. Pure helper `minDesiredCountForZeroLossRoll` + tests in `roll-ecs.test.ts`.

## Verify

Next ECR push on main after merge should complete roll when fleet had been scaled down; if new tasks still fail ALB health, circuit breaker should flip (separate incident).
