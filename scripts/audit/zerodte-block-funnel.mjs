#!/usr/bin/env node
/**
 * Live 0DTE gate block funnel — aggregates gate.blocks from the prod board.
 * Run every RTH cycle to see what's starving OPEN commits.
 *
 * Usage:
 *   node scripts/audit/zerodte-block-funnel.mjs
 *   node scripts/audit/zerodte-block-funnel.mjs --json
 */
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fetchAuditJson, releaseAuditClerkSession } from "./lib/audit-auth-fetch.mjs";

const BASE = (process.env.VALIDATE_BASE || "https://blackouttrades.com").replace(/\/$/, "");
const OUT = join(process.cwd(), "audit-output");
const JSON_ONLY = process.argv.includes("--json");

function aggregate(setups) {
  const blocks = {};
  let commit = 0;
  let blocked = 0;
  let weeklyCommit = 0;
  const highScoreBlocked = [];

  for (const s of setups) {
    const verdict = s.gate?.verdict ?? "BLOCKED";
    if (verdict === "COMMIT") commit++;
    else blocked++;

    if (verdict === "COMMIT" && s.contract_horizon === "WEEKLY_FALLBACK") weeklyCommit++;

    for (const b of s.gate?.blocks ?? []) {
      blocks[b.code] = (blocks[b.code] || 0) + 1;
    }

    if ((s.score ?? 0) >= 85 && verdict !== "COMMIT") {
      highScoreBlocked.push({
        ticker: s.ticker,
        score: s.score,
        blocks: (s.gate?.blocks ?? []).map((b) => b.code),
        cortex: s.cortex?.decision ?? null,
        horizon: s.contract_horizon ?? null,
      });
    }
  }

  const top = Object.entries(blocks).sort((a, b) => b[1] - a[1]);
  return { commit, blocked, weeklyCommit, top, highScoreBlocked };
}

async function main() {
  const res = await fetchAuditJson(BASE, "/api/market/zerodte/board");
  if (!res.ok) {
    console.warn(`board fetch failed status=${res.status} — secrets may be missing in this shell`);
    process.exit(0);
  }
  const setups = res.json.setups ?? [];
  const ledger = res.json.ledger ?? [];
  const funnel = aggregate(setups);
  const payload = {
    capturedAt: new Date().toISOString(),
    via: res.via,
    setups: setups.length,
    ledger: ledger.length,
    commit: funnel.commit,
    blocked: funnel.blocked,
    weekly_commit_ghost: funnel.weeklyCommit,
    top_blocks: funnel.top.slice(0, 20).map(([code, n]) => ({ code, n })),
    high_score_blocked: funnel.highScoreBlocked.slice(0, 12),
  };

  await mkdir(OUT, { recursive: true });
  const path = join(OUT, "zerodte-block-funnel-latest.json");
  await writeFile(path, JSON.stringify(payload, null, 2));

  if (JSON_ONLY) {
    console.log(JSON.stringify(payload, null, 2));
  } else {
    console.log(`0DTE block funnel (via=${res.via}) setups=${payload.setups} ledger=${payload.ledger}`);
    console.log(`  COMMIT=${funnel.commit} BLOCKED=${funnel.blocked} weekly_ghost=${funnel.weeklyCommit}`);
    console.log("  top blocks:");
    for (const [code, n] of funnel.top.slice(0, 12)) {
      console.log(`    ${String(n).padStart(3)}  ${code}`);
    }
    if (funnel.highScoreBlocked.length) {
      console.log("  score≥85 blocked:");
      for (const h of funnel.highScoreBlocked.slice(0, 6)) {
        console.log(`    ${h.ticker} ${h.score} [${h.blocks.join("+")}] cortex=${h.cortex}`);
      }
    }
    console.log(`Report: ${path}`);
  }

  await releaseAuditClerkSession();
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
