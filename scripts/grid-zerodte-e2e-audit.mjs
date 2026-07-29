#!/usr/bin/env node
/**
 * 0DTE Command E2E audit (API + Playwright when available).
 *
 * Classic Grid (the /grid page + its /api/grid/* routes) was deleted 2026-07-07 — this script
 * used to audit BOTH classic Grid's APIs and 0DTE Command's API in one pass. It's kept (not
 * deleted) because the 0DTE Command checks are still live and useful; only the classic-Grid-
 * specific checks were removed. 0DTE Command now lives standalone on /nighthawk.
 *
 * Usage:
 *   node scripts/grid-zerodte-e2e-audit.mjs [--base=https://blackouttrades.com]
 *   npm run validate:grid-e2e
 *
 * Requires: CLERK_SECRET_KEY, NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";
import { fetchAuditJson, releaseAuditClerkSession } from "./audit/lib/audit-auth-fetch.mjs";
import {
  mintIosPlaywrightSession,
  onboardingInitScript,
} from "./audit/lib/ios-playwright-auth.mjs";

const baseArg = process.argv.find((a) => a.startsWith("--base="));
const BASE = (baseArg ? baseArg.slice("--base=".length) : "https://blackouttrades.com").replace(
  /\/$/,
  ""
);
const SECRET = process.env.CLERK_SECRET_KEY;
const PUB = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY || "";
const UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";
const OUT = join(process.cwd(), "audit-output");
mkdirSync(OUT, { recursive: true });

const checks = [];
const rec = (name, status, detail) => {
  checks.push({ name, status, detail });
  console.log(`  [${status}] ${name}${detail ? " — " + detail : ""}`);
};

async function auditGridApis() {
  const zb = await fetchAuditJson(BASE, "/api/market/zerodte/board");
  if (zb.ok && zb.json?.available) {
    rec(
      "e2e:zerodte-board-api",
      "PASS",
      `${zb.json.setups?.length ?? 0} setups · ledger ${zb.json.ledger?.length ?? 0} (via ${zb.via})`
    );
  } else if (zb.status === 403) {
    rec("e2e:zerodte-board-api", "WARN", "403 — follows Night Hawk's launch gate (requireToolApi('nighthawk'))");
  } else {
    rec("e2e:zerodte-board-api", "FAIL", `HTTP ${zb.status}`);
  }

  // Classic Grid (the /grid page, its 17 components, its 9 /api/grid/* routes) was deleted
  // 2026-07-07 — see docs/audit/FINDINGS.md. 0DTE Command now lives standalone on /nighthawk;
  // its only API route (/api/market/zerodte/board, checked above) is unchanged.

  const flows = await fetchAuditJson(BASE, "/api/market/flows?limit=20");
  const count = flows.json?.flows?.length ?? flows.json?.alerts?.length ?? 0;
  rec("e2e:helix-flows", count > 0 ? "PASS" : "WARN", `${count} prints`);
}

async function auditGridUi() {
  let browser;
  try {
    const pw = await mintIosPlaywrightSession({ appUrl: BASE });
    if (pw.skip) {
      rec("ui:playwright", "WARN", pw.reason);
      return;
    }

    browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
    const context = await browser.newContext({ userAgent: UA });
    await context.addInitScript(onboardingInitScript());
    await context.addCookies(pw.cookies);
    const page = await context.newPage();

    const errs = [];
    page.on("pageerror", (e) => errs.push(e.message));

    // /grid is gone — 0DTE Command absorbed into /nighthawk (see FINDINGS.md). This UI check is
    // intentionally minimal (page loads, no console errors) rather than clicking tabs/search that
    // belonged to the deleted classic-Grid UI — NightHawkFeed's own structure is out of scope here.
    await page.goto(`${BASE}/nighthawk`, { waitUntil: "domcontentloaded", timeout: 90_000 });
    await page.waitForFunction(() => window.Clerk?.user?.id, { timeout: 60_000 }).catch(() => {});

    const title = await page.title();
    if (/Night ?Hawk|0DTE|BlackOut/i.test(title)) {
      rec("ui:page-load", "PASS", title.slice(0, 60));
    } else {
      rec("ui:page-load", "WARN", title.slice(0, 60));
    }

    await page.waitForTimeout(3000);
    rec("ui:console-errors", errs.length === 0 ? "PASS" : "FAIL", errs.slice(0, 2).join("; "));
  } catch (e) {
    rec("ui:playwright", "WARN", e.message?.slice(0, 120) ?? "browser blocked");
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
}

async function main() {
  console.log("\n=== Grid / 0DTE E2E audit ===\n");
  if (!SECRET || !PUB) {
    rec("env:clerk", "FAIL", "CLERK keys required");
    process.exit(1);
  }
  rec("env:clerk", "PASS");

  try {
    await auditGridApis();
    await auditGridUi();
  } catch (e) {
    rec("e2e:auth", "FAIL", e.message);
  } finally {
    await releaseAuditClerkSession();
  }

  const fails = checks.filter((c) => c.status === "FAIL");
  const reportPath = join(OUT, `grid-e2e-${Date.now()}.json`);
  writeFileSync(reportPath, JSON.stringify({ ts: new Date().toISOString(), checks }, null, 2));

  console.log(`\n=== Summary ===`);
  console.log(`  FAIL: ${fails.length} / ${checks.length}`);
  console.log(`  Report: ${reportPath}\n`);

  if (fails.length) {
    fails.forEach((f) => console.log(`  · ${f.name}: ${f.detail ?? ""}`));
    process.exit(1);
  }
  console.log("GREEN — Grid/0DTE E2E passed.\n");
}

main().catch(async (e) => {
  await releaseAuditClerkSession();
  console.error(e);
  process.exit(1);
});
