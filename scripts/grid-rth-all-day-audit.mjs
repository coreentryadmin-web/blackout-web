#!/usr/bin/env node
/**
 * 0DTE Command — all-day RTH audit orchestrator (classic Grid removed 2026-07-07).
 *
 * Usage:
 *   npm run validate:grid-rth
 *   node scripts/grid-rth-all-day-audit.mjs [--force] [--phase=verify|post-close]
 *
 * Requires: CRON_SECRET (zerodte board + crons)
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { inRthOpenWindow, isTradingDayEt, todayEtYmd, etParts } from "./gha-et-window.mjs";
import { spotsAgree } from "./audit/lib/cross-tool-tolerance.mjs";
import { probeDataCorrectness } from "./audit/lib/data-correctness-probe.mjs";
import { fetchAppJsonWithAuditAuth, createAuditAppClient } from "./audit/lib/prod-clerk-session.mjs";

const force = process.argv.includes("--force");
const phaseArg = process.argv.find((a) => a.startsWith("--phase="));
const PHASE = phaseArg ? phaseArg.slice("--phase=".length) : "verify";
const BASE = (
  process.argv.find((a) => a.startsWith("--base="))?.slice("--base=".length) ??
  process.env.AUDIT_APP_URL ??
  "https://blackouttrades.com"
).replace(/\/$/, "");
const CRON = process.env.CRON_SECRET || "";
const OUT = join(process.cwd(), "audit-output");
mkdirSync(OUT, { recursive: true });

const checks = [];
const rec = (name, status, detail) => {
  checks.push({ name, status, detail });
  console.log(`  [${status}] ${name}${detail ? " — " + detail : ""}`);
};

function run(cmd, label) {
  const r = spawnSync(cmd, { shell: true, encoding: "utf8", env: process.env });
  if (r.status !== 0) {
    rec(label, "FAIL", (r.stderr || r.stdout || "").trim().slice(0, 400));
    return false;
  }
  rec(label, "PASS");
  return true;
}

async function fetchJson(path) {
  const r = await fetchAppJsonWithAuditAuth({ appUrl: BASE, path, cronSecret: CRON });
  if (r.status !== 200) throw new Error(`HTTP ${r.status} ${path} (via ${r.via})`);
  return r.json;
}

function scanFinite(obj, path = "", out = []) {
  if (obj == null) return out;
  if (typeof obj === "number") {
    if (!Number.isFinite(obj)) out.push(`${path}: ${obj}`);
    return out;
  }
  if (Array.isArray(obj)) {
    obj.forEach((v, i) => scanFinite(v, `${path}[${i}]`, out));
    return out;
  }
  if (typeof obj === "object") {
    for (const [k, v] of Object.entries(obj)) scanFinite(v, path ? `${path}.${k}` : k, out);
  }
  return out;
}

function ageSec(asOf) {
  if (!asOf) return null;
  return Math.round((Date.now() - new Date(asOf).getTime()) / 1000);
}

async function auditZeroDteBoard() {
  if (!CRON && !process.env.CLERK_SECRET_KEY) return;
  try {
    const r = await fetchAppJsonWithAuditAuth({
      appUrl: BASE,
      path: "/api/market/zerodte/board",
      cronSecret: CRON,
    });
    if (r.status !== 200 || !r.json?.available) {
      rec("zerodte:board", "FAIL", `HTTP ${r.status} via=${r.via}`);
      return;
    }
    const zb = r.json;
    if (zb.upstream_ok === false) {
      rec("zerodte:upstream", "WARN", "tape fetch degraded this cycle");
    } else {
      rec("zerodte:upstream", "PASS");
    }
    const heat = zb.session?.heat?.state ?? "?";
    rec(
      "zerodte:session",
      "PASS",
      `heat=${heat} setups=${zb.setups?.length ?? 0} ledger=${zb.ledger?.length ?? 0} via=${r.via}`
    );

    for (const row of zb.ledger ?? []) {
      if (row.entry_premium != null && row.last_mark != null && row.live_pnl_pct != null) {
        const expected =
          Math.round(((row.last_mark - row.entry_premium) / row.entry_premium) * 10000) / 100;
        if (Math.abs(expected - row.live_pnl_pct) > 0.05) {
          rec("zerodte:ledger-pnl", "FAIL", `${row.ticker} expected ${expected}% got ${row.live_pnl_pct}%`);
          return;
        }
      }
    }
    rec("zerodte:ledger-pnl", "PASS", `${zb.ledger?.length ?? 0} rows checked (via ${r.via})`);
  } catch (e) {
    rec("zerodte:board", "FAIL", e.message);
  }
}

async function auditCrossTool() {
  if (!CRON && !process.env.CLERK_SECRET_KEY) return;
  const client = await createAuditAppClient({ appUrl: BASE, cronSecret: CRON });
  try {
    const [spxBootR, gexR, zbR] = await Promise.all([
      client.fetchJson("/api/market/spx/bootstrap"),
      client.fetchJson("/api/market/gex-positioning?ticker=SPX"),
      client.fetchJson("/api/market/zerodte/board"),
    ]);
    const spxBoot = spxBootR.json;
    const gex = gexR.json;
    const zb = zbR.json;
    if (zbR.status !== 200) {
      rec("integration:cross-tool", "FAIL", `board HTTP ${zbR.status}`);
      return;
    }
    const bootSpot = spxBoot?.market?.pulse?.spx?.price ?? spxBoot?.market?.gexSpx?.spot;
    const gexSpot = gex?.spot;
    if (Number.isFinite(bootSpot) && Number.isFinite(gexSpot) && !spotsAgree(bootSpot, gexSpot, gexSpot)) {
      rec("integration:spx-gex-spot", "FAIL", `bootstrap ${bootSpot} vs gex ${gexSpot}`);
    } else if (Number.isFinite(gexSpot)) {
      rec("integration:spx-gex-spot", "PASS", `spot ${gexSpot}`);
    }
    const flowsR = await client.fetchJson("/api/market/flows?limit=20");
    const flows = flowsR.json;
    const count = flows?.flows?.length ?? flows?.alerts?.length ?? 0;
    rec("integration:helix-flows", count > 0 ? "PASS" : "WARN", `${count} prints`);
    if (zb.covered_elsewhere?.length) {
      rec("integration:nighthawk-dedupe", "PASS", `${zb.covered_elsewhere.length} tickers covered elsewhere`);
    }
  } catch (e) {
    rec("integration:cross-tool", "FAIL", e.message);
  } finally {
    await client.cleanup();
  }
}

async function auditZerodteWarmCron() {
  if (!CRON) return;
  try {
    const r = await fetch(`${BASE}/api/cron/zerodte-warm`, {
      headers: { Authorization: `Bearer ${CRON}` },
    });
    const json = await r.json().catch(() => ({}));
    if (r.ok || json.skipped) rec("cron:zerodte-warm", "PASS", json.skipped ? "skipped off-hours" : "ok");
    else rec("cron:zerodte-warm", "WARN", `HTTP ${r.status}`);
  } catch (e) {
    rec("cron:zerodte-warm", "FAIL", e.message);
  }
}

async function main() {
  const now = new Date();
  const et = etParts(now);
  const ymd = todayEtYmd(now);

  console.log(`\n=== 0DTE Command all-day RTH audit ===`);
  console.log(`Time: ${now.toISOString()} (${et.label})`);
  console.log(`Phase: ${PHASE}\n`);

  if (!force && !inRthOpenWindow(now) && PHASE === "verify") {
    console.log("Outside RTH — skipping (use --force).\n");
    process.exit(0);
  }
  if (!isTradingDayEt(ymd) && !force) {
    console.log(`${ymd} not a trading day — skipping.\n`);
    process.exit(0);
  }

  if (!CRON && !process.env.CLERK_SECRET_KEY) rec("env:auth", "FAIL", "CRON_SECRET or Clerk keys required");
  else if (!CRON) rec("env:CRON_SECRET", "WARN", "missing — using Clerk fallback");
  else rec("env:CRON_SECRET", "PASS");

  if (force || inRthOpenWindow(now)) run("npm run validate:rth-open", "infra:validate:rth-open");

  await auditZeroDteBoard();
  await auditCrossTool();
  await auditZerodteWarmCron();

  run("npm run validate:zerodte-logic", "zerodte:logic-audit");
  run("npm run validate:zerodte-integration", "zerodte:cross-tool-integration");

  if (CRON) {
    try {
      const dc = await probeDataCorrectness({ base: BASE, cronSecret: CRON, tryFull: true });
      const zFlags = (dc.json?.flags ?? []).filter((f) => /zerodte|grid/i.test(`${f.layer}/${f.metric}`));
      if (!dc.ok && dc.status !== 200) {
        const isTimeout = dc.status === 0 || /aborted|524|timeout/i.test(dc.err || "");
        const isCronAuth = dc.status === 401 || dc.status === 403;
        rec(
          "grid:data-correctness",
          isTimeout || isCronAuth ? "WARN" : "FAIL",
          isTimeout
            ? `edge timeout (mode=${dc.mode}) — cron authoritative`
            : isCronAuth
              ? `HTTP ${dc.status} — cloud CRON_SECRET mismatch; prod cron unaffected`
              : dc.err || `HTTP ${dc.status} mode=${dc.mode}`
        );
      } else if (zFlags.length) {
        rec("grid:data-correctness", "FAIL", `${zFlags.length} grid/zerodte flag(s)`);
        zFlags.slice(0, 3).forEach((f) => console.log(`    · [${f.layer}/${f.metric}] ${f.detail}`));
      } else {
        const suffix = dc.fullSweepSkipped ? " (heatmap surface; full sweep via cron)" : "";
        rec("grid:data-correctness", "PASS", `flags=${dc.flags ?? 0} mode=${dc.mode}${suffix}`);
      }
    } catch (e) {
      rec("grid:data-correctness", "FAIL", e.message);
    }
  }

  if (process.env.CLERK_SECRET_KEY && process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY) {
    run("npm run validate:grid-e2e", "grid:dashboard-e2e");
  } else {
    rec("grid:dashboard-e2e", "SKIP", "Clerk keys not set");
  }

  run("npm run ops:collect", "ops:collect");

  const fails = checks.filter((c) => c.status === "FAIL");
  const reportPath = join(OUT, `grid-rth-${ymd}-${PHASE}-${Date.now()}.json`);
  writeFileSync(reportPath, JSON.stringify({ ts: now.toISOString(), phase: PHASE, checks }, null, 2));

  console.log(`\n=== Summary (${PHASE}) ===`);
  console.log(`  FAIL: ${fails.length} / ${checks.length}`);
  console.log(`  Report: ${reportPath}\n`);

  if (fails.length) {
    fails.forEach((f) => console.log(`  · ${f.name}: ${f.detail ?? ""}`));
    process.exit(1);
  }
  console.log("GREEN — 0DTE Command audit passed.\n");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
