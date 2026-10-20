#!/usr/bin/env node
/**
 * Scale blackout-production-web UP to the deploy floor before a 100/120 roll.
 * Autoscaling can scale desiredCount below MinCapacity overnight; at desired<5 the roll deadlocks.
 *
 * Usage:
 *   node scripts/deploy/ensure-web-deploy-capacity.mjs --cluster NAME --service NAME [--floor 5] [--dry-run]
 */
import { spawnSync } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { targetDesiredBeforeWebRoll, WEB_AUTOSCALE_MIN_TASKS } from "./lib/taskdef-rewrite.mjs";

function parseArgs(argv) {
  const out = { cluster: null, service: null, floor: WEB_AUTOSCALE_MIN_TASKS, dryRun: false };
  for (let i = 2; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--cluster") out.cluster = argv[++i];
    else if (a === "--service") out.service = argv[++i];
    else if (a === "--floor") out.floor = Number(argv[++i]);
    else if (a === "--dry-run") out.dryRun = true;
    else if (a === "--help") {
      console.log(`Usage: node scripts/deploy/ensure-web-deploy-capacity.mjs --cluster C --service S [--floor 5]`);
      process.exit(0);
    }
  }
  if (!out.cluster || !out.service) {
    console.error("Missing --cluster and --service");
    process.exit(1);
  }
  return out;
}

function awsJson(args) {
  const r = spawnSync("aws", args, { encoding: "utf8" });
  if (r.status !== 0) throw new Error(r.stderr || r.stdout || "aws failed");
  return JSON.parse(r.stdout);
}

const { cluster, service, floor, dryRun } = parseArgs(process.argv);

const described = awsJson([
  "ecs",
  "describe-services",
  "--cluster",
  cluster,
  "--services",
  service,
  "--output",
  "json",
]).services?.[0];

if (!described) {
  console.error(`Service not found: ${cluster}/${service}`);
  process.exit(1);
}

const target = targetDesiredBeforeWebRoll(described, floor);
const current = Number(described.desiredCount ?? 0);

if (target <= current) {
  console.log(`[ensure-web-deploy-capacity] desiredCount=${current} already >= deploy floor ${target} — no scale-up`);
  process.exit(0);
}

console.log(
  `[ensure-web-deploy-capacity] scaling ${service} desiredCount ${current} → ${target} (100/120 roll headroom)`,
);

if (dryRun) {
  console.log("[ensure-web-deploy-capacity] dry-run — skipping aws ecs update-service");
  process.exit(0);
}

const upd = spawnSync(
  "aws",
  ["ecs", "update-service", "--cluster", cluster, "--service", service, "--desired-count", String(target)],
  { encoding: "utf8" },
);
if (upd.status !== 0) {
  console.error(upd.stderr || upd.stdout);
  process.exit(1);
}

const deadline = Date.now() + 10 * 60 * 1000;
while (Date.now() < deadline) {
  await sleep(15_000);
  const live = awsJson([
    "ecs",
    "describe-services",
    "--cluster",
    cluster,
    "--services",
    service,
    "--output",
    "json",
  ]).services?.[0];
  const running = Number(live?.runningCount ?? 0);
  const desired = Number(live?.desiredCount ?? 0);
  console.log(`[ensure-web-deploy-capacity] running=${running}/${desired} (target ${target})`);
  if (running >= target && desired >= target) {
    console.log("[ensure-web-deploy-capacity] scale-up complete");
    process.exit(0);
  }
}

console.error("[ensure-web-deploy-capacity] timed out waiting for scale-up");
process.exit(1);
