#!/usr/bin/env node
/**
 * Merge every key from blackout-production/app/env into the live ECS web task def.
 * The ECR deploy script only filters existing secret refs — it never adds new SM keys.
 *
 * Usage: node scripts/ecs-sync-app-secrets.mjs [--cluster blackout-production-cluster] [--service blackout-production-web]
 */
import { execSync } from "node:child_process";
import { writeFileSync } from "node:fs";

const CLUSTER = process.argv.includes("--cluster")
  ? process.argv[process.argv.indexOf("--cluster") + 1]
  : "blackout-production-cluster";
const SERVICE = process.argv.includes("--service")
  ? process.argv[process.argv.indexOf("--service") + 1]
  : "blackout-production-web";
const SECRET_ID = process.env.APP_SECRET_ID ?? "blackout-production/app/env";

function sh(cmd) {
  return execSync(cmd, { encoding: "utf8" }).trim();
}

const taskDefArn = sh(
  `aws ecs describe-services --cluster ${CLUSTER} --services ${SERVICE} --query 'services[0].taskDefinition' --output text`,
);
const secretJson = sh(
  `aws secretsmanager get-secret-value --secret-id ${SECRET_ID} --query SecretString --output text`,
);
const validKeys = Object.keys(JSON.parse(secretJson)).sort();
const td = JSON.parse(
  sh(`aws ecs describe-task-definition --task-definition ${taskDefArn} --query taskDefinition --output json`),
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
const newArn = sh(
  "aws ecs register-task-definition --cli-input-json file:///tmp/ecs-sync-secrets-taskdef.json --query taskDefinition.taskDefinitionArn --output text",
);
sh(
  `aws ecs update-service --cluster ${CLUSTER} --service ${SERVICE} --task-definition ${newArn} --force-new-deployment`,
);

console.log(JSON.stringify({ taskDefArn: newArn, secretCount: validKeys.length, added }, null, 2));
