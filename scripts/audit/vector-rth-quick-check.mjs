#!/usr/bin/env node

/**
 * Quick Vector RTH validation — wall payloads + full-state size (read-only HTTP).
 */

const base = (process.env.VALIDATE_BASE || "https://blackouttrades.com").replace(/\/$/, "");
const tickers = ["SPX", "SPY", "QQQ", "META"];
const TIMEOUT_MS = 5000;

async function fetchJson(path) {
  const res = await fetch(`${base}${path}`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) return { ok: false, status: res.status };
  return { ok: true, data: await res.json() };
}

async function checkWalls() {
  console.log("Checking wall freshness...");
  for (const ticker of tickers) {
    try {
      const out = await fetchJson(`/api/market/vector/walls?ticker=${ticker}`);
      if (!out.ok) {
        console.log(`  warn ${ticker}: HTTP ${out.status}`);
        continue;
      }
      const hasCall = out.data.callWalls?.length > 0;
      const hasPut = out.data.putWalls?.length > 0;
      console.log(`  ok ${ticker}: call=${hasCall} put=${hasPut}`);
    } catch (e) {
      console.log(`  fail ${ticker}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
}

async function checkFullState() {
  console.log("\nChecking full-state fit...");
  try {
    const out = await fetchJson("/api/market/vector/full-state");
    if (!out.ok) {
      console.log(`  warn full-state: HTTP ${out.status}`);
      return;
    }
    const chars = JSON.stringify(out.data).length;
    const pct = ((chars / 16000) * 100).toFixed(1);
    console.log(`  ok full-state: ${chars} chars (${pct}% of 16k)`);
  } catch (e) {
    console.log(`  fail full-state: ${e instanceof Error ? e.message : String(e)}`);
  }
}

console.log(`\nVector RTH quick check — ${base} — ${new Date().toISOString()}\n`);
await checkWalls();
await checkFullState();
console.log("\nDone.\n");
