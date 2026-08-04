#!/usr/bin/env node
/**
 * Live validation for 0DTE Architecture V2 Phase 2b–3 + shadow priors flip.
 * Auth: temp admin Clerk user (deleted in finally).
 */
import fs from "node:fs";
import path from "node:path";
import { mintClerkPremiumSession } from "./lib/prod-clerk-session.mjs";

const BASE = (process.env.CRON_TARGET_BASE_URL ?? "https://blackouttrades.com").replace(/\/$/, "");
const ART = process.env.ZERODTE_V2_VALIDATE_DIR || "/opt/cursor/artifacts/zerodte-v2-live-validate";

const rows = [];
const rec = (name, status, detail = "") => {
  rows.push({ name, status, detail });
  const icon = status === "PASS" ? "✓" : status === "WARN" ? "⚠" : status === "SKIP" ? "○" : "✗";
  console.log(`  ${icon} [${status}] ${name}${detail ? ` — ${detail}` : ""}`);
};

async function authedFetch(cookieHeader, urlPath) {
  const res = await fetch(`${BASE}${urlPath}`, {
    headers: { Cookie: cookieHeader, Accept: "application/json" },
    cache: "no-store",
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* html or empty */
  }
  return { res, json, text };
}

function hasKeys(obj, keys) {
  return obj && typeof obj === "object" && keys.every((k) => k in obj);
}

async function main() {
  fs.mkdirSync(ART, { recursive: true });
  console.log(`\n=== 0DTE V2 live validation (${BASE}) ===\n`);

  // ── Public smoke ────────────────────────────────────────────────────────
  for (const route of ["/api/health", "/api/ready"]) {
    const r = await fetch(`${BASE}${route}`);
    rec(route, r.ok ? "PASS" : "FAIL", String(r.status));
  }

  const auth = await mintClerkPremiumSession({ appUrl: BASE });
  if (auth.skip) {
    console.error("Auth skip:", auth.reason);
    process.exit(1);
  }

  try {
    // ── Night Hawk board API (member path) ──────────────────────────────────
    const board = await authedFetch(auth.cookieHeader, "/api/market/zerodte/board");
    rec("GET /api/market/zerodte/board", board.res.ok ? "PASS" : "FAIL", String(board.res.status));

    if (board.json) {
      const b = board.json;
      rec("board: market_state field", "market_state" in b ? "PASS" : "FAIL");
      rec("board: discovery_funnel field", "discovery_funnel" in b ? "PASS" : "FAIL");

      if (b.market_state && typeof b.market_state === "object") {
        rec(
          "board: market_state shape",
          hasKeys(b.market_state, ["confidence", "rail_weights", "regime_structure"]) ? "PASS" : "FAIL",
          `confidence=${b.market_state.confidence ?? "?"}`,
        );
      } else {
        rec("board: market_state populated", "WARN", "null/off-hours — field present");
      }

      if (b.discovery_funnel?.summary) {
        rec("board: discovery_funnel summary", "PASS", b.discovery_funnel.summary.slice(0, 80));
      } else {
        rec("board: discovery_funnel summary", "WARN", "empty — no rejections/events today yet");
      }

      fs.writeFileSync(path.join(ART, "board.json"), JSON.stringify({
        market_state: b.market_state,
        discovery_funnel: b.discovery_funnel,
        setups_count: Array.isArray(b.setups) ? b.setups.length : null,
        phase: b.phase,
      }, null, 2));
    }

    // ── Admin graduation (Phase 3) ──────────────────────────────────────────
    const grad = await authedFetch(auth.cookieHeader, "/api/admin/zerodte/graduation");
    rec("GET /api/admin/zerodte/graduation", grad.res.ok ? "PASS" : "FAIL", String(grad.res.status));

    if (grad.json) {
      const mode = grad.json.shadow_week?.mode;
      rec("graduation: shadow_week.mode", mode === "shadow" ? "PASS" : mode === "off" ? "FAIL" : "WARN", String(mode));
      rec("graduation: any_rail_ready", grad.json.any_rail_ready === false ? "PASS" : "WARN", String(grad.json.any_rail_ready));
      rec(
        "graduation: methodology present",
        typeof grad.json.methodology === "string" && grad.json.methodology.length > 20 ? "PASS" : "WARN",
      );
      fs.writeFileSync(path.join(ART, "graduation.json"), JSON.stringify(grad.json, null, 2));
    }

    // ── Admin funnel (Phase 2b) ───────────────────────────────────────────
    const funnel = await authedFetch(auth.cookieHeader, "/api/admin/zerodte/funnel");
    rec("GET /api/admin/zerodte/funnel", funnel.res.ok ? "PASS" : "FAIL", String(funnel.res.status));

    if (funnel.json) {
      rec("funnel: session_date", funnel.json.session_date ? "PASS" : "WARN", funnel.json.session_date ?? "missing");
      rec("funnel: events array", Array.isArray(funnel.json.events) ? "PASS" : "FAIL");
      rec("funnel: rejections array", Array.isArray(funnel.json.rejections) ? "PASS" : "FAIL");
      fs.writeFileSync(path.join(ART, "funnel.json"), JSON.stringify({
        session_date: funnel.json.session_date,
        events: funnel.json.events?.length ?? 0,
        rejections: funnel.json.rejections?.length ?? 0,
        summary: funnel.json.summary,
      }, null, 2));
    }

    // ── Served HTML markers (no browser) ────────────────────────────────────
    const nhPage = await fetch(`${BASE}/nighthawk`, {
      headers: { Cookie: auth.cookieHeader, Accept: "text/html" },
      redirect: "follow",
    });
    const nhHtml = await nhPage.text();
    rec("GET /nighthawk HTML", nhPage.ok ? "PASS" : "FAIL", String(nhPage.status));
    rec("nighthawk: nh-v2 shell", /nh-v2/.test(nhHtml) ? "PASS" : "FAIL");
    rec("nighthawk: ZeroDteBoard chunk", /ZeroDteBoard|zerodte|0DTE/i.test(nhHtml) ? "PASS" : "WARN");

    const adminPage = await fetch(`${BASE}/admin?tab=bie`, {
      headers: { Cookie: auth.cookieHeader, Accept: "text/html" },
      redirect: "follow",
    });
    const adminHtml = await adminPage.text();
    rec("GET /admin?tab=bie HTML", adminPage.ok ? "PASS" : "FAIL", String(adminPage.status));
    rec("admin bie: AdminBieDashboard", /AdminBieDashboard|admin-bie|intelligence/i.test(adminHtml) ? "PASS" : "WARN");

    fs.writeFileSync(path.join(ART, "report.json"), JSON.stringify({ base: BASE, rows, at: new Date().toISOString() }, null, 2));

    const fails = rows.filter((r) => r.status === "FAIL").length;
    const warns = rows.filter((r) => r.status === "WARN").length;
    console.log(`\n=== Summary ===`);
    console.log(`  PASS ${rows.filter((r) => r.status === "PASS").length} · WARN ${warns} · FAIL ${fails}`);
    console.log(`  Artifacts: ${ART}/\n`);
    if (fails) process.exit(1);
  } finally {
    await auth.cleanup();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
