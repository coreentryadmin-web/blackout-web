#!/usr/bin/env node
/** Full growth sweep NOW — engage + mention replies via direct OAuth. */
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
  const { runGrowthSweep } = await import("../src/lib/x-growth-engine");

  console.log(dryRun ? "[dry-run] x-growth…" : "[live] x-growth — max engagement…");
  const stats = await runGrowthSweep({ dryRun });
  console.log(JSON.stringify(stats, null, 2));
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
