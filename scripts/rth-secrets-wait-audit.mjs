#!/usr/bin/env node
/**
 * Poll for prod audit secrets; when available, run full four-engine + play-quality sweep.
 * Runs alongside rth-live-monitor until 16:15 ET.
 */
import { spawnSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { etParts } from "./gha-et-window.mjs";
import { auditSecret, loadProdSecretsFromAws } from "./audit/lib/prod-secrets.mjs";

const LOG = join(process.cwd(), "audit-output", "rth-secrets-wait.log");
const ENV_AUDIT = join(process.cwd(), "audit-output", ".env.audit");
mkdirSync(join(process.cwd(), "audit-output"), { recursive: true });

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
  appendFileSync(LOG, line + "\n");
}

function hydrate() {
  for (const [k, v] of Object.entries(loadProdSecretsFromAws())) {
    if (v?.trim() && !process.env[k]?.trim()) process.env[k] = v.trim();
  }
  if (existsSync(ENV_AUDIT)) {
    for (const line of readFileSync(ENV_AUDIT, "utf8").split("\n")) {
      const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
      if (!m || process.env[m[1]]?.trim()) continue;
      try {
        process.env[m[1]] = JSON.parse(m[2]);
      } catch {
        process.env[m[1]] = m[2];
      }
    }
  }
}

function secretsReady() {
  hydrate();
  return !!(auditSecret("CLERK_SECRET_KEY") || auditSecret("CRON_SECRET"));
}

function marketDone() {
  const et = etParts(new Date());
  if (et.weekday === "Sat" || et.weekday === "Sun") return true;
  return et.mins > 16 * 60 + 15;
}

function run(cmd) {
  log(`RUN ${cmd}`);
  const r = spawnSync(cmd, { shell: true, encoding: "utf8", env: process.env, maxBuffer: 24 * 1024 * 1024 });
  log(`${r.status === 0 ? "PASS" : "FAIL"} ${cmd} exit=${r.status}`);
  return r.status === 0;
}

async function fullSweep() {
  log("=== SECRETS READY — full authenticated sweep ===");
  const jobs = [
    "node scripts/audit/data-validator.mjs",
    "node scripts/audit/rth-four-engine-play-audit.mjs",
    "node scripts/audit/play-engine-quality-audit.mjs",
    "npm run validate:vector-rth-quick",
    "npm run validate:spx-rth",
    "npm run validate:grid-rth",
    "node scripts/audit/zerodte-bie-consistency-validator.mjs",
    "npm run validate:legacy-board-ui",
    "npm run validate:nighthawk-vector-board-ui",
    "node scripts/audit/nighthawk-boards-prod-screenshots.mjs",
  ];
  let pass = 0;
  for (const cmd of jobs) {
    if (run(cmd)) pass += 1;
  }
  log(`Sweep done: ${pass}/${jobs.length} passed`);
}

async function main() {
  log("rth-secrets-wait start — polling every 60s for CLERK/CRON");
  let swept = false;
  while (!marketDone()) {
    if (secretsReady()) {
      if (!swept) {
        await fullSweep();
        swept = true;
      }
      // Re-run play audits every 5 min once secrets are live
      run("node scripts/audit/play-engine-quality-audit.mjs");
      run("node scripts/audit/rth-four-engine-play-audit.mjs");
      await new Promise((r) => setTimeout(r, 5 * 60_000));
      continue;
    }
    log("secrets not ready — retry in 60s");
    await new Promise((r) => setTimeout(r, 60_000));
  }
  log("market window closed — exiting");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
