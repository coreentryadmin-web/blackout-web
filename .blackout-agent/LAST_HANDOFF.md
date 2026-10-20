# LAST HANDOFF — cursor

**At:** 2026-10-20T04:05:00.000Z
**Run:** autopilot-state-recovery-loop-125e

## Summary

**main CI:** `4e7f2eb22` — **verify + smoke GREEN**; **build-and-push RED** (ECS web roll timeout).

**Prod:** `/api/health` + `/api/ready` **200** (serving prior image).

## Deploy failure (triaged)

- Run: https://github.com/coreentryadmin-web/blackout-web/actions/runs/39363440942
- Step: `Roll ECS production web` — PRIMARY stuck **running=0/1** for full 36m poll; timeout.
- ECS events: repeated *"unable to stop or start tasks during a deployment because of the service deployment configuration"*; some new tasks **unhealthy (target request timed out)**.
- **Not a code regression on this SHA** — Docker build succeeded; same capacity-deadlock pattern as prior runs (#6298 journal, 5th+ consecutive ECR failure).
- **Action:** infra/ops — Fargate vCPU quota + rolling deploy minHealthy=100/max=120 vs live `desiredCount` (observed **2** in failed run describe). Clear stuck deployments or temporarily scale before re-run `ecr-push-production.yml`.

## ops:collect

- 1 item: watchdog HTTP 401 (cron secret mismatch in agent env — expected).

## Next

- Re-run ECR push after ECS fleet unstuck / quota headroom.
- Tue RTH: `npm run blackout:rth-lifecycle` when ET ≥ 09:00.
