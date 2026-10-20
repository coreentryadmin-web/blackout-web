#!/usr/bin/env node
/**
 * Emit the --deployment-configuration string for blackout-production-web at a given desiredCount.
 * Used by ecr-push-production.yml preflight (fail fast before a 36-minute deadlock).
 *
 * Usage: node scripts/deploy/print-web-deploy-configuration.mjs <desiredCount>
 */
import { resolveWebRollDeploymentConfiguration } from "./lib/taskdef-rewrite.mjs";

const d = Number(process.argv[2]);
const r = resolveWebRollDeploymentConfiguration(d);
if (!r.ok) {
  console.error(r.failures.join("\n"));
  process.exit(1);
}
const c = r.config;
console.log(
  `minimumHealthyPercent=${c.minimumHealthyPercent},maximumPercent=${c.maximumPercent},deploymentCircuitBreaker={enable=true,rollback=true}`,
);
