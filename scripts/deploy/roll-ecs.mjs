#!/usr/bin/env node
/**
 * roll-ecs.mjs — roll a production ECS service onto an already-built ECR image, from ANY machine
 * that holds AWS credentials. The deploy, extracted out of `.github/workflows/ecr-push-production.yml`
 * and turned into a first-class, tested artifact.
 *
 * WHY THIS EXISTS
 * ---------------
 * The production deploy was never GitHub-locked. Steps 5-8 of `ecr-push-production.yml` are plain
 * `aws ecs describe-services / describe-task-definition / register-task-definition / update-service`,
 * an inline `python3` task-def rewrite, a curl to Cloudflare, and `node scripts/validate-static-assets.mjs`.
 * Every one of those runs from a laptop, from CodeBuild, or from an agent sandbox. They were locked
 * in by FORM, not capability — the code existed nowhere except inside a YAML file, so only a GitHub
 * runner could execute it. During the 2026-08-06 GitHub Actions `major_outage` that meant there was
 * no way to roll ECS at all, on an open-market day, with a live members' desk on the cluster.
 * This script is the same logic, ported faithfully, runnable anywhere, with its decision-making in
 * pure functions that have tests (`scripts/deploy/lib/taskdef-rewrite.mjs`, `roll-ecs.test.ts`).
 *
 * It BUILDS nothing. The image must already be in ECR (GitHub Actions or the CodeBuild project
 * `blackout-web-image-build` both push there). This is the rollout half only.
 *
 * USAGE
 *   node scripts/deploy/roll-ecs.mjs --tag <sha> [--service web|worker|all] [--wait]
 *                                    [--purge] [--validate] [--dry-run] [--force]
 *
 *   # what a full production deploy looks like:
 *   node scripts/deploy/roll-ecs.mjs --tag <sha> --service all --wait --purge --validate
 *
 *   # ALWAYS rehearse first — --dry-run is read-only (describe/get calls only):
 *   node scripts/deploy/roll-ecs.mjs --tag <sha> --service all --dry-run
 *
 * In this sandbox the placeholder AWS_ACCESS_KEY_ID/AWS_SECRET_ACCESS_KEY env vars override
 * ~/.aws/credentials, so every invocation needs `env -u AWS_ACCESS_KEY_ID -u AWS_SECRET_ACCESS_KEY`.
 * See docs/ops/DEPLOY-WITHOUT-GITHUB.md.
 */

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  assertDeploymentConfigSane,
  buildImageUri,
  deriveSecretArn,
  dropReadOnlyTaskDefFields,
  evaluateStability,
  resolveImageTag,
  rewriteImage,
  stripStaleSecretRefs,
} from "./lib/taskdef-rewrite.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "..", "..");

const CLUSTER = process.env.ECS_CLUSTER || "blackout-production-cluster";
const ECR_REPOSITORY = process.env.ECR_REPOSITORY || "blackout-web";
const REGION = process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || "us-east-1";

/**
 * The ONLY services this tool will touch. An allowlist rather than a free-form --service-name:
 * a deploy tool with a typo-able target is a deploy tool that can roll something it was never
 * meant to. There are exactly two services in the account (verified live 2026-08-06).
 */
const SERVICES = Object.freeze({
  web: { key: "web", name: "blackout-production-web" },
  worker: { key: "worker", name: "blackout-production-market-worker" },
});

/**
 * Stability-poll budget. 15s interval × 144 = 36 MINUTES.
 *
 * WHY NOT THE WORKFLOW'S 12 MINUTES: at `minimumHealthyPercent=100 / maximumPercent=120` there is
 * exactly ONE spare slot, so ECS replaces tasks strictly one at a time. Each swap is ~2 min
 * (task start + image pull + Next boot + ALB health checks + the 30s target-group deregistration
 * drain), so a 12-task web roll takes ~24-30 min end to end. A 12-minute budget red-fails every
 * HEALTHY deploy — the roll is fine, the waiter just gave up early, and the operator is left
 * staring at a "failed" deploy that actually succeeded. 36 min covers the full 5..12 autoscaling
 * range with headroom. The circuit breaker (enabled + rollback) is what catches a genuinely bad
 * deploy; this timeout only needs to outlast a good one.
 */
const POLL_INTERVAL_MS = 15_000;
const POLL_MAX_ATTEMPTS = 144;

/** Static-asset validation retry, ported from the workflow: 10 attempts, 15s apart. */
const VALIDATE_MAX_ATTEMPTS = 10;
const VALIDATE_RETRY_MS = 15_000;

const USAGE = `
roll-ecs — roll a production ECS service onto an already-built ECR image.

  node scripts/deploy/roll-ecs.mjs --tag <sha> [options]

Options
  --tag <sha>          REQUIRED. Git commit SHA of the image in ECR. ':latest' is refused
                       (mutable, hand-repointed) unless --force.
  --service <s>        web | worker | all           (default: web)
  --wait               Poll the PRIMARY deployment until it stabilises (up to 36 min).
  --purge              Purge the Cloudflare edge cache after the web roll.
  --validate           Run scripts/validate-static-assets.mjs after the purge.
  --dry-run            Print every mutating call and perform NONE. Read-only.
  --force              (1) allow a non-SHA / :latest tag, and (2) proceed even when the live
                       deployment configuration fails the sanity assertion. Break-glass.
  --help               This text.

Ordering for --service all: web roll -> wait -> purge -> validate -> worker roll -> wait.
The purge MUST precede validation; see the comment on runPurge().
`.trim();

// ---------------------------------------------------------------------------------------------
// arg parsing (exported for tests)
// ---------------------------------------------------------------------------------------------

export function parseArgs(argv) {
  const out = {
    tag: null,
    service: "web",
    wait: false,
    purge: false,
    validate: false,
    dryRun: false,
    force: false,
    help: false,
    errors: [],
  };
  for (let i = 0; i < argv.length; i += 1) {
    const raw = argv[i];
    const eq = raw.indexOf("=");
    const flag = eq === -1 ? raw : raw.slice(0, eq);
    const inlineValue = eq === -1 ? null : raw.slice(eq + 1);
    const takeValue = () => (inlineValue !== null ? inlineValue : argv[++i]);

    switch (flag) {
      case "--tag":
        out.tag = takeValue() ?? null;
        break;
      case "--service":
        out.service = (takeValue() ?? "").toLowerCase();
        break;
      case "--wait":
        out.wait = true;
        break;
      case "--purge":
        out.purge = true;
        break;
      case "--validate":
        out.validate = true;
        break;
      case "--dry-run":
        out.dryRun = true;
        break;
      case "--force":
        out.force = true;
        break;
      case "--help":
      case "-h":
        out.help = true;
        break;
      default:
        out.errors.push(`Unknown argument: ${raw}`);
    }
  }
  if (!["web", "worker", "all"].includes(out.service)) {
    out.errors.push(`--service must be one of web|worker|all (got ${JSON.stringify(out.service)}).`);
  }
  return out;
}

/** Which services a --service value expands to, in roll order (web always before worker). */
export function servicesFor(service) {
  if (service === "all") return [SERVICES.web, SERVICES.worker];
  if (service === "worker") return [SERVICES.worker];
  return [SERVICES.web];
}

// ---------------------------------------------------------------------------------------------
// shell / aws plumbing
// ---------------------------------------------------------------------------------------------

const log = (...a) => console.log(...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function fail(message) {
  console.error(`\nERROR: ${message}`);
  process.exit(1);
}

/**
 * Run an `aws` CLI call. `--region` is always passed explicitly: a bare AWS_REGION env var has
 * been observed not to stick in this sandbox (see CLAUDE.md "AWS — the operator supplies creds").
 */
function awsRaw(args, { allowFailure = false } = {}) {
  const res = spawnSync("aws", [...args, "--region", REGION], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (res.error) fail(`could not exec the aws CLI: ${res.error.message}`);
  if (res.status !== 0) {
    if (allowFailure) return { ok: false, stdout: res.stdout ?? "", stderr: res.stderr ?? "" };
    const stderr = (res.stderr ?? "").trim();
    let hint = "";
    if (/InvalidClientTokenId|SignatureDoesNotMatch|ExpiredToken/.test(stderr)) {
      hint =
        "\n  HINT: the sandbox sets PLACEHOLDER AWS_ACCESS_KEY_ID/AWS_SECRET_ACCESS_KEY env vars that override" +
        "\n  ~/.aws/credentials. Re-run with:  env -u AWS_ACCESS_KEY_ID -u AWS_SECRET_ACCESS_KEY node ...";
    }
    fail(`aws ${args.slice(0, 2).join(" ")} failed (exit ${res.status}):\n  ${stderr}${hint}`);
  }
  return { ok: true, stdout: res.stdout ?? "", stderr: res.stderr ?? "" };
}

function awsJson(args) {
  const { stdout } = awsRaw([...args, "--output", "json"]);
  try {
    return JSON.parse(stdout);
  } catch {
    fail(`aws ${args.slice(0, 2).join(" ")} did not return parseable JSON.`);
    return null;
  }
}

function awsText(args) {
  return awsRaw([...args, "--output", "text"]).stdout.trim();
}

// ---------------------------------------------------------------------------------------------
// steps
// ---------------------------------------------------------------------------------------------

/** The ECR registry host for this account, e.g. 177922194517.dkr.ecr.us-east-1.amazonaws.com. */
function resolveRegistry() {
  if (process.env.ECR_REGISTRY) return process.env.ECR_REGISTRY;
  const account = awsText(["sts", "get-caller-identity", "--query", "Account"]);
  if (!/^\d{12}$/.test(account)) fail(`sts get-caller-identity returned an unexpected account id: ${account}`);
  return `${account}.dkr.ecr.${REGION}.amazonaws.com`;
}

/**
 * PRECONDITION: the tag must actually exist in ECR before we touch a single service.
 *
 * The workflow has no such check because it always deploys the image it just built. Running the
 * roll standalone, a tag that isn't there degrades into a mid-roll `CannotPullContainerError` —
 * exactly what happened to the market-worker after an ECR lifecycle prune took its pinned image
 * (documented in the workflow's own "WHY THIS STEP EXISTS" comment: runningCount went to 0/1).
 * Failing here costs one API call; failing there costs a dead service and a rollback.
 */
function assertImageExists(tag) {
  const res = awsRaw(
    ["ecr", "describe-images", "--repository-name", ECR_REPOSITORY, "--image-ids", `imageTag=${tag}`, "--output", "json"],
    { allowFailure: true },
  );
  if (!res.ok) {
    if (/ImageNotFoundException/.test(res.stderr)) {
      fail(
        `image tag ${tag} does not exist in ECR repository ${ECR_REPOSITORY} (${REGION}).\n` +
          `  Nothing was changed. Build and push it first (GitHub Actions ecr-push-production.yml, or\n` +
          `  the CodeBuild project blackout-web-image-build), then re-run.\n` +
          `  List what IS there:  aws ecr describe-images --repository-name ${ECR_REPOSITORY} --region ${REGION} \\\n` +
          `    --query 'reverse(sort_by(imageDetails,&imagePushedAt))[:10].{tags:imageTags,pushed:imagePushedAt}'`,
      );
    }
    fail(`ecr describe-images failed:\n  ${res.stderr.trim()}`);
  }
  const detail = JSON.parse(res.stdout)?.imageDetails?.[0] ?? {};
  log(`  image found: digest=${detail.imageDigest ?? "?"} tags=${(detail.imageTags ?? []).join(",")} size=${detail.imageSizeInBytes ?? "?"}B`);
}

function describeService(serviceName) {
  const out = awsJson(["ecs", "describe-services", "--cluster", CLUSTER, "--services", serviceName]);
  const svc = out?.services?.[0];
  if (!svc || svc.status === "INACTIVE") fail(`service ${serviceName} not found (or INACTIVE) in cluster ${CLUSTER}.`);
  return svc;
}

/** The key names present in the live Secrets Manager JSON. NEVER logs a value. */
function fetchValidSecretKeys(secretArn) {
  const secretString = awsText(["secretsmanager", "get-secret-value", "--secret-id", secretArn, "--query", "SecretString"]);
  let parsed;
  try {
    parsed = JSON.parse(secretString);
  } catch {
    // Deliberately does not include the payload in the message — it is the production secret.
    fail(`the SecretString at ${secretArn} is not JSON; cannot determine which secret keys are valid.`);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    fail(`the SecretString at ${secretArn} is not a JSON object of key -> value.`);
  }
  return Object.keys(parsed);
}

/**
 * describe-services -> assert config -> describe-task-definition -> rewrite image -> strip stale
 * secret refs -> drop read-only fields -> register-task-definition -> update-service.
 *
 * Returns the new task definition ARN (or null under --dry-run).
 */
function rollService(svcSpec, { imageUri, dryRun, force, tmpDir }) {
  const banner = `\n=== ${svcSpec.name} ===`;
  log(banner);

  const service = describeService(svcSpec.name);
  log(`  desiredCount=${service.desiredCount} runningCount=${service.runningCount} taskDefinition=${service.taskDefinition}`);

  // ---- LIVE deployment configuration: read it, print it, assert it. NEVER write it. ----------
  // (The whole rationale lives on assertDeploymentConfigSane() in lib/taskdef-rewrite.mjs. The
  // short version: `update-service` below deliberately carries NO --deployment-configuration
  // flag, because the workflow hardcoding one is exactly what silently reverted an out-of-band
  // incident fix on 2026-08-06.)
  log(`  live deploymentConfiguration (READ-ONLY — this tool never writes it):`);
  log(
    JSON.stringify(service.deploymentConfiguration ?? null, null, 2)
      .split("\n")
      .map((l) => `    ${l}`)
      .join("\n"),
  );
  const sanity = assertDeploymentConfigSane(service);
  for (const n of sanity.notes) log(`  note: ${n}`);
  if (!sanity.ok) {
    for (const f of sanity.failures) console.error(`  DEPLOYMENT-CONFIG ASSERTION FAILED: ${f}`);
    if (!force) {
      fail(
        `${svcSpec.name}: live deployment configuration failed the sanity assertion (above). Nothing was changed.\n` +
          `  Fix the service configuration (Terraform, or a surgical 'aws ecs update-service --deployment-configuration'),\n` +
          `  or re-run with --force to deploy anyway.`,
      );
    }
    // --force MUST bypass this. That assertion is a fail-closed guard sitting on the BREAK-GLASS
    // path — this script's whole reason to exist is the incident where the normal path is gone.
    // Today's live web config (minHealthy=100/max=120) is itself an unusual-but-intentional state
    // set by hand during an incident, i.e. exactly the shape a guard like this trips on. A deploy
    // tool that can REFUSE during the incident it exists for is a resilience regression, so the
    // guard is loud, not absolute.
    console.error(
      `  !!!! --force: proceeding with ${svcSpec.name} DESPITE the failed assertion(s) above. !!!!\n` +
        `  !!!! The roll may deadlock or fail to roll back. Watch it. !!!!`,
    );
  }

  // ---- task definition rewrite --------------------------------------------------------------
  const current = awsJson(["ecs", "describe-task-definition", "--task-definition", service.taskDefinition, "--query", "taskDefinition"]);

  const { taskDef: imaged, changes } = rewriteImage(current, imageUri);
  for (const c of changes) log(`  image: ${c.container}: ${c.from} -> ${c.to}`);

  let rewritten = imaged;
  const secretArn = deriveSecretArn(current);
  if (!secretArn) {
    log(`  no secrets[] refs on this task definition — stale-secret filter skipped.`);
  } else {
    log(`  secret: ${secretArn}`);
    const validKeys = fetchValidSecretKeys(secretArn);
    log(`  secret: ${validKeys.length} keys present in Secrets Manager`);
    const { taskDef, stripped } = stripStaleSecretRefs(imaged, validKeys);
    rewritten = taskDef;
    if (stripped.length) {
      // WHY: Terraform-generated task defs keep referencing keys later removed from the secret;
      // ECS resolves every ref at task start, so one dead ref = ResourceInitializationError = 0
      // running tasks. Names only — never values.
      log(`  stripped ${stripped.length} stale secret ref(s): ${stripped.map((s) => s.name).join(", ")}`);
    } else {
      log(`  no stale secret refs to strip.`);
    }
  }

  const registerable = dropReadOnlyTaskDefFields(rewritten);
  const jsonPath = path.join(tmpDir, `${svcSpec.key}-taskdef.json`);
  fs.writeFileSync(jsonPath, JSON.stringify(registerable));

  if (dryRun) {
    log(`  DRY-RUN would run: aws ecs register-task-definition --cli-input-json file://${jsonPath} --region ${REGION}`);
    log(`  DRY-RUN rendered task definition written to ${jsonPath} (${fs.statSync(jsonPath).size} bytes) — inspect it.`);
    log(
      `  DRY-RUN would run: aws ecs update-service --cluster ${CLUSTER} --service ${svcSpec.name} ` +
        `--task-definition <NEW_ARN> --force-new-deployment --region ${REGION}`,
    );
    log(`  DRY-RUN NOTE: no --deployment-configuration flag is passed, by design.`);
    return null;
  }

  const newArn = awsText(["ecs", "register-task-definition", "--cli-input-json", `file://${jsonPath}`, "--query", "taskDefinition.taskDefinitionArn"]);
  log(`  registered: ${newArn}`);

  // Do NOT pass --desired-count: autoscaling manages web's task count (5..12) and the worker's
  // desiredCount lives on the service. Overriding it on every deploy fights that configuration.
  //
  // Do NOT pass --deployment-configuration: see the assertion block above. This tool reads and
  // asserts that config; it never writes it.
  awsRaw(["ecs", "update-service", "--cluster", CLUSTER, "--service", svcSpec.name, "--task-definition", newArn, "--force-new-deployment", "--output", "json"]);
  log(`  update-service issued (force-new-deployment) on ${svcSpec.name}.`);
  return newArn;
}

/**
 * Custom stability check: poll the PRIMARY deployment only.
 * The built-in `services-stable` waiter blocks on ALL deployments
 * including stale circuit-breaker leftovers that can never stabilize.
 *
 * ^ That comment is carried across VERBATIM from ecr-push-production.yml and must survive any
 * refactor. It is the entire reason this is a hand-rolled loop and not `aws ecs wait
 * services-stable`, and a reviewer who has not lived through a stuck circuit-breaker deployment
 * WILL suggest the built-in waiter. See POLL_MAX_ATTEMPTS for the (separate) timeout rationale.
 */
async function waitForStable(svcSpec, { dryRun }) {
  if (dryRun) {
    log(`  DRY-RUN would poll the PRIMARY deployment of ${svcSpec.name} for up to ${(POLL_INTERVAL_MS * POLL_MAX_ATTEMPTS) / 60000} min.`);
    return;
  }
  const budgetMin = (POLL_INTERVAL_MS * POLL_MAX_ATTEMPTS) / 60000;
  log(`  waiting for PRIMARY deployment to stabilize (up to ${budgetMin} min)...`);
  for (let i = 1; i <= POLL_MAX_ATTEMPTS; i += 1) {
    await sleep(POLL_INTERVAL_MS);
    const primary = awsJson([
      "ecs",
      "describe-services",
      "--cluster",
      CLUSTER,
      "--services",
      svcSpec.name,
      "--query",
      "services[0].deployments[?status==`PRIMARY`] | [0]",
    ]);
    const v = evaluateStability(primary);
    log(`    [${i}/${POLL_MAX_ATTEMPTS}] PRIMARY: running=${v.running}/${v.desired}, rollout=${v.rollout}`);
    if (v.verdict === "COMPLETED") {
      log(`  ECS rollout complete (${v.detail}).`);
      return;
    }
    if (v.verdict === "FAILED") fail(`${svcSpec.name}: ECS rollout FAILED — ${v.detail}`);
  }
  fail(`${svcSpec.name}: timed out after ${budgetMin} min waiting for the PRIMARY deployment to stabilize.`);
}

/**
 * Purge the Cloudflare edge cache.
 *
 * PURGE MUST RUN BEFORE VALIDATION. The validator fetches the site THROUGH Cloudflare, and
 * Cloudflare edge-caches the transient 404s that hashed /_next/static/* chunks throw during the
 * rolling task swap. Validate first and those cached 404s fail the check for the full retry
 * window, the run exits non-zero BEFORE the purge ever happens — so the stale/404 edge cache is
 * never cleared and the deploy is marked failed even though ECS rolled out fine.
 */
/**
 * HTML routes that are edge-cached and therefore need purging after a deploy.
 *
 * DELIBERATELY NOT `purge_everything`. Next.js build assets are content-hashed and served
 * `cache-control: public, max-age=31536000, immutable` — a given URL's bytes can never change, so
 * they never need purging. Purging them forces every client to re-fetch from an origin that is a
 * MIX of old and new ECS tasks mid-rollout: HTML from a new task references `webpack-<newhash>.js`,
 * that request lands on a task carrying only the old build, and returns 404. Next serves the 404 as
 * `text/plain`, the browser refuses to execute it, HYDRATION NEVER COMPLETES, and every client
 * component freezes in its loading state with no error and no retry.
 *
 * Observed on prod 2026-08-18: "Loading chart…", "Loading 0dte matrix…" and "Connecting Live Helix…"
 * all stuck at once with 84/84 network requests SUCCEEDING, console carrying `Refused to execute
 * script from '.../webpack-bbf5e95de4d12e67.js' because its MIME type ('text/plain') is not
 * executable`. That same URL returned 200 / cf-cache-status HIT ~8 minutes later once the edge had
 * re-cached a good copy — which is why the failure looks intermittent and unreproducible.
 *
 * Retaining hashed assets is what lets the old and new builds COEXIST during a rollout: a client
 * holding old HTML keeps getting its old chunks from the edge while new clients get the new ones.
 * That is the entire purpose of immutable content-hashed URLs.
 *
 * Only the routes a cache rule actually stores need listing here — every desk page is DYNAMIC
 * (uncached) already; see the Cloudflare cache-rule notes in CLAUDE.md.
 */
const PURGE_HTML_URLS = [
  "https://blackouttrades.com/",
  "https://blackouttrades.com/upgrade",
  "https://blackouttrades.com/learn",
  "https://blackouttrades.com/pricing",
  "https://blackouttrades.com/faq",
];

async function runPurge({ dryRun }) {
  const zone = process.env.CF_ZONE_ID;
  const token = process.env.CF_API_TOKEN;
  log(`\n=== Cloudflare edge purge ===`);
  if (!zone || !token) {
    log("  CF_ZONE_ID / CF_API_TOKEN not set — skipping edge purge.");
    return;
  }
  if (dryRun) {
    log(`  DRY-RUN would POST .../purge_cache ${JSON.stringify({ files: PURGE_HTML_URLS })}`);
    return;
  }
  const res = await fetch(`https://api.cloudflare.com/client/v4/zones/${zone}/purge_cache`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ files: PURGE_HTML_URLS }),
  });
  if (!res.ok) fail(`Cloudflare purge failed: HTTP ${res.status}`);
  log("  Cloudflare HTML purged after ECS rollout (hashed build assets deliberately retained).");
  // Let the edge drop entries before we validate through it.
  await sleep(10_000);
}

/** Post-deploy static-asset guard, with the workflow's retry (10 × 15s). */
async function runValidate({ dryRun, purgeRequested }) {
  log(`\n=== Static asset validation ===`);
  if (!purgeRequested) {
    log(
      "  WARNING: validating WITHOUT --purge. Cloudflare may still be serving edge-cached 404s for hashed\n" +
        "  /_next/static/* chunks from the rolling swap, which false-fails this check. Prefer --purge --validate.",
    );
  }
  if (dryRun) {
    log(`  DRY-RUN would run: node scripts/validate-static-assets.mjs (up to ${VALIDATE_MAX_ATTEMPTS} attempts, ${VALIDATE_RETRY_MS / 1000}s apart)`);
    return;
  }
  for (let i = 1; i <= VALIDATE_MAX_ATTEMPTS; i += 1) {
    const res = spawnSync(process.execPath, ["scripts/validate-static-assets.mjs"], { cwd: REPO_ROOT, stdio: "inherit" });
    if (res.status === 0) {
      log("  Static asset check passed.");
      return;
    }
    log(`  Attempt ${i}/${VALIDATE_MAX_ATTEMPTS} failed — retrying in ${VALIDATE_RETRY_MS / 1000}s...`);
    await sleep(VALIDATE_RETRY_MS);
  }
  fail("static assets still broken after ECS rollout.");
}

// ---------------------------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------------------------

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    log(USAGE);
    return;
  }
  if (args.errors.length) {
    for (const e of args.errors) console.error(`ERROR: ${e}`);
    console.error(`\n${USAGE}`);
    process.exit(1);
  }

  const tagResult = resolveImageTag({ tag: args.tag, force: args.force });
  for (const w of tagResult.warnings) console.error(`WARNING: ${w}`);
  if (!tagResult.ok) {
    console.error(`ERROR: ${tagResult.error}`);
    process.exit(1);
  }

  const targets = servicesFor(args.service);

  log(`roll-ecs — cluster=${CLUSTER} region=${REGION} repo=${ECR_REPOSITORY}`);
  log(`  tag=${tagResult.tag} service=${args.service} (${targets.map((t) => t.name).join(", ")})`);
  log(`  wait=${args.wait} purge=${args.purge} validate=${args.validate} force=${args.force}`);
  if (args.dryRun) log(`  *** DRY RUN — read-only. No task definition will be registered, no service updated. ***`);
  else log(`  *** LIVE RUN — this WILL roll production. ***`);

  log(`\n=== Image ===`);
  const registry = resolveRegistry();
  const imageUri = buildImageUri({ registry, repository: ECR_REPOSITORY, tag: tagResult.tag });
  log(`  ${imageUri}`);
  assertImageExists(tagResult.tag);

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "roll-ecs-"));
  try {
    for (const svcSpec of targets) {
      rollService(svcSpec, { imageUri, dryRun: args.dryRun, force: args.force, tmpDir });
      if (args.wait) await waitForStable(svcSpec, { dryRun: args.dryRun });

      // Edge purge + static validation belong to the WEB roll, and must happen between web and
      // worker: web -> purge -> validate -> worker. The worker is rolled LAST — after web has
      // fully rolled, been edge-purged and validated — so this additive step never delays the
      // user-facing web deploy and a worker failure can't roll back web.
      if (svcSpec.key === "web") {
        if (args.purge) await runPurge({ dryRun: args.dryRun });
        if (args.validate) await runValidate({ dryRun: args.dryRun, purgeRequested: args.purge });
      }
    }
    // --service worker on its own still honours the flags, just with nothing to gate them on.
    if (!targets.some((t) => t.key === "web")) {
      if (args.purge) await runPurge({ dryRun: args.dryRun });
      if (args.validate) await runValidate({ dryRun: args.dryRun, purgeRequested: args.purge });
    }
  } finally {
    if (!args.dryRun) fs.rmSync(tmpDir, { recursive: true, force: true });
  }

  log(`\n${args.dryRun ? "DRY RUN complete — nothing was changed." : "Deploy complete."}`);
}

// Only run when invoked as a script, so the exported helpers above are importable from tests.
const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (invokedDirectly) {
  main().catch((err) => fail(err?.stack || String(err)));
}
