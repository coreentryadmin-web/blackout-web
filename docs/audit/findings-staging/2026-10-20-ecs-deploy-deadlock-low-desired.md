# ECS production deploy deadlocks when desiredCount &lt; 5

> **kind:** FINDING

| **Status** | FIXED (PR pending) |

## What broke

`ECR push (production)` timed out after 36 minutes with `PRIMARY: running=0/1` on commits including `4e7f2eb22`. ECS events: *"unable to stop or start tasks during a deployment because of the service deployment configuration"*.

## Root cause

`blackout-production-web` rolled with `minimumHealthyPercent=100` and a **fixed** `maximumPercent=120` while live `desiredCount=2`. At desired=2, `floor(2 × 1.20) = 2` — no spare slot to start a replacement under zero-loss rolling rules.

## Fix

Recompute `maximumPercent` from live `desiredCount` on every deploy via `computeWebDeployMaximumPercent()` (`scripts/deploy/lib/taskdef-rewrite.mjs`), wired in `ecr-push-production.yml`.

## Verify after merge

Re-run failed `ecr-push-production` workflow on `main` or push a no-op; deploy should complete within the 36m stability window.
