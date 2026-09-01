#!/usr/bin/env node

/**
 * Quick Vector RTH validation — authenticated wall payloads + gex-ladder size (read-only HTTP).
 * Uses audit-auth-fetch (Clerk temp admin+premium) because vector routes are tier-gated.
 */

import { fetchAuditJson, releaseAuditClerkSession } from "./lib/audit-auth-fetch.mjs";

const base = (process.env.VALIDATE_BASE || "https://blackouttrades.com").replace(/\/$/, "");
const tickers = ["SPX", "SPY", "QQQ", "META"];
/** @type {string[]} */
const failures = [];

function noteFail(label, detail) {
  failures.push(`${label}: ${detail}`);
  console.log(`  fail ${label}: ${detail}`);
}

async function checkWalls() {
  console.log("Checking wall freshness (authenticated)...");
  for (const ticker of tickers) {
    try {
      const res = await fetchAuditJson(base, `/api/market/vector/walls?ticker=${ticker}&dte=0dte`);
      if (!res.ok) {
        const msg = res.status === 401 || res.status === 403 ? `HTTP ${res.status} (auth)` : `HTTP ${res.status}`;
        console.log(`  warn ${ticker}: ${msg}`);
        if (res.status === 401 || res.status === 403) noteFail(ticker, msg);
        continue;
      }
      const body = res.json && typeof res.json === "object" ? res.json : {};
      const walls = body.walls ?? body;
      const hasCall = Array.isArray(walls.callWalls) && walls.callWalls.length > 0;
      const hasPut = Array.isArray(walls.putWalls) && walls.putWalls.length > 0;
      console.log(`  ok ${ticker}: call=${hasCall} put=${hasPut} via=${res.via ?? "?"}`);
      if (!hasCall && !hasPut) {
        console.log(`  warn ${ticker}: empty walls (off-hours cache may be cold)`);
      }
    } catch (e) {
      noteFail(ticker, e instanceof Error ? e.message : String(e));
    }
  }
}

async function checkGexLadderFit() {
  console.log("\nChecking gex-ladder payload fit (SPX 0DTE)...");
  try {
    const res = await fetchAuditJson(base, "/api/market/vector/gex-ladder?ticker=SPX&dte=0dte");
    if (!res.ok) {
      const msg = res.status === 404 ? "route missing" : `HTTP ${res.status}`;
      console.log(`  warn gex-ladder: ${msg}`);
      if (res.status !== 404) noteFail("gex-ladder", msg);
      return;
    }
    const chars = JSON.stringify(res.json).length;
    const pct = ((chars / 16000) * 100).toFixed(1);
    console.log(`  ok gex-ladder: ${chars} chars (${pct}% of 16k Largo cap reference)`);
  } catch (e) {
    noteFail("gex-ladder", e instanceof Error ? e.message : String(e));
  }
}

console.log(`\nVector RTH quick check — ${base} — ${new Date().toISOString()}\n`);
try {
  await checkWalls();
  await checkGexLadderFit();
} finally {
  await releaseAuditClerkSession();
}

console.log(failures.length ? `\n${failures.length} hard failure(s).\n` : "\nDone.\n");
process.exit(failures.length > 0 ? 1 : 0);
