#!/usr/bin/env node
/**
 * Cross-surface platform data integrity probe (prod-safe, no auth for public reads).
 *
 *   npm run validate:platform-integrity
 *   VALIDATE_BASE_URL=https://staging.blackouttrades.com npm run validate:platform-integrity
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const BASE = (process.env.VALIDATE_BASE_URL ?? "https://blackouttrades.com").replace(/\/$/, "");
const OUT = join(process.cwd(), "audit-output");
mkdirSync(OUT, { recursive: true });

const checks = [];

function rec(name, status, detail, extra = {}) {
  checks.push({ name, status, detail, ...extra });
  const icon = status === "PASS" ? "✓" : status === "FAIL" ? "✗" : status === "WARN" ? "!" : "·";
  console.log(`  ${icon} [${status}] ${name}${detail ? ` — ${detail}` : ""}`);
}

async function fetchJson(path, opts = {}) {
  const res = await fetch(`${BASE}${path}`, { cache: "no-store", ...opts });
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body };
}

function spotOk(n) {
  return typeof n === "number" && Number.isFinite(n) && n > 0;
}

async function main() {
  console.log(`\n=== Platform data integrity @ ${BASE} ===\n`);

  const health = await fetchJson("/api/health");
  rec("health", health.status === 200 ? "PASS" : "FAIL", `status=${health.status}`);

  const ready = await fetchJson("/api/ready");
  rec("ready", ready.status === 200 ? "PASS" : "FAIL", `status=${ready.status}`);

  const desk = await fetchJson("/api/market/spx/desk");
  const deskSpot = desk.body?.price ?? desk.body?.spx?.price;
  rec(
    "spx-desk-spot",
    desk.status === 401
      ? "SKIP"
      : desk.status === 200 && spotOk(deskSpot)
        ? "PASS"
        : "FAIL",
    desk.status === 401 ? "tier-gated" : deskSpot != null ? `SPX ${deskSpot}` : `status=${desk.status}`
  );

  const matrix = await fetchJson("/api/market/gex-heatmap?ticker=SPX");
  const matrixSpot = matrix.body?.spot;
  const flip = matrix.body?.gex?.flip;
  const strikeCount = Object.keys(matrix.body?.gex?.strike_totals ?? {}).length;
  rec(
    "thermal-spx-matrix",
    matrix.status === 401
      ? "SKIP"
      : matrix.status === 200 && matrix.body?.available && strikeCount > 0
        ? "PASS"
        : matrix.status === 200 && matrix.body?.error
          ? "WARN"
          : "FAIL",
    matrix.status === 401
      ? "tier-gated"
      : `spot=${matrixSpot} flip=${flip} strikes=${strikeCount}`
  );

  if (spotOk(deskSpot) && spotOk(matrixSpot)) {
    const div = Math.abs(deskSpot - matrixSpot) / matrixSpot;
    rec(
      "desk-matrix-spot-divergence",
      div <= 0.01 ? "PASS" : div <= 0.02 ? "WARN" : "FAIL",
      `${(div * 100).toFixed(3)}% (desk ${deskSpot} vs matrix ${matrixSpot})`
    );
  } else {
    rec("desk-matrix-spot-divergence", "SKIP", "missing spot on one surface");
  }

  const pos = await fetchJson("/api/market/gex-positioning?ticker=SPX");
  rec(
    "gex-positioning-spx",
    pos.status === 200 && pos.body?.available !== false ? "PASS" : "WARN",
    `flip=${pos.body?.flip ?? pos.body?.gamma_flip ?? "—"} king=${pos.body?.gex_king_strike ?? "—"}`
  );

  for (const t of ["SPY", "QQQ"]) {
    const hm = await fetchJson(`/api/market/gex-heatmap?ticker=${t}`);
    const n = Object.keys(hm.body?.gex?.strike_totals ?? {}).length;
    rec(
      `thermal-matrix-${t}`,
      hm.status === 200 && n > 0 ? "PASS" : "WARN",
      `strikes=${n} spot=${hm.body?.spot ?? "—"}`
    );
  }

  const vec = await fetchJson("/api/market/vector/walls?ticker=SPX&dte=0dte");
  rec(
    "vector-spx-0dte-walls",
    vec.status === 200 && spotOk(vec.body?.spot) ? "PASS" : "WARN",
    `spot=${vec.body?.spot ?? "—"} flip=${vec.body?.gamma_flip ?? "—"}`
  );

  const regime = await fetchJson("/api/market/regime");
  rec("helix-regime", regime.status === 200 ? "PASS" : "WARN", regime.body?.regime_label ?? regime.body?.label ?? "—");

  const flows = await fetchJson("/api/market/flows?limit=5");
  rec(
    "helix-flows",
    flows.status === 401 ? "SKIP" : flows.status === 200 ? "PASS" : "WARN",
    flows.status === 401 ? "tier-gated" : `count=${flows.body?.count ?? flows.body?.flows?.length ?? "—"}`
  );

  const nh = await fetchJson("/api/market/nighthawk/edition");
  rec(
    "nighthawk-edition",
    nh.status === 401 ? "SKIP" : nh.status === 200 ? "PASS" : "WARN",
    nh.status === 401
      ? "tier-gated"
      : nh.body?.available
        ? `${nh.body.play_count ?? 0} plays · ${nh.body.edition_for ?? "live"}`
        : "no edition"
  );

  const zd = await fetchJson("/api/market/zerodte/board");
  rec(
    "zerodte-board",
    zd.status === 401 ? "SKIP" : zd.status === 200 ? "PASS" : "WARN",
    zd.status === 401 ? "tier-gated" : `${(zd.body?.plays ?? []).length} rows`
  );

  const fail = checks.filter((c) => c.status === "FAIL").length;
  const warn = checks.filter((c) => c.status === "WARN").length;
  const pass = checks.filter((c) => c.status === "PASS").length;
  const skip = checks.filter((c) => c.status === "SKIP").length;

  const report = {
    base: BASE,
    at: new Date().toISOString(),
    pass,
    warn,
    fail,
    skip,
    checks,
  };
  const outPath = join(OUT, `platform-integrity-${Date.now()}.json`);
  writeFileSync(outPath, JSON.stringify(report, null, 2));

  console.log(`\nSummary: ${pass} pass, ${warn} warn, ${fail} fail, ${skip} skip`);
  console.log(`Report: ${outPath}\n`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error("FAIL:", e.message);
  process.exit(1);
});
