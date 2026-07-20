#!/usr/bin/env node
/**
 * Merge every key from blackout-production/app/env into the live ECS web task def.
 * The ECR deploy script only filters existing secret refs — it never adds new SM keys.
 *
 * Usage: node scripts/ecs-sync-app-secrets.mjs [--cluster blackout-production-cluster] [--service blackout-production-web]
 */
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";

// Validate inputs to prevent injection — only allow alphanumeric, hyphens, slashes, dots
function sanitize(val, label) {
  if (!/^[\w./-]+$/.test(val)) {
    throw new Error(`Invalid ${label}: ${val}`);
  }
  return val;
}

const CLUSTER = sanitize(
  process.argv.includes("--cluster")
    ? process.argv[process.argv.indexOf("--cluster") + 1]
    : "blackout-production-cluster",
  "cluster",
);
const SERVICE = sanitize(
  process.argv.includes("--service")
    ? process.argv[process.argv.indexOf("--service") + 1]
    : "blackout-production-web",
  "service",
);
const SECRET_ID = sanitize(
  process.env.APP_SECRET_ID ?? "blackout-production/app/env",
  "secret-id",
);

// Use execFileSync with argument arrays to avoid shell injection (CodeQL js/command-line-injection)
function awsCli(...args) {
  return execFileSync("aws", args, { encoding: "utf8" }).trim();
}

const taskDefArn = awsCli(
  "ecs", "describe-services",
  "--cluster", CLUSTER,
  "--services", SERVICE,
  "--query", "services[0].taskDefinition",
  "--output", "text",
);
const secretJson = awsCli(
  "secretsmanager", "get-secret-value",
  "--secret-id", SECRET_ID,
  "--query", "SecretString",
  "--output", "text",
);
const validKeys = Object.keys(JSON.parse(secretJson)).sort();
const td = JSON.parse(
  awsCli(
    "ecs", "describe-task-definition",
    "--task-definition", taskDefArn,
    "--query", "taskDefinition",
    "--output", "json",
  ),
);

const secretArn = td.containerDefinitions[0].secrets[0].valueFrom.split(":").slice(0, -3).join(":");
const existing = new Set(td.containerDefinitions[0].secrets.map((s) => s.name));
const added = validKeys.filter((k) => !existing.has(k));

for (const c of td.containerDefinitions) {
  c.secrets = validKeys.map((key) => ({
    name: key,
    valueFrom: `${secretArn}:${key}::`,
  }));
}

for (const k of [
  "taskDefinitionArn",
  "revision",
  "status",
  "requiresAttributes",
  "compatibilities",
  "registeredAt",
  "registeredBy",
  "deregisteredAt",
]) {
  delete td[k];
}

writeFileSync("/tmp/ecs-sync-secrets-taskdef.json", JSON.stringify(td));
const newArn = awsCli(
  "ecs", "register-task-definition",
  "--cli-input-json", "file:///tmp/ecs-sync-secrets-taskdef.json",
  "--query", "taskDefinition.taskDefinitionArn",
  "--output", "text",
);
awsCli(
  "ecs", "update-service",
  "--cluster", CLUSTER,
  "--service", SERVICE,
  "--task-definition", newArn,
  "--force-new-deployment",
);

console.log(JSON.stringify({ taskDefArn: newArn, secretCount: validKeys.length, added }, null, 2));
