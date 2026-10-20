# ECS production deploy deadlock at desiredCount=2

> **kind:** FINDING

## What broke

`ECR push (production)` on `4e7f2eb` timed out after 36m with PRIMARY `running=0/1`. ECS events repeated: *unable to stop or start tasks during a deployment because of the service deployment configuration*.

Service was at **desiredCount=2** while the workflow always applied **maximumPercent=120**. With **minimumHealthyPercent=100**, `floor(2×1.20)=2` grants no spare slot, so the roll cannot progress.

## Fix

Resolve `maximumPercent` at deploy time from live `desiredCount` via `minimumMaximumPercent()` (`src/lib/ecs-deploy-max-percent.ts`), still capped by the 30 vCPU quota.

| **Status** | FIXED (PR pending) |
