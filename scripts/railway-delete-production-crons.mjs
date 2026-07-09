#!/usr/bin/env node
/**
 * Delete all Railway production cron trigger services after AWS EventBridge cutover.
 * Keeps blackout-web, Postgres, Redis, PgBouncer for rollback.
 *
 * Usage:
 *   node scripts/railway-delete-production-crons.mjs
 *   node scripts/railway-delete-production-crons.mjs --dry-run
 */
import { spawnSync } from "node:child_process";
import { CRON_SERVICE_NAMES, PRODUCTION_ENV } from "./railway-cron-services.mjs";

const dryRun = process.argv.includes("--dry-run");
const names = Object.values(CRON_SERVICE_NAMES);

let ok = 0;
let fail = 0;
for (const svc of names) {
  const args = ["service", "delete", "--service", svc, "--environment", PRODUCTION_ENV, "--yes", "--json"];
  if (dryRun) {
    console.log(`[dry-run] railway ${args.join(" ")}`);
    ok += 1;
    continue;
  }
  const r = spawnSync("railway", args, { encoding: "utf8" });
  if (r.status === 0) {
    console.log(`DELETED ${svc}`);
    ok += 1;
  } else {
    console.error(`FAIL ${svc}:`, (r.stderr || r.stdout || "").trim().slice(0, 200));
    fail += 1;
  }
}
console.log(`\nSUMMARY deleted=${ok} failed=${fail}`);
if (fail) process.exit(1);
