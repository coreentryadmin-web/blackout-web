// Regression guard for the production ECS rolling-deploy configuration in
// .github/workflows/ecr-push-production.yml.
//
// Root cause history (2026-08-06): the web service shipped with minimumHealthyPercent=50, so a
// rolling deploy was allowed to drain the live member-facing fleet to HALF before any replacement
// was healthy. During that day's capacity incident this deepened the outage (5xx ~4.5%). Raising it
// out-of-band with `aws ecs update-service` did not stick, because this workflow re-applies its
// hardcoded --deployment-configuration on EVERY deploy and wipes any manual fix. The durable fix is
// the value in the workflow — so this test pins it there.
//
// The second half of the guard is the part that is easy to get wrong. minimumHealthyPercent=100
// only works if maximumPercent grants a spare task slot, because ECS may no longer free one by
// stopping a task first. It must ALSO stay under the account's Fargate vCPU quota (L-3032A538 = 30;
// the increase to 100 is CASE_OPENED, not granted). Those two bounds squeeze maximumPercent into a
// narrow window, and picking a value outside it either deadlocks the deploy or cannot schedule.
//
// ECS rounding rules (from the UpdateService / DeploymentConfiguration docs) are load-bearing here:
//   * maximumPercent       — ceiling on RUNNING+PENDING tasks, % of desiredCount, rounded DOWN
//   * minimumHealthyPercent — floor of healthy tasks held during the deploy, % of desiredCount,
//                             rounded UP

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const WORKFLOW = join(__dirname, "..", "..", ".github", "workflows", "ecr-push-production.yml");
const workflow = readFileSync(WORKFLOW, "utf8");

/** Account Fargate On-Demand vCPU quota (L-3032A538). Raise ONLY when AWS grants the increase. */
const VCPU_QUOTA = 30;
/** blackout-production-web task size. */
const WEB_TASK_VCPU = 2;
/** blackout-production-market-worker: singleton, counts against the same quota. */
const WORKER_VCPU = 2;
/** Application Auto Scaling bounds on the web service. */
const WEB_MIN_TASKS = 8;
const WEB_MAX_TASKS = 12;

type DeployConfig = { minimumHealthyPercent: number; maximumPercent: number; circuitBreaker: boolean };

/**
 * Pull the Nth `--deployment-configuration "..."` out of the workflow. Deliberately a regex over
 * the raw file rather than a YAML parse: these live inside a `run: |` shell block, so a YAML parser
 * only hands back one opaque string anyway.
 */
function deployConfigs(): DeployConfig[] {
  const matches = [...workflow.matchAll(/--deployment-configuration "([^"]+)"/g)];
  return matches.map((m) => {
    const raw = m[1];
    const num = (key: string): number => {
      const found = raw.match(new RegExp(`${key}=(\\d+)`));
      assert.ok(found, `deployment configuration is missing ${key}: ${raw}`);
      return Number(found[1]);
    };
    return {
      minimumHealthyPercent: num("minimumHealthyPercent"),
      maximumPercent: num("maximumPercent"),
      circuitBreaker: /deploymentCircuitBreaker=\{enable=true,rollback=true\}/.test(raw),
    };
  });
}

const ceilingTasks = (desired: number, maximumPercent: number) =>
  Math.floor((desired * maximumPercent) / 100);
const healthyFloorTasks = (desired: number, minimumHealthyPercent: number) =>
  Math.ceil((desired * minimumHealthyPercent) / 100);

test("the workflow still declares exactly two ECS deployment configurations (web, then worker)", () => {
  assert.equal(
    deployConfigs().length,
    2,
    "expected one --deployment-configuration for blackout-production-web and one for " +
      "blackout-production-market-worker; a third service means this guard needs updating",
  );
});

test("web service never drains below desiredCount during a deploy (minimumHealthyPercent=100)", () => {
  const [web] = deployConfigs();
  assert.equal(
    web.minimumHealthyPercent,
    100,
    "blackout-production-web serves live member traffic — a deploy must ADD a healthy task " +
      "before removing any. Lowering this re-introduces the 2026-08-06 capacity incident, where " +
      "a deploy at minimumHealthyPercent=50 halved the fleet mid-outage.",
  );
});

test("web rolling deploy can actually make progress at every autoscaling task count", () => {
  const [web] = deployConfigs();
  for (let desired = WEB_MIN_TASKS; desired <= WEB_MAX_TASKS; desired++) {
    const ceiling = ceilingTasks(desired, web.maximumPercent);
    const floor = healthyFloorTasks(desired, web.minimumHealthyPercent);
    const canAdd = ceiling > desired;
    const canRemove = floor < desired;
    assert.ok(
      canAdd || canRemove,
      `DEADLOCK at desiredCount=${desired}: ceiling=${ceiling} (floor(${desired}*` +
        `${web.maximumPercent}/100)) and minimum healthy=${floor} — ECS could neither start a ` +
        `replacement nor stop an old task, so the deploy would hang until the poller times out. ` +
        `This is exactly what minimumHealthyPercent=100 with the old maximumPercent=112 did at ` +
        `desiredCount=8: floor(8*1.12)=8, not 9.`,
    );
    // With minHealthy=100 the ONLY legal way forward is the spare slot, so require it explicitly.
    if (web.minimumHealthyPercent >= 100) {
      assert.ok(
        canAdd,
        `at desiredCount=${desired}, maximumPercent=${web.maximumPercent} grants no spare slot ` +
          `(ceiling ${ceiling}); minimumHealthyPercent=100 needs floor(desired*max/100) >= desired+1`,
      );
    }
  }
});

test("web deploy peak fits under the Fargate vCPU quota at the autoscaling maximum", () => {
  const [web] = deployConfigs();
  const peakTasks = ceilingTasks(WEB_MAX_TASKS, web.maximumPercent);
  const peakVcpu = peakTasks * WEB_TASK_VCPU + WORKER_VCPU;
  assert.ok(
    peakVcpu <= VCPU_QUOTA,
    `transient deploy peak at desiredCount=${WEB_MAX_TASKS} is ${peakTasks} web tasks ` +
      `(${peakTasks * WEB_TASK_VCPU} vCPU) + worker ${WORKER_VCPU} vCPU = ${peakVcpu} vCPU, over ` +
      `the ${VCPU_QUOTA} vCPU quota (L-3032A538). ECS would be unable to schedule its own ` +
      `replacement tasks. Lower maximumPercent, or raise VCPU_QUOTA once AWS grants the increase.`,
  );
  // Keep a real slot of headroom rather than landing exactly on the quota: at maximumPercent>=117
  // the ceiling becomes 14 tasks = exactly 30 vCPU, leaving nothing for any other Fargate task.
  assert.ok(
    VCPU_QUOTA - peakVcpu >= WEB_TASK_VCPU,
    `deploy peak ${peakVcpu} vCPU leaves less than one task of headroom under the ${VCPU_QUOTA} ` +
      `vCPU quota — too tight to absorb any other Fargate task in the account`,
  );
});

test("market-worker keeps singleton deploy semantics (minimumHealthyPercent=0)", () => {
  const [, worker] = deployConfigs();
  assert.equal(
    worker.minimumHealthyPercent,
    0,
    "blackout-production-market-worker is the SINGLE ingest leader and both upstreams allow one " +
      "live WebSocket per API key (see uw-socket.ts / polygon-socket.ts). Forcing an overlap " +
      "window makes failover slower, not safer — the incoming task loses the Redis leader SETNX " +
      "and idles a full reconcile tick. It is deliberately NOT symmetric with the web service.",
  );
  assert.ok(
    worker.maximumPercent >= 100,
    "worker maximumPercent must allow at least the one replacement task",
  );
});

test("both services keep the deployment circuit breaker with rollback enabled", () => {
  for (const [i, cfg] of deployConfigs().entries()) {
    assert.ok(
      cfg.circuitBreaker,
      `deployment configuration #${i + 1} lost deploymentCircuitBreaker={enable=true,rollback=true}` +
        ` — a bad task definition must auto-revert instead of bleeding tasks`,
    );
  }
});

test("the web stability poller budgets enough time for a one-task-at-a-time roll", () => {
  const [web] = deployConfigs();
  const loop = workflow.match(/for i in \$\(seq 1 (\d+)\); do/);
  assert.ok(loop, "expected the web PRIMARY-deployment stability poll loop");
  const iterations = Number(loop[1]);
  const budgetMin = (iterations * 15) / 60; // the loop sleeps 15s per iteration

  // minHealthy=100 leaves exactly one spare slot, so ECS replaces tasks serially. Each cycle is a
  // task start + image pull + Next boot + ALB health checks + the old task's 30s deregistration
  // drain — call it ~2 min. Anything less than that x desiredCount red-fails healthy deploys.
  const serialRoll = web.minimumHealthyPercent >= 100;
  const minutesNeeded = serialRoll ? WEB_MAX_TASKS * 2 : 12;
  assert.ok(
    budgetMin >= minutesNeeded,
    `stability poll budget is ${budgetMin} min (${iterations} x 15s) but a serial roll of ` +
      `${WEB_MAX_TASKS} tasks needs ~${minutesNeeded} min; a short budget red-fails healthy ` +
      `deploys AND aborts the job before the Cloudflare purge / static-asset / worker steps run`,
  );
});
