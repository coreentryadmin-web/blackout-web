# ECS production deploy deadlock when desiredCount < autoscaling floor

> **kind:** FINDING

| **Status** | FIXED (PR pending) |
|------------|-------------------|
| **Severity** | P1 — deploy pipeline |
| **Discovered** | 2026-10-20 ECR push run 39363440942 |

## Symptom

`build-and-push` timed out after 36m with `PRIMARY: running=0/1` throughout. ECS events: *unable to stop or start tasks during a deployment because of the service deployment configuration*.

## Root cause

`blackout-production-web` was left at **desiredCount=2** after outage recovery, while the workflow still applies **minimumHealthyPercent=100 / maximumPercent=120**. That pairing **deadlocks below 5 tasks** (documented in `ecs-deploy-config.test.ts`: `floor(2×1.20)=2` grants no spare slot for replacement).

Prod stayed on old tasks (`/api/health` 200); new merges could not ship.

## Fix

`ecr-push-production.yml`: before `update-service`, if `desiredCount < 5`, pass `--desired-count 5` once to restore the autoscaling floor, then roll.

## Evidence

GH Actions log `39363440942` — `services[0].desiredCount: 2`, 144× `running=0/1`, timeout at 04:00:47Z.
