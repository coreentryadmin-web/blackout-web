#!/usr/bin/env node
/**
 * Prod 0DTE gate audit — why ledger commits are zero (or not).
 * Uses member API (premium + nighthawk launch gate).
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { mintIosPlaywrightSession, onboardingInitScript } from "./audit/lib/ios-playwright-auth.mjs";

const BASE = (process.env.AUDIT_APP_URL ?? "https://blackouttrades.com").replace(/\/$/, "");
const OUT = join(process.cwd(), "audit-output");
mkdirSync(OUT, { recursive: true });

const session = await mintIosPlaywrightSession({ appUrl: BASE });
if (session.skip) {
  console.error("Auth failed:", session.reason);
  process.exit(1);
}
const cookie = session.cookies.map((c) => `${c.name}=${c.value}`).join("; ");
const hdr = { Cookie: cookie, Accept: "application/json", "Cache-Control": "no-cache" };

const [board, edition, playStatus] = await Promise.all([
  fetch(`${BASE}/api/market/zerodte/board`, { headers: hdr }).then((r) => r.json()),
  fetch(`${BASE}/api/market/nighthawk/edition`, { headers: hdr }).then((r) => r.json()),
  fetch(`${BASE}/api/nighthawk/play-status`, { headers: hdr })
    .then((r) => r.json())
    .catch(() => null),
]);

const report = {
  ts: new Date().toISOString(),
  base: BASE,
  session: board.session,
  ledger_count: board.ledger?.length ?? 0,
  setup_count: board.setups?.length ?? 0,
  upstream_ok: board.upstream_ok,
  governor: board.governor,
  nighthawk: {
    edition_for: edition.edition_for,
    play_count: edition.plays?.length ?? 0,
    tickers: (edition.plays ?? []).map((p) => p.ticker),
  },
  covered_elsewhere: board.covered_elsewhere,
  morning_confirm: playStatus?.summary ?? null,
  setups: (board.setups ?? []).map((s) => ({
    ticker: s.ticker,
    direction: s.direction,
    score: s.score,
    market_aligned: s.market_aligned,
    gate_verdict: s.gate?.verdict ?? null,
    blocks: (s.gate?.blocks ?? []).map((b) => b.code),
    plan_status: s.plan?.entry_status ?? null,
    vix_tier: s.gate?.calibration?.g4_vix?.tier ?? null,
    day_open_vix: s.gate?.calibration?.g4_vix?.day_open_vix ?? null,
  })),
};

const blockTotals = {};
for (const s of report.setups) {
  for (const c of s.blocks) blockTotals[c] = (blockTotals[c] ?? 0) + 1;
}
report.block_totals = blockTotals;

const out = join(OUT, `zerodte-gate-audit-prod-${Date.now()}.json`);
writeFileSync(out, JSON.stringify(report, null, 2));

console.log("\n=== 0DTE prod gate audit ===");
console.log("Ledger commits:", report.ledger_count);
console.log("Scanner setups:", report.setup_count);
console.log("NH edition plays:", report.nighthawk.play_count, report.nighthawk.tickers);
console.log("Block totals:", blockTotals);
for (const s of report.setups) {
  console.log(`  ${s.ticker} ${s.direction} score=${s.score} aligned=${s.market_aligned} plan=${s.plan_status} → ${s.gate_verdict} [${s.blocks.join("+")}]`);
}
console.log(`\nReport: ${out}\n`);

await session.cleanup?.();
process.exit(report.ledger_count === 0 ? 1 : 0);
