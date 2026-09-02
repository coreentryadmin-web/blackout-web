#!/usr/bin/env node
/**
 * Aggressive RTH wakeup monitor — runs until 4:00 PM ET (or --until=HH:MM ET).
 * Cycles: four-engine play audit, Legacy UI, Vector UI, SPX quick, 0DTE BIE.
 *
 * Run: node scripts/audit/rth-wakeup-monitor.mjs [--interval-min=12] [--force]
 */
import { spawnSync } from "node:child_process";
import { appendFile, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { etParts } from "../gha-et-window.mjs";

const OUT = process.env.SCREENSHOT_OUT || "/opt/cursor/artifacts/rth-monitor";
const INTERVAL_MIN = Number(
  process.argv.find((a) => a.startsWith("--interval-min="))?.slice("--interval-min=".length) ?? 8
);
const FORCE = process.argv.includes("--force");
const LOG = join(OUT, "wakeup-monitor.log");

function etNow() {
  const p = etParts(new Date());
  return { ...p, minutes: p.hour * 60 + p.minute };
}

function marketOpen(et) {
  if (FORCE) return true;
  const dow = et.dow;
  if (dow === 0 || dow === 6) return false;
  return et.minutes >= 9 * 60 + 30 && et.minutes < 16 * 60;
}

function marketClosed(et) {
  if (FORCE) return false;
  return et.minutes >= 16 * 60;
}

async function log(line) {
  const msg = `[${new Date().toISOString()}] ${line}`;
  console.log(msg);
  await appendFile(LOG, msg + "\n");
}

function run(cmd, label, timeoutMs = 300_000) {
  const r = spawnSync(cmd, {
    shell: true,
    encoding: "utf8",
    env: process.env,
    maxBuffer: 20 * 1024 * 1024,
    timeout: timeoutMs,
  });
  const ok = r.status === 0;
  const tail = (r.stdout || r.stderr || "").trim().split("\n").slice(-8).join("\n");
  return { ok, label, tail, status: r.status };
}

async function cycle(n) {
  await log(`——— CYCLE ${n} START ———`);
  const jobs = [
    ["node scripts/audit/rth-four-engine-play-audit.mjs", "four-engine-plays", 180_000],
    ["npm run validate:spx-rth", "spx-rth", 240_000],
    ["npm run validate:grid-rth", "grid-rth", 240_000],
    ["npm run validate:vector-rth-quick", "vector-rth", 120_000],
    ["npm run validate:vector-pick-pnl", "vector-pnl", 120_000],
    ["npm run validate:legacy-board-ui", "legacy-ui", 120_000],
    ["npm run validate:nighthawk-vector-board-ui", "vector-ui", 120_000],
    ["node scripts/audit/zerodte-bie-consistency-validator.mjs", "zerodte-bie", 60_000],
    ["node --import tsx scripts/audit/vector-pick-sweep-audit.mjs --json", "vector-sweep", 90_000],
  ];
  const results = [];
  for (const [cmd, label, timeout] of jobs) {
    const r = run(cmd, label, timeout);
    results.push(r);
    await log(`${r.ok ? "PASS" : "FAIL"} ${label} (exit ${r.status})`);
    if (!r.ok) await appendFile(join(OUT, `fail-${label}.log`), r.tail + "\n\n");
  }
  const fails = results.filter((r) => !r.ok).length;
  await log(`CYCLE ${n} DONE — ${results.length - fails}/${results.length} passed`);
  await writeFile(
    join(OUT, "wakeup-status.json"),
    JSON.stringify({ cycle: n, at: new Date().toISOString(), results: results.map((r) => ({ label: r.label, ok: r.ok })) }, null, 2)
  );
  return fails;
}

async function sleep(ms) {
  await new Promise((r) => setTimeout(r, ms));
}

async function main() {
  await mkdir(OUT, { recursive: true });
  await log(`RTH wakeup monitor — interval ${INTERVAL_MIN}m, output ${OUT}`);

  let cycleNum = 0;
  while (true) {
    const et = etNow();
    if (marketClosed(et)) {
      await log("MARKET CLOSED (4:00 PM ET) — stopping monitor");
      break;
    }
    if (!marketOpen(et)) {
      await log(`Pre-market (${et.hour}:${String(et.minute).padStart(2, "0")} ET) — sleeping 5m`);
      await sleep(5 * 60_000);
      continue;
    }
    cycleNum++;
    await cycle(cycleNum);
    if (marketClosed(etNow())) break;
    await log(`Sleeping ${INTERVAL_MIN}m until next cycle`);
    await sleep(INTERVAL_MIN * 60_000);
  }
  await log("Monitor finished.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
