#!/usr/bin/env node
/**
 * RTH site-wide latency gate — run at/after 09:30 ET on trading days.
 *
 * 1. Force platform-warm (all tools, not SPX-only)
 * 2. Assert warm crons are fresh (platform-warm, heatmap-warm, desk-warm)
 * 3. Run validate:site-latency (API + browser paint for every premium surface)
 *
 * Usage:
 *   npm run validate:rth-latency
 *   node scripts/rth-site-latency.mjs --force
 */
import { spawnSync } from "node:child_process";
import { createAuditClient, resolveAuditDbUrl } from "./pg-audit.mjs";
import { isTradingDayEt, todayEtYmd } from "./gha-et-window.mjs";

const ET = "America/New_York";
const force = process.argv.includes("--force");
/** Public origin for audits — Clerk + Cloudflare; never use internal ALB DNS here. */
const AUDIT_BASE = "https://blackouttrades.com";
const BASE = AUDIT_BASE.replace(/\/$/, "");

function etParts(now = new Date()) {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: ET,
    weekday: "short",
    hour: "numeric",
    minute: "numeric",
    hour12: false,
  });
  const parts = Object.fromEntries(fmt.formatToParts(now).map((p) => [p.type, p.value]));
  const hour = Number(parts.hour);
  const minute = Number(parts.minute);
  return {
    weekday: parts.weekday,
    mins: hour * 60 + minute,
    label: `${parts.weekday} ${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")} ET`,
  };
}

/** US equity cash RTH: weekday 09:30–16:00 ET */
function inCashRth(now = new Date()) {
  const { weekday, mins } = etParts(now);
  if (weekday === "Sat" || weekday === "Sun") return false;
  return mins >= 9 * 60 + 30 && mins <= 16 * 60;
}

async function main() {
  const now = new Date();
  const et = etParts(now);
  const tradingDay = isTradingDayEt(todayEtYmd(now));

  console.log(`\n=== RTH site-wide latency ===`);
  console.log(`Time: ${now.toISOString()} (${et.label})\n`);

  if (!force && !inCashRth(now)) {
    console.log("Outside cash RTH (weekday 09:30–16:00 ET) — use --force to override.\n");
    process.exit(0);
  }
  if (!tradingDay && !force) {
    console.log(`${todayEtYmd(now)} is not a trading day — skipping.\n`);
    process.exit(0);
  }

  const cron = process.env.CRON_SECRET?.trim() ?? "";
  const failures = [];

  if (cron) {
    console.log("1. Force platform-warm (desk + heatmap + vector + zerodte + flows)");
    try {
      const t0 = performance.now();
      const res = await fetch(`${BASE}/api/cron/platform-warm?force=1`, {
        headers: { Authorization: `Bearer ${cron}`, Accept: "application/json" },
      });
      const body = await res.json().catch(() => ({}));
      const ms = Math.round(performance.now() - t0);
      if (res.status === 200 && body.ok !== false) {
        console.log(`  ✓ platform-warm ${ms}ms — warmed ${body.warmed ?? "?"}/${body.total ?? "?"}`);
      } else {
        failures.push(`platform-warm HTTP ${res.status} — ${JSON.stringify(body).slice(0, 120)}`);
        console.log(`  ✗ platform-warm HTTP ${res.status}`);
      }
    } catch (e) {
      failures.push(`platform-warm: ${e.message}`);
      console.log(`  ✗ platform-warm: ${e.message}`);
    }
  } else {
    console.log("  ⚠ CRON_SECRET unset — skipping platform-warm");
  }

  const dbUrl = resolveAuditDbUrl();
  if (dbUrl && tradingDay) {
    console.log("\n2. Warm cron freshness (last 15m)");
    try {
      const c = createAuditClient(dbUrl);
      await c.connect();
      for (const key of ["platform-warm", "heatmap-warm", "desk-warm", "vector-universe-snapshot", "zerodte-warm"]) {
        const row = (
          await c.query(
            `SELECT COUNT(*)::int AS n FROM cron_job_runs
             WHERE job_key = $1 AND started_at > NOW() - INTERVAL '15 minutes' AND status = 'ok'`,
            [key]
          )
        ).rows[0];
        if (row.n > 0) console.log(`  ✓ ${key} ok in last 15m (${row.n})`);
        else {
          failures.push(`${key}: no ok run in last 15m during RTH`);
          console.log(`  ✗ ${key}: no ok run in last 15m`);
        }
      }
      await c.end();
    } catch (e) {
      failures.push(`Postgres warm checks: ${e.message}`);
      console.log(`  ✗ Postgres warm checks: ${e.message}`);
    }
  } else {
    console.log("\n2. Warm cron freshness — skipped (no DATABASE_URL or non-trading day)");
  }

  console.log("\n3. Full-site latency audit (API warm + browser paint)");
  const audit = spawnSync("node", ["scripts/site-latency-audit.mjs", `--base=${BASE}`], {
    stdio: "inherit",
    env: process.env,
  });
  if (audit.status !== 0) failures.push("validate:site-latency failed");

  if (failures.length) {
    console.error(`\nRTH site latency FAILED (${failures.length}):`);
    failures.forEach((f) => console.error(`  · ${f}`));
    process.exit(1);
  }

  console.log("\nGREEN — RTH site-wide latency passed.\n");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
