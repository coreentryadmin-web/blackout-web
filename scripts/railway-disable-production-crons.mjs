#!/usr/bin/env node
/**
 * Disable Railway production cron triggers (clear cronSchedule) after AWS EventBridge cutover.
 * Does NOT delete services — rollback = re-run railway-audit-apply or railway-apply-cron-config.
 *
 * Usage:
 *   node scripts/railway-disable-production-crons.mjs
 *   node scripts/railway-disable-production-crons.mjs --dry-run
 */
import { execSync, spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { CRON_SERVICE_NAMES, PRODUCTION_ENV } from "./railway-cron-services.mjs";

const dryRun = process.argv.includes("--dry-run");
const KEEP = new Set(["blackout-web", "PgBouncer", "Postgres", "Redis"]);
const CRON_NAMES = new Set(Object.values(CRON_SERVICE_NAMES));

function sh(cmd) {
  return execSync(cmd, { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] });
}

const envJson = JSON.parse(sh(`railway environment config --environment ${PRODUCTION_ENV} --json`));
const serviceList = JSON.parse(sh("railway service list --json"));
const nameToId = Object.fromEntries(serviceList.map((s) => [s.name, s.id]));

let changed = 0;
for (const [name, sid] of Object.entries(nameToId)) {
  if (KEEP.has(name) || !CRON_NAMES.has(name)) continue;
  const svc = envJson.services[sid] ?? {};
  envJson.services[sid] = svc;
  svc.deploy = svc.deploy ?? {};
  const had = svc.deploy.cronSchedule;
  if (!had) {
    console.log(`[skip] ${name} — no cronSchedule`);
    continue;
  }
  delete svc.deploy.cronSchedule;
  console.log(`[disable] ${name} — removed cronSchedule (${had})`);
  changed += 1;
}

if (!changed) {
  console.log("No cron schedules to disable.");
  process.exit(0);
}

const tmp = "/tmp/railway-disable-crons.json";
writeFileSync(tmp, JSON.stringify(envJson));
const msg = "AWS cutover: disable Railway cron schedules (EventBridge active)";

if (dryRun) {
  console.log(`[dry-run] would apply ${changed} changes via railway environment edit`);
  process.exit(0);
}

const r = spawnSync(
  "railway",
  ["environment", "edit", "-e", PRODUCTION_ENV, "-m", msg, "--json"],
  { input: `\n${readFileSync(tmp, "utf8")}`, encoding: "utf8" }
);
process.stdout.write(r.stdout ?? "");
process.stderr.write(r.stderr ?? "");
if (r.status !== 0) process.exit(r.status ?? 1);

console.log(`\nDone — disabled ${changed} Railway cron schedules.`);
