# ECS web deploy deadlock — restore autoscale floor before roll — FIXED

> **kind:** `FINDING`

| **Status** | FIXED in PR (workflow pre-flight) |
|---|---|

## Symptom

`ECR push (production)` fails at **Roll ECS production web** with `running=0/1` frozen for all 144 polls (~36 min), then `Timed out waiting for PRIMARY deployment to stabilize`. Production `/api/ready` stayed **200** on already-serving tasks; merged fixes (e.g. #6301 zerodte skip-grading backlog) did not reach prod.

## Root cause

`desiredCount` drifted below the documented Application Auto Scaling **floor of 5** (observed **1**). With `minimumHealthyPercent=100` and `maximumPercent=120`, `floor(desired * 1.20)` must exceed `desired` to grant a spare replacement slot — at `desired=1` the ceiling is 1 and the roll cannot start.

## Fix

In `.github/workflows/ecr-push-production.yml`, before `--force-new-deployment`, read `desiredCount` and if `< 5`, `update-service --desired-count 5` and wait for `runningCount >= 5` (up to 10 min). Guard pinned in `src/lib/ecs-deploy-config.test.ts`.

## Evidence

Run `39363440942` (head `4e7f2eb22`, 2026-10-20): PRIMARY `running=0/1` for polls 1–144.
