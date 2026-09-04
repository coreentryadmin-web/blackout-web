#!/usr/bin/env node
/**
 * RTH live monitor — validates platform + four engines every 5 minutes until market close.
 *
 * Coverage (when Clerk/CRON secrets available via auditSecret):
 *   - data-validator (pin direction + quote header %, cross-provider)
 *   - four-engine play audit (SPX Slayer, Legacy, 0DTE, Vector)
 *   - Vector RTH quick, SPX RTH, Grid/0DTE RTH, Legacy + NH Vector UI
 *   - platform-integrity, gha-smoke, zerodte BIE, vector pick sweep
 *
 * Usage:
 *   npm run validate:rth-live-monitor
 *   node scripts/rth-live-monitor.mjs --once
 *   node scripts/rth-live-monitor.mjs --interval-min=5 --force
 *
 * Logs: audit-output/rth-live-monitor.log
 * Status: audit-output/rth-live-monitor-status.json
 */
import { spawnSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { etParts, isTradingDayEt, todayEtYmd } from "./gha-et-window.mjs";
import { auditSecret, loadProdSecretsFromAws } from "./audit/lib/prod-secrets.mjs";

const ENV_AUDIT = join(process.cwd(), "audit-output", ".env.audit");

/** Hydrate process.env from AWS SM + cached audit-output/.env.audit (best-effort). */
function hydrateAuditEnv() {
  const fromAws = loadProdSecretsFromAws();
  for (const [k, v] of Object.entries(fromAws)) {
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

hydrateAuditEnv();

const args = process.argv.slice(2);
const ONCE = args.includes("--once");
const FORCE = args.includes("--force");
const INTERVAL_MIN = Number(
  args.find((a) => a.startsWith("--interval-min="))?.slice("--interval-min=".length) ?? 5
);
const OUT = join(process.cwd(), "audit-output");
const LOG = join(OUT, "rth-live-monitor.log");
const STATUS = join(OUT, "rth-live-monitor-status.json");
mkdirSync(OUT, { recursive: true });

function etNow() {
  const p = etParts(new Date());
  return { ...p, minutes: p.mins };
}

function inAgentWindow(et) {
  if (FORCE) return true;
  if (et.weekday === "Sat" || et.weekday === "Sun") return false;
  return et.minutes >= 9 * 60 && et.minutes <= 16 * 60 + 15;
}

function inCashRth(et) {
  if (FORCE) return true;
  if (et.weekday === "Sat" || et.weekday === "Sun") return false;
  return et.minutes >= 9 * 60 + 30 && et.minutes < 16 * 60;
}

function marketDone(et) {
  if (FORCE) return false;
  return et.minutes > 16 * 60 + 15 || et.weekday === "Sat" || et.weekday === "Sun";
}

function secretsReady() {
  return !!(auditSecret("CLERK_SECRET_KEY") || auditSecret("CRON_SECRET"));
}

function log(line) {
  const msg = `[${new Date().toISOString()}] ${line}`;
  console.log(msg);
  appendFileSync(LOG, msg + "\n");
}

function runCmd(cmd, label, timeoutMs = 300_000) {
  const started = Date.now();
  const r = spawnSync(cmd, {
    shell: true,
    encoding: "utf8",
    env: process.env,
    maxBuffer: 24 * 1024 * 1024,
    timeout: timeoutMs,
  });
  const ms = Date.now() - started;
  const ok = r.status === 0;
  const tail = (r.stdout || r.stderr || "").trim().split("\n").slice(-6).join(" | ");
  return { ok, label, status: r.status ?? -1, ms, tail };
}

async function runCycle(cycle) {
  const et = etNow();
  log(`——— CYCLE ${cycle} (${et.label} ET, RTH=${inCashRth(et)}, secrets=${secretsReady()}) ———`);

  const jobs = [
    ["npm run validate:gha-smoke", "gha-smoke", 90_000],
    ["npm run validate:platform-integrity", "platform-integrity", 120_000],
    ["npm run validate:api-auth", "api-auth", 90_000],
    // Branch play-engine regression — no secrets required.
    ["node --import tsx --test src/lib/zerodte/gates.test.ts", "zerodte-gates-unit", 120_000],
    ["node --import tsx --test src/lib/zerodte/vector-commit-boost.test.ts", "zerodte-vector-boost-unit", 60_000],
    // Public live regime probe (0DTE board context).
    [
      'curl -sfS "https://blackouttrades.com/api/market/regime" | node -e "let d=\'\';process.stdin.on(\'data\',c=>d+=c);process.stdin.on(\'end\',()=>{const j=JSON.parse(d);if(!j.marketOpen||!j.regime)process.exit(1);console.log(j.regime,j.flowRegime);})"',
      "regime-live",
      30_000,
    ],
  ];

    if (secretsReady()) {
    jobs.push(
      ["node scripts/audit/data-validator.mjs", "data-validator", 360_000],
      ["node scripts/audit/rth-four-engine-play-audit.mjs", "four-engine-plays", 240_000],
      ["node scripts/audit/play-engine-quality-audit.mjs", "play-engine-quality", 180_000],
      ["npm run validate:vector-rth-quick", "vector-rth", 150_000]
    );
    if (inCashRth(et)) {
      jobs.push(
        ["npm run validate:spx-rth", "spx-rth", 300_000],
        ["npm run validate:grid-rth", "grid-0dte-rth", 300_000],
        ["node scripts/audit/zerodte-bie-consistency-validator.mjs", "zerodte-bie", 120_000],
        ["npm run validate:legacy-board-ui", "legacy-ui", 180_000],
        ["npm run validate:nighthawk-vector-board-ui", "nighthawk-vector-ui", 180_000],
        ["NODE_USE_ENV_PROXY=1 npm run validate:nighthawk-prod-check", "nighthawk-prod", 180_000]
      );
    } else if (et.minutes >= 9 * 60) {
      jobs.push(["npm run validate:rth-open", "rth-open-prewarm", 240_000]);
    }
    if (cycle % 3 === 0) {
      jobs.push(["npm run validate:zerodte-logic", "zerodte-logic", 180_000]);
    }
    if (cycle % 6 === 0) {
      jobs.push(
        ["npm run validate:deploy", "validate-deploy", 420_000],
        ["npm run validate:vector-pick-pnl", "vector-pick-pnl", 150_000],
        ["node --import tsx scripts/audit/vector-pick-sweep-audit.mjs --json", "vector-sweep", 120_000]
      );
    }
  } else {
    log("WARN — CLERK_SECRET_KEY/CRON_SECRET not loaded; running public probes only");
  }

  const results = [];
  for (const [cmd, label, timeout] of jobs) {
    const r = runCmd(cmd, label, timeout);
    results.push(r);
    log(`${r.ok ? "PASS" : "FAIL"} ${label} exit=${r.status} ${r.ms}ms`);
    if (!r.ok) appendFileSync(join(OUT, `rth-live-fail-${label}.log`), `${r.tail}\n\n`);
  }

  const fails = results.filter((r) => !r.ok).length;
  const summary = {
    cycle,
    at: new Date().toISOString(),
    et: et.label,
    inCashRth: inCashRth(et),
    secretsReady: secretsReady(),
    passed: results.length - fails,
    total: results.length,
    results: results.map((r) => ({ label: r.label, ok: r.ok, ms: r.ms, status: r.status })),
  };
  writeFileSync(STATUS, JSON.stringify(summary, null, 2));
  log(`CYCLE ${cycle} DONE — ${summary.passed}/${summary.total} passed`);
  return fails;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  const ymd = todayEtYmd();
  if (!FORCE && !isTradingDayEt(ymd)) {
    console.log(`${ymd} is not a trading day — exiting (use --force)`);
    process.exit(0);
  }

  log(`RTH live monitor start — interval ${INTERVAL_MIN}m, branch validation sweep`);
  let cycle = 0;

  do {
    const et = etNow();
    if (marketDone(et)) {
      log("Market window closed (after 4:15 PM ET) — stopping");
      break;
    }
    if (!inAgentWindow(et)) {
      log(`Outside agent window (${et.label} ET) — sleeping ${INTERVAL_MIN}m`);
      if (ONCE) break;
      await sleep(INTERVAL_MIN * 60_000);
      continue;
    }

    cycle += 1;
    const fails = await runCycle(cycle);
    if (ONCE) process.exit(fails > 0 ? 1 : 0);

    if (marketDone(etNow())) break;
    log(`Sleeping ${INTERVAL_MIN}m until next cycle`);
    await sleep(INTERVAL_MIN * 60_000);
  } while (true);

  log("RTH live monitor finished.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
