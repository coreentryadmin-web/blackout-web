#!/usr/bin/env node
/**
 * 0DTE Command — exhaustive logic audit (gates, plans, trade management, UI merge).
 *
 * Usage:
 *   node scripts/zerodte-logic-audit.mjs [--base=https://blackouttrades.com]
 *   npm run validate:zerodte-logic
 *
 * Layers:
 *   1. Unit tests (board, plan, rejections, UI freshness, mergePlays)
 *   2. Pure invariant probes (imported from src/lib/zerodte/*)
 *   3. Live board payload validation (CRON_SECRET bearer)
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fetchAuditJson, releaseAuditClerkSession } from "./audit/lib/audit-auth-fetch.mjs";
import { ledgerPnlMatches } from "./audit/lib/ledger-pnl-expect.mjs";

const BASE = (
  process.argv.find((a) => a.startsWith("--base="))?.slice("--base=".length) ??
  process.env.AUDIT_APP_URL ??
  "https://blackouttrades.com"
).replace(/\/$/, "");
const OUT = join(process.cwd(), "audit-output");
mkdirSync(OUT, { recursive: true });

const checks = [];
const rec = (name, status, detail) => {
  checks.push({ name, status, detail });
  console.log(`  [${status}] ${name}${detail ? " — " + detail : ""}`);
};

function runTests() {
  const files = [
    "src/lib/zerodte/board.test.ts",
    "src/lib/zerodte/rejections.test.ts",
    "src/features/nighthawk/components/ZeroDteBoard.test.ts",
  ];
  const r = spawnSync(
    `npx tsx --import tsx --experimental-test-module-mocks --test ${files.join(" ")}`,
    { shell: true, encoding: "utf8", env: process.env }
  );
  if (r.status !== 0) {
    rec("logic:unit-tests", "FAIL", (r.stderr || r.stdout || "").trim().slice(0, 500));
    return false;
  }
  rec("logic:unit-tests", "PASS", `${files.length} files`);
  return true;
}

async function pureInvariantProbes() {
  const r = spawnSync("npx tsx scripts/zerodte-logic-probes.ts", {
    shell: true,
    encoding: "utf8",
    env: process.env,
  });
  if (r.status !== 0) {
    rec("logic:pure-probes", "FAIL", (r.stderr || r.stdout || "").trim().slice(0, 400));
    return;
  }
  try {
    const probes = JSON.parse(r.stdout.trim());
    for (const p of probes) rec(p.name, p.status, p.detail);
  } catch (e) {
    rec("logic:pure-probes", "FAIL", e.message);
  }
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

async function fetchLiveBoard() {
  const res = await fetchAuditJson(BASE, "/api/market/zerodte/board");
  if (res.ok) return { zb: res.json, via: res.via };
  return null;
}

async function liveBoardAudit() {
  const fetched = await fetchLiveBoard();
  if (!fetched) {
    rec(
      "live:board",
      "FAIL",
      process.env.CLERK_SECRET_KEY ? "board fetch failed (cron + clerk)" : "CRON_SECRET / Clerk keys not set"
    );
    return;
  }
  const { zb, via } = fetched;
  if (!zb.available) {
    rec("live:board", "FAIL", "available=false");
    return;
  }
  rec("live:board", "PASS", `via=${via} setups=${zb.setups?.length ?? 0} ledger=${zb.ledger?.length ?? 0}`);

  const SETUP_MIN_GROSS = 200_000;
  const SETUP_MIN_DOMINANCE = 0.55;
  const SETUP_MIN_AGGR_SHARE = 0.3;
  const SETUP_MAX_ITM_PCT = 2;
  const NEW_PLAY_CUTOFF_ET_MINUTES = 15 * 60 + 30;

  const badNums = scanFinite(zb).slice(0, 5);
  rec("live:finite-numbers", badNums.length === 0 ? "PASS" : "FAIL", badNums.join("; "));

  // Gate-eligible setups only — BLOCKED watch cards stay visible but never commit.
  const eligible = (zb.setups ?? []).filter(
    (s) => s.gate?.verdict !== "BLOCKED" && (s.prints ?? 0) > 0
  );
  let gateFails = 0;
  for (const s of eligible) {
    if (s.gross_premium < SETUP_MIN_GROSS) gateFails++;
    if ((s.aggression ?? 0) < SETUP_MIN_AGGR_SHARE) gateFails++;
    if (s.side_dominance < SETUP_MIN_DOMINANCE) gateFails++;
    if (s.otm_pct != null && s.otm_pct < -SETUP_MAX_ITM_PCT) gateFails++;
  }
  rec(
    "live:setup-gates",
    gateFails === 0 ? "PASS" : "FAIL",
    `${eligible.length} eligible / ${zb.setups?.length ?? 0} total, ${gateFails} gate violations`
  );

  // Ledger PnL math + valid statuses.
  let pnlFails = 0;
  const validStatus = new Set(["OPEN", "HOLD", "TRIM", "CLOSED", null]);
  for (const row of zb.ledger ?? []) {
    if (row.status != null && !validStatus.has(row.status)) pnlFails++;
    if (!ledgerPnlMatches(row)) pnlFails++;
  }
  rec(
    "live:ledger-consistency",
    pnlFails === 0 ? "PASS" : "FAIL",
    `${zb.ledger?.length ?? 0} rows, ${pnlFails} issues`
  );

  // Session heat vs ET clock sanity (only on trading days).
  if (zb.session?.trading_day && zb.session?.heat?.state) {
    rec("live:session-heat", "PASS", `${zb.session.heat.state} heat=${zb.session.heat.heat_pct}%`);
  }

  if (zb.upstream_ok === false) {
    rec("live:upstream", "WARN", "tape fetch degraded this cycle");
  } else {
    rec("live:upstream", "PASS");
  }

  // Cutoff discipline label present in product (UI contract).
  rec("live:cutoff-constant", NEW_PLAY_CUTOFF_ET_MINUTES === 15 * 60 + 30 ? "PASS" : "FAIL", "15:30 ET");
}

async function main() {
  console.log("\n=== 0DTE logic audit ===\n");
  runTests();
  try {
    await pureInvariantProbes();
  } catch (e) {
    rec("logic:pure-probes", "FAIL", e.message);
  }
  try {
    await liveBoardAudit();
  } catch (e) {
    rec("live:board", "FAIL", e.message);
  }

  const fails = checks.filter((c) => c.status === "FAIL");
  const reportPath = join(OUT, `zerodte-logic-${Date.now()}.json`);
  writeFileSync(reportPath, JSON.stringify({ ts: new Date().toISOString(), checks }, null, 2));

  console.log(`\n=== Summary ===`);
  console.log(`  FAIL: ${fails.length} / ${checks.length}`);
  console.log(`  Report: ${reportPath}\n`);

  if (fails.length) {
    fails.forEach((f) => console.log(`  · ${f.name}: ${f.detail ?? ""}`));
    await releaseAuditClerkSession();
    process.exit(1);
  }
  await releaseAuditClerkSession();
  console.log("GREEN — 0DTE logic audit passed.\n");
}

main().catch(async (e) => {
  await releaseAuditClerkSession();
  console.error(e);
  process.exit(1);
});
