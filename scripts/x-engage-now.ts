#!/usr/bin/env node
/**
 * Run engagement sweep NOW via direct OAuth (bypasses ECS load balancer).
 * Loads X_* from env or AWS Secrets Manager.
 *
 *   npm run x-engage:now              # live likes + replies + follows
 *   npm run x-engage:now -- --silent  # likes + follows only (no posts)
 *   npm run x-engage:now -- --dry     # preview only
 */
import { execSync } from "node:child_process";

function loadEnv(): void {
  if (process.env.X_API_KEY?.trim()) return;
  const raw = execSync(
    "aws secretsmanager get-secret-value --secret-id blackout-production/app/env --query SecretString --output text",
    { encoding: "utf8" },
  );
  for (const [k, v] of Object.entries(JSON.parse(raw) as Record<string, string>)) {
    if (typeof v === "string") process.env[k] = v;
  }
}

async function main() {
  loadEnv();
  const dryRun = process.argv.includes("--dry");
  const silentOnly = process.argv.includes("--silent");
  const { runEngagementSweep } = await import("../src/lib/x-engage-engine");

  const mode = dryRun ? "[dry-run]" : "[live]";
  const kind = silentOnly ? "silent engagement" : "engagement sweep";
  console.log(`${mode} ${kind}…`);
  const stats = await runEngagementSweep({
    dryRun,
    cronMode: false,
    silentOnly,
  });
  console.log(JSON.stringify(stats, null, 2));
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
