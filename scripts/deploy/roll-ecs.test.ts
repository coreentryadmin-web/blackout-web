// Unit tests for the PURE helpers behind scripts/deploy/roll-ecs.mjs.
// Table-driven, no network, no aws CLI, no filesystem.
// Run: npx tsx --test scripts/deploy/roll-ecs.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  READ_ONLY_TASKDEF_FIELDS,
  assertDeploymentConfigSane,
  buildImageUri,
  deriveSecretArn,
  dropReadOnlyTaskDefFields,
  evaluateStability,
  resolveImageTag,
  rewriteImage,
  stripStaleSecretRefs,
  // @ts-expect-error — untyped .mjs sibling
} from "./lib/taskdef-rewrite.mjs";

// @ts-expect-error — untyped .mjs sibling
import { parseArgs, servicesFor } from "./roll-ecs.mjs";

const SECRET_ARN = "arn:aws:secretsmanager:us-east-1:177922194517:secret:blackout-production/app/env-sjdvhV";

/** Shape lifted from the live `blackout-production-web:577` task definition (2026-08-06). */
function liveWebTaskDef() {
  return {
    taskDefinitionArn: "arn:aws:ecs:us-east-1:177922194517:task-definition/blackout-production-web:577",
    family: "blackout-production-web",
    revision: 577,
    status: "ACTIVE",
    cpu: "2048",
    memory: "4096",
    requiresAttributes: [{ name: "ecs.capability.execution-role-awslogs" }],
    compatibilities: ["EC2", "FARGATE"],
    registeredAt: "2026-08-05T12:00:00Z",
    registeredBy: "arn:aws:iam::177922194517:user/vinay-blackout",
    taskRoleArn: "arn:aws:iam::177922194517:role/blackout-production-ecs-task",
    executionRoleArn: "arn:aws:iam::177922194517:role/blackout-production-ecs-execution",
    containerDefinitions: [
      {
        name: "blackout-web",
        image: "177922194517.dkr.ecr.us-east-1.amazonaws.com/blackout-web:0f39b85f7ad29735ebcc56858180fe904cf0c05e",
        secrets: [
          { name: "DATABASE_URL", valueFrom: `${SECRET_ARN}:DATABASE_URL::` },
          { name: "REDIS_URL", valueFrom: `${SECRET_ARN}:REDIS_URL::` },
          { name: "NEXT_PUBLIC_WHOP_CHECKOUT_LIFETIME", valueFrom: `${SECRET_ARN}:NEXT_PUBLIC_WHOP_CHECKOUT_LIFETIME::` },
        ],
      },
    ],
  };
}

// ---------------------------------------------------------------------------------------------
// resolveImageTag — the ":latest is not a deploy target" rule
// ---------------------------------------------------------------------------------------------

test("resolveImageTag: table", () => {
  const cases: Array<[string, unknown, boolean, boolean]> = [
    // label,                        tag,                            force, expected ok
    ["full git SHA", "0f39b85f7ad29735ebcc56858180fe904cf0c05e", false, true],
    ["short git SHA", "0f39b85", false, true],
    ["bare latest refused", "latest", false, false],
    ["LATEST refused case-insensitively", "LATEST", false, false],
    ["latest allowed under --force", "latest", true, true],
    ["non-SHA refused", "release-2026-08-06", false, false],
    ["non-SHA allowed under --force", "release-2026-08-06", true, true],
    ["uppercase hex is not a git SHA", "0F39B85", false, false],
    ["missing tag", null, false, false],
    ["missing tag even with --force", null, true, false],
    ["empty tag", "", false, false],
    ["whitespace tag", "   ", false, false],
    ["shell metacharacters refused even with --force", "abc123; rm -rf /", true, false],
    ["slash refused even with --force", "repo/abc1234", true, false],
    ["6 hex is too short for a SHA", "0f39b8", false, false],
  ];
  for (const [label, tag, force, expected] of cases) {
    const got = resolveImageTag({ tag, force });
    assert.equal(got.ok, expected, `${label}: expected ok=${expected}, got ${JSON.stringify(got)}`);
    if (!got.ok) assert.ok(got.error.length > 10, `${label}: needs a readable error`);
  }
});

test("resolveImageTag: --force on :latest still warns loudly", () => {
  const got = resolveImageTag({ tag: "latest", force: true });
  assert.equal(got.ok, true);
  assert.equal(got.warnings.length, 1);
  assert.match(got.warnings[0], /MUTABLE/);
});

test("resolveImageTag: refusing :latest explains WHY (hand-repointed), not just 'no'", () => {
  const got = resolveImageTag({ tag: "latest", force: false });
  assert.equal(got.ok, false);
  assert.match(got.error, /repointed by hand/);
});

test("buildImageUri: composes and requires all three parts", () => {
  assert.equal(
    buildImageUri({ registry: "177922194517.dkr.ecr.us-east-1.amazonaws.com", repository: "blackout-web", tag: "abc1234" }),
    "177922194517.dkr.ecr.us-east-1.amazonaws.com/blackout-web:abc1234",
  );
  // trailing slash on the registry does not produce a double slash
  assert.equal(buildImageUri({ registry: "reg/", repository: "r", tag: "t" }), "reg/r:t");
  for (const bad of [
    { registry: "", repository: "r", tag: "t" },
    { registry: "reg", repository: "", tag: "t" },
    { registry: "reg", repository: "r", tag: "" },
  ]) {
    assert.throws(() => buildImageUri(bad), /required/);
  }
});

// ---------------------------------------------------------------------------------------------
// rewriteImage
// ---------------------------------------------------------------------------------------------

test("rewriteImage: repoints every container and does not mutate the input", () => {
  const td = liveWebTaskDef();
  const before = JSON.stringify(td);
  const uri = "177922194517.dkr.ecr.us-east-1.amazonaws.com/blackout-web:cafebabe1234567";
  const { taskDef, changes } = rewriteImage(td, uri);
  assert.equal(taskDef.containerDefinitions[0].image, uri);
  assert.deepEqual(changes, [
    {
      container: "blackout-web",
      from: "177922194517.dkr.ecr.us-east-1.amazonaws.com/blackout-web:0f39b85f7ad29735ebcc56858180fe904cf0c05e",
      to: uri,
    },
  ]);
  assert.equal(JSON.stringify(td), before, "input task def must not be mutated");
});

test("rewriteImage: multi-container task defs get every image repointed", () => {
  const td = { containerDefinitions: [{ name: "a", image: "x:1" }, { name: "b", image: "y:2" }] };
  const { taskDef, changes } = rewriteImage(td, "z:3");
  assert.deepEqual(taskDef.containerDefinitions.map((c: { image: string }) => c.image), ["z:3", "z:3"]);
  assert.equal(changes.length, 2);
});

test("rewriteImage: refuses an imageless task def or an empty uri", () => {
  assert.throws(() => rewriteImage({ containerDefinitions: [] }, "x:1"), /no containerDefinitions/);
  assert.throws(() => rewriteImage({}, "x:1"), /no containerDefinitions/);
  assert.throws(() => rewriteImage(liveWebTaskDef(), ""), /imageUri is required/);
});

// ---------------------------------------------------------------------------------------------
// deriveSecretArn
// ---------------------------------------------------------------------------------------------

test("deriveSecretArn: table", () => {
  // Live valueFrom format: arn:...:secret:<name>-<suffix>:<KEY>::  — strip the last 3 segments.
  assert.equal(deriveSecretArn(liveWebTaskDef()), SECRET_ARN);

  // First container has no secrets: the workflow's python would give up here; this scans on.
  assert.equal(
    deriveSecretArn({
      containerDefinitions: [{ name: "sidecar" }, { name: "app", secrets: [{ name: "K", valueFrom: `${SECRET_ARN}:K::` }] }],
    }),
    SECRET_ARN,
  );

  // No secrets anywhere.
  assert.equal(deriveSecretArn({ containerDefinitions: [{ name: "a" }] }), null);
  assert.equal(deriveSecretArn({}), null);
  assert.equal(deriveSecretArn(null), null);

  // An SSM-parameter valueFrom is not a Secrets Manager ARN and must not be mistaken for one.
  assert.equal(
    deriveSecretArn({
      containerDefinitions: [{ secrets: [{ name: "K", valueFrom: "arn:aws:ssm:us-east-1:177922194517:parameter/foo" }] }],
    }),
    null,
  );
});

// ---------------------------------------------------------------------------------------------
// stripStaleSecretRefs
// ---------------------------------------------------------------------------------------------

test("stripStaleSecretRefs: drops refs whose key left Secrets Manager", () => {
  const td = liveWebTaskDef();
  const { taskDef, stripped } = stripStaleSecretRefs(td, ["DATABASE_URL", "REDIS_URL", "POLYGON_API_KEY"]);
  assert.deepEqual(taskDef.containerDefinitions[0].secrets.map((s: { name: string }) => s.name), ["DATABASE_URL", "REDIS_URL"]);
  assert.deepEqual(stripped, [{ container: "blackout-web", name: "NEXT_PUBLIC_WHOP_CHECKOUT_LIFETIME" }]);
  // input untouched
  assert.equal(td.containerDefinitions[0].secrets.length, 3);
});

test("stripStaleSecretRefs: accepts a Set as well as an array", () => {
  const { stripped } = stripStaleSecretRefs(liveWebTaskDef(), new Set(["DATABASE_URL", "REDIS_URL"]));
  assert.equal(stripped.length, 1);
});

test("stripStaleSecretRefs: nothing to strip is a clean no-op", () => {
  const { taskDef, stripped } = stripStaleSecretRefs(liveWebTaskDef(), [
    "DATABASE_URL",
    "REDIS_URL",
    "NEXT_PUBLIC_WHOP_CHECKOUT_LIFETIME",
  ]);
  assert.equal(stripped.length, 0);
  assert.equal(taskDef.containerDefinitions[0].secrets.length, 3);
});

test("stripStaleSecretRefs: REFUSES an empty valid-key set (would strip every secret)", () => {
  // The fail-closed guard the workflow lacks: filtering against zero keys would register a task
  // definition with no environment at all — a total outage that looks like a successful deploy.
  assert.throws(() => stripStaleSecretRefs(liveWebTaskDef(), []), /EMPTY valid-key set/);
  assert.throws(() => stripStaleSecretRefs(liveWebTaskDef(), new Set()), /EMPTY valid-key set/);
  assert.throws(() => stripStaleSecretRefs(liveWebTaskDef(), null), /EMPTY valid-key set/);
});

test("stripStaleSecretRefs: containers without secrets[] are left alone", () => {
  const { taskDef } = stripStaleSecretRefs({ containerDefinitions: [{ name: "sidecar" }] }, ["K"]);
  assert.equal("secrets" in taskDef.containerDefinitions[0], false);
});

// ---------------------------------------------------------------------------------------------
// dropReadOnlyTaskDefFields
// ---------------------------------------------------------------------------------------------

test("dropReadOnlyTaskDefFields: removes exactly the register-rejected fields, keeps the rest", () => {
  const out = dropReadOnlyTaskDefFields(liveWebTaskDef());
  for (const k of READ_ONLY_TASKDEF_FIELDS) assert.equal(k in out, false, `${k} must be dropped`);
  for (const k of ["family", "cpu", "memory", "taskRoleArn", "executionRoleArn", "containerDefinitions"]) {
    assert.equal(k in out, true, `${k} must be preserved`);
  }
  assert.equal(out.taskRoleArn, "arn:aws:iam::177922194517:role/blackout-production-ecs-task");
});

// ---------------------------------------------------------------------------------------------

// ---------------------------------------------------------------------------------------------
// The GitHub Actions workflow is a FOURTH declaration of the deployment window, independent of
// terraform's three (tfvars + root variables.tf + module variables.tf). Nothing reconciles them:
// the workflow stamps its literal onto the live service on every deploy, so whatever it says wins
// regardless of what terraform declares. That is not hypothetical — the workflow carried
// `minimumHealthyPercent=50,maximumPercent=112` from d8b8ea44 until 84ca8e96 (2026-08-06), and
// CloudTrail shows it re-writing 50/112 onto prod web on every deploy that whole time while
// terraform said 100/120. The guard below is the only thing that can catch that drift from inside
// this repo, since terraform lives in blackout-infra and a test cannot read across repos.
//
// It deliberately reuses assertDeploymentConfigSane — the same evaluator that judges the LIVE
// service — so the workflow's declared values are held to exactly the standard a live config is.
// ---------------------------------------------------------------------------------------------

const WORKFLOW = ".github/workflows/ecr-push-production.yml";

/** Every `--deployment-configuration "..."` literal in the deploy workflow, parsed. */
function workflowDeploymentConfigs(): { min: number; max: number; raw: string }[] {
  const src = readFileSync(WORKFLOW, "utf8");
  const out: { min: number; max: number; raw: string }[] = [];
  for (const m of src.matchAll(/--deployment-configuration\s+"([^"]+)"/g)) {
    const raw = m[1];
    const min = Number(/minimumHealthyPercent=(\d+)/.exec(raw)?.[1]);
    const max = Number(/maximumPercent=(\d+)/.exec(raw)?.[1]);
    out.push({ min, max, raw });
  }
  return out;
}

test("deploy workflow declares a deployment window at all", () => {
  const cfgs = workflowDeploymentConfigs();
  assert.ok(cfgs.length >= 1, `no --deployment-configuration found in ${WORKFLOW}`);
  for (const c of cfgs) {
    assert.ok(Number.isFinite(c.min) && Number.isFinite(c.max), `unparseable window: ${c.raw}`);
    assert.match(c.raw, /deploymentCircuitBreaker=\{enable=true,rollback=true\}/, `circuit breaker not armed: ${c.raw}`);
  }
});

test("deploy workflow's WEB window survives assertDeploymentConfigSane across the autoscaling range", () => {
  // blackout-production-web autoscales desired 5..12. The workflow's literal is applied to the
  // live service, so it must be sane at EVERY desired count the autoscaler can reach — not just
  // the count that happens to be live when someone edits it. 100/112 passes at no count in this
  // range (floor(d * 1.12) == d for 5..8), which is precisely the deadlock that shipped before.
  const web = workflowDeploymentConfigs().find((c) => c.min >= 100 || c.min === 50);
  assert.ok(web, "no web-shaped deployment window found");
  for (let desired = 5; desired <= 12; desired++) {
    const r = assertDeploymentConfigSane({
      serviceName: "blackout-production-web",
      desiredCount: desired,
      deploymentConfiguration: {
        deploymentCircuitBreaker: CB_OK,
        minimumHealthyPercent: web!.min,
        maximumPercent: web!.max,
      },
    });
    assert.equal(r.ok, true, `workflow window ${web!.min}/${web!.max} FAILS at desiredCount=${desired}: ${r.failures.join(" ")}`);
  }
});

test("deploy workflow's WEB window is a zero-capacity-loss roll", () => {
  // The regression that actually shipped was not a deadlock — 50/112 is "sane" by the headroom
  // test — it was a 40% capacity drain on every deploy, silent for months. Pin min>=100 so a
  // future edit back toward 50 fails here instead of on the live service.
  const web = workflowDeploymentConfigs().find((c) => c.min >= 100 || c.min === 50);
  assert.ok(web, "no web-shaped deployment window found");
  assert.ok(
    web!.min >= 100,
    `workflow sets minimumHealthyPercent=${web!.min}: the roll drains capacity on every deploy. ` +
      `100 keeps full capacity (see the 2026-08-06 50/112 drift entry in docs/audit/FINDINGS.md).`,
  );
});

// assertDeploymentConfigSane — the read-print-assert-never-write guard
// ---------------------------------------------------------------------------------------------

const CB_OK = { enable: true, rollback: true };

function svc(over: Record<string, unknown> = {}) {
  return {
    serviceName: "blackout-production-web",
    desiredCount: 5,
    deploymentConfiguration: { deploymentCircuitBreaker: CB_OK, minimumHealthyPercent: 100, maximumPercent: 120 },
    ...over,
  };
}

test("assertDeploymentConfigSane: the LIVE 2026-08-06 configs both pass", () => {
  // web: desired 5, 100/120 -> floor(5 * 1.20) = 6 = one spare slot -> serial replacement, OK.
  const web = assertDeploymentConfigSane(svc());
  assert.equal(web.ok, true, JSON.stringify(web.failures));
  assert.match(web.notes.join(" "), /SERIAL replacement/);

  // market-worker: desired 2, 0/200 -> minHealthy below 100, headroom check does not apply.
  const worker = assertDeploymentConfigSane({
    serviceName: "blackout-production-market-worker",
    desiredCount: 2,
    deploymentConfiguration: { deploymentCircuitBreaker: CB_OK, minimumHealthyPercent: 0, maximumPercent: 200 },
  });
  assert.equal(worker.ok, true, JSON.stringify(worker.failures));
});

test("assertDeploymentConfigSane: min<100 on a multi-task service NOTES the capacity loss, never fails", () => {
  // The exact config prod web drifted to on 2026-08-06 (written by the pre-84ca8e96 workflow):
  // 50/112 at desired 5 drains to ceil(5 * 0.50) = 3, i.e. 40% capacity loss for the whole roll.
  // It is NOT a deadlock, so it must stay ok:true — the old guard therefore said nothing at all,
  // which is how it sat unnoticed on a service already emitting ~10k 504s/day.
  const drifted = assertDeploymentConfigSane(
    svc({ deploymentConfiguration: { deploymentCircuitBreaker: CB_OK, minimumHealthyPercent: 50, maximumPercent: 112 } }),
  );
  assert.equal(drifted.ok, true, "min<100 is degraded, not broken — must not fail the deploy");
  assert.match(drifted.notes.join(" "), /drain to 3 of 5/);
  assert.match(drifted.notes.join(" "), /40% capacity loss/);
});

test("assertDeploymentConfigSane: a single-task service at min=0 loses 100% but is still only a note", () => {
  // desired 1 / min 0 is REQUIRED (min!=0 at desired 1 deadlocks, asserted elsewhere), so the
  // note must not read as a problem to fix — it is the only legal config for a 1-task service.
  const one = assertDeploymentConfigSane({
    serviceName: "solo",
    desiredCount: 1,
    deploymentConfiguration: { deploymentCircuitBreaker: CB_OK, minimumHealthyPercent: 0, maximumPercent: 200 },
  });
  assert.equal(one.ok, true, JSON.stringify(one.failures));
  assert.match(one.notes.join(" "), /drain to 0 of 1/);
});

test("assertDeploymentConfigSane: min=100 emits NO capacity-loss note (zero-loss roll)", () => {
  const clean = assertDeploymentConfigSane(svc());
  assert.equal(clean.notes.some((n: string) => /capacity loss/.test(n)), false);
});

test("assertDeploymentConfigSane: 100/112 is the known deadlock and must FAIL across 5..8", () => {
  // floor(5 * 1.12) = 5, floor(6 * 1.12) = 6, floor(7 * 1.12) = 7, floor(8 * 1.12) = 8 — zero
  // spare slots, so the roll can never start a replacement task. This is the exact arithmetic
  // that motivated raising maximumPercent to 120.
  for (const desired of [5, 6, 7, 8]) {
    const r = assertDeploymentConfigSane(
      svc({ desiredCount: desired, deploymentConfiguration: { deploymentCircuitBreaker: CB_OK, minimumHealthyPercent: 100, maximumPercent: 112 } }),
    );
    assert.equal(r.ok, false, `desired=${desired} with 100/112 must fail`);
    assert.match(r.failures.join(" "), /NO spare slot/);
  }
  // …but 9..12 happen to clear it (floor(9 * 1.12) = 10), which is exactly why the bug was
  // intermittent and hard to spot.
  for (const desired of [9, 10, 11, 12]) {
    const r = assertDeploymentConfigSane(
      svc({ desiredCount: desired, deploymentConfiguration: { deploymentCircuitBreaker: CB_OK, minimumHealthyPercent: 100, maximumPercent: 112 } }),
    );
    assert.equal(r.ok, true, `desired=${desired} with 100/112 has headroom`);
  }
});

test("assertDeploymentConfigSane: 100/120 clears the whole 5..12 autoscaling range", () => {
  for (let desired = 5; desired <= 12; desired += 1) {
    assert.equal(assertDeploymentConfigSane(svc({ desiredCount: desired })).ok, true, `desired=${desired}`);
  }
});

test("assertDeploymentConfigSane: a 1-task service with minHealthy>0 deadlocks", () => {
  const bad = assertDeploymentConfigSane(
    svc({ desiredCount: 1, deploymentConfiguration: { deploymentCircuitBreaker: CB_OK, minimumHealthyPercent: 100, maximumPercent: 200 } }),
  );
  assert.equal(bad.ok, false);
  assert.match(bad.failures.join(" "), /DEADLOCKS/);

  const good = assertDeploymentConfigSane(
    svc({ desiredCount: 1, deploymentConfiguration: { deploymentCircuitBreaker: CB_OK, minimumHealthyPercent: 0, maximumPercent: 200 } }),
  );
  assert.equal(good.ok, true, JSON.stringify(good.failures));
});

test("assertDeploymentConfigSane: circuit breaker must be enabled AND rolling back", () => {
  const cases: Array<[unknown, boolean]> = [
    [{ enable: true, rollback: true }, true],
    [{ enable: true, rollback: false }, false],
    [{ enable: false, rollback: true }, false],
    [{}, false],
    [undefined, false],
  ];
  for (const [cb, ok] of cases) {
    const r = assertDeploymentConfigSane(
      svc({ deploymentConfiguration: { deploymentCircuitBreaker: cb, minimumHealthyPercent: 100, maximumPercent: 120 } }),
    );
    assert.equal(r.ok, ok, `circuit breaker ${JSON.stringify(cb)}`);
  }
});

test("assertDeploymentConfigSane: degenerate inputs fail closed, never throw", () => {
  assert.equal(assertDeploymentConfigSane({}).ok, false);
  assert.equal(assertDeploymentConfigSane(null).ok, false);
  assert.equal(
    assertDeploymentConfigSane(svc({ deploymentConfiguration: { deploymentCircuitBreaker: CB_OK, minimumHealthyPercent: "x", maximumPercent: 120 } }))
      .ok,
    false,
  );
  // desiredCount 0 = nothing to roll; headroom is not a failure, just a note.
  const zero = assertDeploymentConfigSane(svc({ desiredCount: 0 }));
  assert.equal(zero.ok, true);
  assert.match(zero.notes.join(" "), /nothing to roll/);
});

test("assertDeploymentConfigSane: tolerates the newer ECS deploymentConfiguration fields", () => {
  // Live describe-services now returns strategy/bakeTimeInMinutes/resetOnHealthyTask/threshold —
  // unknown extras must not upset the assertion (and this tool never writes the config back).
  const r = assertDeploymentConfigSane(
    svc({
      deploymentConfiguration: {
        deploymentCircuitBreaker: { ...CB_OK, resetOnHealthyTask: true, thresholdConfiguration: { type: "BOUNDED_PERCENT", value: 50 } },
        minimumHealthyPercent: 100,
        maximumPercent: 120,
        strategy: "ROLLING",
        bakeTimeInMinutes: 0,
      },
    }),
  );
  assert.equal(r.ok, true, JSON.stringify(r.failures));
});

// ---------------------------------------------------------------------------------------------
// evaluateStability — PRIMARY-deployment-only poller verdicts
// ---------------------------------------------------------------------------------------------

test("evaluateStability: table", () => {
  const cases: Array<[string, unknown, string]> = [
    ["rolloutState COMPLETED wins outright", { rolloutState: "COMPLETED", runningCount: 3, desiredCount: 5 }, "COMPLETED"],
    ["rolloutState FAILED wins outright", { rolloutState: "FAILED", runningCount: 5, desiredCount: 5 }, "FAILED"],
    ["running == desired is complete", { rolloutState: "IN_PROGRESS", runningCount: 5, desiredCount: 5 }, "COMPLETED"],
    ["mid-roll is pending", { rolloutState: "IN_PROGRESS", runningCount: 2, desiredCount: 5 }, "PENDING"],
    ["0/0 is NOT complete (guards the desired!=0 clause)", { rolloutState: "IN_PROGRESS", runningCount: 0, desiredCount: 0 }, "PENDING"],
    ["no PRIMARY yet", null, "PENDING"],
    ["missing counts", { rolloutState: "IN_PROGRESS" }, "PENDING"],
  ];
  for (const [label, primary, expected] of cases) {
    assert.equal(evaluateStability(primary).verdict, expected, label);
  }
});

test("evaluateStability: FAILED surfaces the ECS reason for the operator", () => {
  const r = evaluateStability({ rolloutState: "FAILED", rolloutStateReason: "circuit breaker tripped", runningCount: 0, desiredCount: 5 });
  assert.equal(r.verdict, "FAILED");
  assert.match(r.detail, /circuit breaker/);
});

// ---------------------------------------------------------------------------------------------
// CLI surface
// ---------------------------------------------------------------------------------------------

test("parseArgs: flags, --k=v form, and unknown-argument rejection", () => {
  const a = parseArgs(["--tag", "abc1234", "--service", "all", "--wait", "--purge", "--validate", "--dry-run", "--force"]);
  assert.deepEqual(
    { tag: a.tag, service: a.service, wait: a.wait, purge: a.purge, validate: a.validate, dryRun: a.dryRun, force: a.force, errors: a.errors },
    { tag: "abc1234", service: "all", wait: true, purge: true, validate: true, dryRun: true, force: true, errors: [] },
  );

  const b = parseArgs(["--tag=abc1234", "--service=worker"]);
  assert.equal(b.tag, "abc1234");
  assert.equal(b.service, "worker");
  assert.equal(b.errors.length, 0);

  // defaults: nothing mutating happens unless asked for
  const c = parseArgs(["--tag", "abc1234"]);
  assert.deepEqual({ service: c.service, wait: c.wait, purge: c.purge, validate: c.validate, dryRun: c.dryRun, force: c.force }, {
    service: "web",
    wait: false,
    purge: false,
    validate: false,
    dryRun: false,
    force: false,
  });

  assert.match(parseArgs(["--deployment-configuration", "x"]).errors.join(" "), /Unknown argument/);
  assert.match(parseArgs(["--service", "prod"]).errors.join(" "), /web\|worker\|all/);
});

test("servicesFor: allowlisted targets, web ALWAYS before worker", () => {
  assert.deepEqual(servicesFor("web").map((s: { name: string }) => s.name), ["blackout-production-web"]);
  assert.deepEqual(servicesFor("worker").map((s: { name: string }) => s.name), ["blackout-production-market-worker"]);
  // Ordering is load-bearing: web -> purge -> validate -> worker.
  assert.deepEqual(servicesFor("all").map((s: { name: string }) => s.name), [
    "blackout-production-web",
    "blackout-production-market-worker",
  ]);
});

// ── THE DEPLOY PURGE MUST NEVER EVICT HASHED BUILD ASSETS (2026-08-18) ───────────────────────
// `purge_everything` after each rollout was manufacturing a member-visible outage it could not
// recover from: hashed chunks got evicted, every client re-fetched them from an origin that was a
// MIX of old and new ECS tasks mid-rollout, the mismatched request 404'd, Next served that 404 as
// `text/plain`, the browser refused to execute it, and HYDRATION NEVER COMPLETED — leaving every
// client component frozen in its loading state with no error and no retry.
//
// Observed on prod: "Loading chart…" / "Loading 0dte matrix…" / "Connecting Live Helix…" all stuck
// at once with 84/84 network requests SUCCEEDING, console carrying `Refused to execute script …
// because its MIME type ('text/plain') is not executable`. The same URL returned 200 / HIT ~8
// minutes later once the edge re-cached it, which is why it read as intermittent.
//
// Source-level because the purge is a network call inside a deploy script — the property worth
// protecting is "this code cannot ask Cloudflare to drop immutable assets", and that IS visible in
// the source.

const ROLL_ECS_SRC = readFileSync("scripts/deploy/roll-ecs.mjs", "utf8");
const PROD_WORKFLOW_SRC = readFileSync(".github/workflows/ecr-push-production.yml", "utf8");

test("the deploy never issues purge_everything", () => {
  for (const [name, src] of [
    ["roll-ecs.mjs", ROLL_ECS_SRC],
    ["ecr-push-production.yml", PROD_WORKFLOW_SRC],
  ] as const) {
    // Allow the string inside explanatory comments; forbid it as an actual request body.
    const asPayload = /purge_everything["']?\s*[:=]\s*true/.test(src);
    assert.equal(asPayload, false, `${name} must not send purge_everything`);
  }
});

test("the purge targets HTML routes only — never /_next/static", () => {
  assert.match(ROLL_ECS_SRC, /PURGE_HTML_URLS/, "purge must go through the explicit URL list");
  assert.doesNotMatch(
    ROLL_ECS_SRC,
    /purge_cache[\s\S]{0,400}_next\/static/,
    "hashed build assets must never appear in a purge payload"
  );
  assert.doesNotMatch(
    PROD_WORKFLOW_SRC,
    /--data '\{"files":\[[^\]]*_next\/static/,
    "hashed build assets must never appear in a purge payload"
  );
});

test("the purge list is non-empty and every entry is an absolute prod URL", () => {
  // A purge of nothing would leave edge-cached HTML pointing at the previous build — the opposite
  // failure, and just as member-visible.
  const list = ROLL_ECS_SRC.match(/const PURGE_HTML_URLS = \[([\s\S]*?)\];/);
  assert.ok(list, "PURGE_HTML_URLS must be declared");
  const urls = [...list[1]!.matchAll(/"([^"]+)"/g)].map((m) => m[1]!);
  assert.ok(urls.length > 0, "purge list must not be empty");
  for (const u of urls) {
    assert.match(u, /^https:\/\/blackouttrades\.com\//, `${u} must be an absolute prod URL`);
    assert.doesNotMatch(u, /_next/, `${u} must not be a build asset`);
  }
});
