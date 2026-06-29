#!/usr/bin/env node
/**
 * Print Railway CLI commands to wire cron trigger services to their per-job TOML.
 * Run after creating a new cron service shell in the Railway dashboard.
 *
 * Usage: node scripts/railway-cron-wire.mjs [job-key ...]
 * Example: node scripts/railway-cron-wire.mjs gex-alerts spx-signal-weight-optimize
 */
const jobs = process.argv.slice(2);
const targets =
  jobs.length > 0
    ? jobs
    : ["gex-alerts", "spx-signal-weight-optimize"];

const PROJECT = "9282f541-a288-4c8b-a174-ee22016f4b1a";
const ENV = "production";

/** Map registry key → typical Railway service display name */
const SERVICE_NAMES = {
  "gex-alerts": "GEX-Alerts",
  "spx-signal-weight-optimize": "SPX-Signal-Weight-Optimize",
};

console.log("\n=== Railway cron config-as-code wiring ===\n");
console.log("Each cron trigger service must point at its railway.<key>.toml (NOT root railway.toml).\n");

for (const key of targets) {
  const service = SERVICE_NAMES[key] ?? key;
  const toml = `/railway.${key}.toml`;
  console.log(`# ${key} → service "${service}"`);
  console.log(
    `railway environment edit -p ${PROJECT} -e ${ENV} \\\n` +
      `  --service-config ${service} deploy.railwayConfigFile ${toml} \\\n` +
      `  -m "Wire ${key} cron config-as-code"`
  );
  console.log(`# Also ensure CRON_SECRET is set: railway variables set --service "${service}" CRON_SECRET=...\n`);
}

console.log("Dashboard fallback: Service → Settings → Config-as-code → path = /railway.<key>.toml\n");
