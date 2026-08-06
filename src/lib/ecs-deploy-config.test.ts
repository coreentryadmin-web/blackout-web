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
/** blackout-production-web task size (2048 CPU units). */
const WEB_TASK_VCPU = 2;
/**
 * blackout-production-market-worker, which competes for the same account quota: desiredCount=2 at
 * 1024 CPU units (1 vCPU) each. Verified live 2026-08-06 — do NOT assume a singleton, that premise
 * was wrong once already.
 */
const WORKER_TASKS = 2;
const WORKER_TASK_VCPU = 1;
const WORKER_VCPU = WORKER_TASKS * WORKER_TASK_VCPU;
/**
 * Application Auto Scaling bounds on the web service, verified live 2026-08-06:
 *   aws application-autoscaling describe-scalable-targets \
 *     --resource-ids service/blackout-production-cluster/blackout-production-web
 *   → { MinCapacity: 5, MaxCapacity: 12 }
 *
 * The FLOOR is the binding constraint on maximumPercent and is easy to get wrong: an earlier
 * revision of this file assumed 8 and picked a maximumPercent (115) that deadlocks at 5 and 6.
 * desired=5 is where the service sits overnight and at weekends — exactly where unattended deploys
 * land. Keep these in sync with the scalable target.
 */
const WEB_MIN_TASKS = 5;
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

// THE assertion that matters: sweep EVERY task count the autoscaler can hold, not a spot check.
// A config can be perfectly valid at the counts you happen to think of and still deadlock at the
// floor — maximumPercent=115 clears desired=8 and desired=12 but hangs at 5 and 6.
test("web rolling deploy can make progress at EVERY task count in the autoscaling range", () => {
  const [web] = deployConfigs();
  const deadlocked: number[] = [];
  const noSpareSlot: number[] = [];

  for (let desired = WEB_MIN_TASKS; desired <= WEB_MAX_TASKS; desired++) {
    const ceiling = ceilingTasks(desired, web.maximumPercent);
    const floor = healthyFloorTasks(desired, web.minimumHealthyPercent);
    const canAdd = ceiling > desired;
    const canRemove = floor < desired;
    if (!canAdd && !canRemove) deadlocked.push(desired);
    // Under minHealthy=100 the spare slot is the ONLY legal way forward — ECS may not free one by
    // stopping a task first — so require it at every count, not merely "some way to progress".
    if (web.minimumHealthyPercent >= 100 && !canAdd) noSpareSlot.push(desired);
  }

  assert.deepEqual(
    deadlocked,
    [],
    `DEADLOCK at desiredCount=${JSON.stringify(deadlocked)} with ` +
      `minimumHealthyPercent=${web.minimumHealthyPercent}/maximumPercent=${web.maximumPercent}: ` +
      `ceiling equals desiredCount and minimum healthy equals desiredCount, so ECS can neither ` +
      `start a replacement nor stop an old task and the deploy hangs until the poller times out. ` +
      `Solve floor(d * max/100) >= d + 1 across d in [${WEB_MIN_TASKS},${WEB_MAX_TASKS}] — the ` +
      `FLOOR binds: floor(5*1.15)=5 deadlocks, floor(5*1.20)=6 does not.`,
  );
  assert.deepEqual(
    noSpareSlot,
    [],
    `maximumPercent=${web.maximumPercent} grants no spare task slot at ` +
      `desiredCount=${JSON.stringify(noSpareSlot)}; with minimumHealthyPercent=100 the roll needs ` +
      `floor(desired * max/100) >= desired + 1 at every count in the autoscaling range`,
  );
});

// There are TWO different peaks at the autoscaling maximum and they have different obligations.
//
//  * REQUIRED peak — desiredCount + 1 tasks. This is the minimum concurrency the roll needs to make
//    progress under minHealthy=100, so it MUST fit under the quota with room to spare. If it does
//    not, the deploy cannot schedule its own replacement.
//  * PERMITTED peak — the full maximumPercent ceiling. Landing this exactly ON the quota is
//    acceptable: the slots above desiredCount+1 are optional headroom, so if the quota blocks their
//    placement the roll still completes at the required peak. Exceeding the quota is not, since the
//    scheduler would then be fighting a limit it can never satisfy.
test("the web roll's REQUIRED concurrency fits under the vCPU quota with headroom", () => {
  const requiredTasks = WEB_MAX_TASKS + 1;
  const requiredVcpu = requiredTasks * WEB_TASK_VCPU + WORKER_VCPU;
  assert.ok(
    requiredVcpu <= VCPU_QUOTA,
    `a roll at desiredCount=${WEB_MAX_TASKS} needs ${requiredTasks} concurrent web tasks ` +
      `(${requiredTasks * WEB_TASK_VCPU} vCPU) + worker ${WORKER_VCPU} vCPU = ${requiredVcpu} vCPU, ` +
      `over the ${VCPU_QUOTA} vCPU quota (L-3032A538) — the deploy could never schedule its own ` +
      `replacement task`,
  );
  assert.ok(
    VCPU_QUOTA - requiredVcpu >= WEB_TASK_VCPU,
    `required roll concurrency ${requiredVcpu} vCPU leaves under one task of headroom beneath the ` +
      `${VCPU_QUOTA} vCPU quota — too tight to absorb any other Fargate task in the account`,
  );
});

test("the web maximumPercent ceiling never demands more vCPU than the quota allows", () => {
  const [web] = deployConfigs();
  const peakTasks = ceilingTasks(WEB_MAX_TASKS, web.maximumPercent);
  const peakVcpu = peakTasks * WEB_TASK_VCPU + WORKER_VCPU;
  assert.ok(
    peakVcpu <= VCPU_QUOTA,
    `maximumPercent=${web.maximumPercent} permits ${peakTasks} web tasks at ` +
      `desiredCount=${WEB_MAX_TASKS} (${peakTasks * WEB_TASK_VCPU} vCPU) + worker ${WORKER_VCPU} ` +
      `vCPU = ${peakVcpu} vCPU, over the ${VCPU_QUOTA} vCPU quota (L-3032A538). Lower ` +
      `maximumPercent, or raise VCPU_QUOTA once AWS grants the increase.`,
  );
});

test("market-worker keeps leader-election deploy semantics (minimumHealthyPercent=0)", () => {
  const [, worker] = deployConfigs();
  assert.equal(
    worker.minimumHealthyPercent,
    0,
    "blackout-production-market-worker's capacity is NOT additive: exactly one replica holds each " +
      "upstream WebSocket at a time via a fenced Redis SETNX lock, because both upstreams allow " +
      "one live socket per API key (uw-socket.ts / polygon-socket.ts). minimumHealthyPercent " +
      "therefore buys this tier nothing — Redis arbitrates the leader, not the ECS task count — " +
      "while forcing overlap makes failover SLOWER: the incoming task loses the SETNX and idles a " +
      "full 15s reconcile tick. Deliberately NOT symmetric with the web service.",
  );
  assert.ok(
    worker.maximumPercent >= 100,
    "worker maximumPercent must allow at least one replacement task",
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
