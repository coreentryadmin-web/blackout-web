# ECS web deploy deadlock when desiredCount < autoscaling floor

> **kind:** FINDING

| **Status** | FIXED (PR pending) |

## What broke

2026-10-20: **ECR push (production)** timed out with `PRIMARY: running=0/1` for 36 minutes. ECS events: `unable to stop or start tasks during a deployment because of the service deployment configuration` — classic **100/120 deadlock** when `desiredCount` is below 5 (autoscaling had scaled the fleet to 2).

Prod stayed on old tasks (health 200) but **#6301** and subsequent merges did not ship.

## Fix

`scripts/deploy/ensure-web-deploy-capacity.mjs` + call from `ecr-push-production.yml` before `update-service`: scale web `desiredCount` up to at least **5** (autoscaling MinCapacity) when below floor. Pure helpers `minDesiredForRollHeadroom` / `targetDesiredBeforeWebRoll` in `taskdef-rewrite.mjs`.

## Verify

`npx tsx --test scripts/deploy/roll-ecs.test.ts` (new headroom + workflow guard tests).
