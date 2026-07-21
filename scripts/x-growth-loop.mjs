#!/usr/bin/env node
/**
 * Agent / ops loop — run silent X growth every N minutes until stopped.
 *
 *   node scripts/x-growth-loop.mjs
 *   node scripts/x-growth-loop.mjs --interval-min 30
 *   node scripts/x-growth-loop.mjs --once
 *
 * Stop: touch /opt/cursor/artifacts/x-growth-loop.stop
 *       or Ctrl+C / kill the tmux session.
 */
import { execSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

const args = process.argv.slice(2);
const once = args.includes("--once");
const intervalMin =
  Number(args[args.indexOf("--interval-min") + 1]) ||
  Number(process.env.X_GROWTH_LOOP_MINUTES) ||
  30;
const STOP = "/opt/cursor/artifacts/x-growth-loop.stop";
const LOG = "/opt/cursor/artifacts/x-growth-loop.log";
mkdirSync("/opt/cursor/artifacts", { recursive: true });

function loadEnv() {
  if (process.env.X_API_KEY?.trim()) return;
  const raw = execSync(
    "aws secretsmanager get-secret-value --secret-id blackout-production/app/env --query SecretString --output text",
    { encoding: "utf8" },
  );
  for (const [k, v] of Object.entries(JSON.parse(raw))) {
    if (typeof v === "string") process.env[k] = v;
  }
  process.env.X_GROWTH_INTENSIVE = process.env.X_GROWTH_INTENSIVE ?? "1";
}

function log(line) {
  const row = `[${new Date().toISOString()}] ${line}\n`;
  process.stdout.write(row);
  try {
    writeFileSync(LOG, row, { flag: "a" });
  } catch {
    /* ignore */
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function runPass() {
  loadEnv();
  const r = spawnSync("npm", ["run", "x-engage:now", "--", "--silent"], {
    cwd: ROOT,
    encoding: "utf8",
    env: process.env,
  });
  log(r.stdout?.trim() || r.stderr?.trim() || `exit ${r.status}`);
  return r.status === 0;
}

if (existsSync(STOP)) {
  log("stop file present — exiting");
  process.exit(0);
}

log(`x-growth loop start interval=${intervalMin}m intensive=1 silent=1`);
await runPass();

if (once) process.exit(0);

while (!existsSync(STOP)) {
  log(`sleep ${intervalMin}m (create ${STOP} to stop)`);
  await sleep(intervalMin * 60_000);
  if (existsSync(STOP)) break;
  await runPass();
}

log("stopped");
