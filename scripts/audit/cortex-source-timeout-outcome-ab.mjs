#!/usr/bin/env node
/**
 * Cortex source-timeout outcome A/B — does a `CortexSourceTimeout` on a commit (gex-walls,
 * wall-trend, darkpool-confluence, or catalyst-news reporting "reader failed") predict a WORSE
 * forward outcome, or does the existing THIN_EVIDENCE tier discount already price it correctly?
 *
 * WHY THIS EXISTS (2026-09-01). Spot-checking a single post-close commit (AAPL, today) showed
 * three Cortex sources reporting `CortexSourceTimeout` in one pass — gex-walls, wall-trend and
 * darkpool-confluence, all fed by the SAME shared `fetchVectorFullState` read
 * (src/lib/nighthawk/cortex/fetch.ts:69-74, its own comment: "on a cold-cache miss triggers a
 * 10+ read fan-out that routinely takes 4-6s" against an 8s `CORTEX_SOURCE_TIMEOUT_MS`). That
 * shared dependency is why those three sources' absent-counts always move together — confirmed
 * by this script's own by-source breakdown (they tie exactly). A 14-day sample found 19% of all
 * commits carry at least one such timeout — high enough to ask whether it is actually degrading
 * commit quality, not just an assumed cost.
 *
 * DATA SOURCE. `GET /api/market/zerodte/record?days=N` serves `entry_context.cortex.absent`
 * (the same array the board's own card renders) plus `managed_outcome`/`managed_pnl_pct` — the
 * as-managed forward grade. Read straight off real production rows; nothing recomputed.
 *
 * METHOD. Split graded rows into two buckets: commits whose `entry_context.cortex.absent` array
 * contains at least one "reader failed (CortexSourceTimeout)" entry vs commits with none. Report
 * n / win rate / avg P&L per bucket, plus a per-source timeout-frequency breakdown so a future
 * run can see whether the shared-dependency correlation (gex-walls == wall-trend ==
 * darkpool-confluence) still holds.
 *
 * NEVER GATES ANYTHING. Read-only measurement — same INTENTIONAL-DESIGN.md discipline as
 * veto-flicker-rate.mjs / cortex-oppose-magnitude-ab.mjs: this only tells you whether the
 * existing THIN_EVIDENCE discount is pricing the risk correctly, or over/under-pricing it. A
 * gate/tier change (if any) is a separate, deliberate follow-up once a real sample says so.
 *
 * Flags: --days=N (default 30) --min-n=N (per-bucket refusal floor, default 10) --json
 */
import { fetchAuditJson, releaseAuditClerkSession } from "./lib/audit-auth-fetch.mjs";

function parseArgs(argv) {
  const out = { days: 30, minN: 10, json: false };
  for (const a of argv) {
    if (a === "--json") out.json = true;
    else if (a.startsWith("--days=")) out.days = Number(a.slice(7)) || out.days;
    else if (a.startsWith("--min-n=")) out.minN = Number(a.slice(8)) || out.minN;
  }
  return out;
}

const TIMEOUT_RE = /^([a-z-]+):\s*reader failed \(CortexSourceTimeout\)/;

function isGraded(p) {
  return p.managed_outcome != null && typeof p.managed_pnl_pct === "number";
}

function isWin(p) {
  return (p.managed_pnl_pct ?? 0) > 0;
}

function summarize(rows) {
  const n = rows.length;
  if (n === 0) return { n: 0, win_rate_pct: null, avg_pnl_pct: null };
  const wins = rows.filter(isWin).length;
  const decided = rows.filter((r) => (r.managed_pnl_pct ?? 0) !== 0).length;
  const sum = rows.reduce((acc, r) => acc + (r.managed_pnl_pct ?? 0), 0);
  return {
    n,
    win_rate_pct: decided > 0 ? Math.round((wins / decided) * 1000) / 10 : null,
    avg_pnl_pct: Math.round((sum / n) * 100) / 100,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const base = "https://blackouttrades.com";
  let record;
  try {
    const res = await fetchAuditJson(base, `/api/market/zerodte/record?days=${args.days}`);
    if (!res?.ok) {
      console.error(`FETCH FAILED — status ${res?.status}. INSUFFICIENT DATA.`);
      process.exitCode = 1;
      return;
    }
    record = res.json;
  } finally {
    await releaseAuditClerkSession();
  }

  const plays = Array.isArray(record?.plays) ? record.plays : [];
  const graded = plays.filter(isGraded);

  const withTimeout = [];
  const withoutTimeout = [];
  const bySource = {};
  let noContext = 0;

  for (const p of graded) {
    const cortex = p.entry_context && typeof p.entry_context.cortex === "object" ? p.entry_context.cortex : null;
    if (!cortex) {
      noContext++;
      continue;
    }
    const absent = Array.isArray(cortex.absent) ? cortex.absent : [];
    let hasTimeout = false;
    for (const a of absent) {
      const m = TIMEOUT_RE.exec(a);
      if (m) {
        hasTimeout = true;
        bySource[m[1]] = (bySource[m[1]] || 0) + 1;
      }
    }
    (hasTimeout ? withTimeout : withoutTimeout).push(p);
  }

  const results = {
    window_days: args.days,
    total_plays: plays.length,
    graded_plays: graded.length,
    no_entry_context: noContext,
    with_timeout: summarize(withTimeout),
    without_timeout: summarize(withoutTimeout),
    timeout_frequency_by_source: bySource,
  };

  if (args.json) {
    console.log(JSON.stringify(results, null, 2));
    return;
  }

  console.log(`\nCortex source-timeout outcome A/B — ${args.days}d window`);
  console.log(
    `Total plays: ${results.total_plays}, graded: ${results.graded_plays}, no entry_context.cortex: ${results.no_entry_context}\n`
  );

  console.log("Commits WITH >=1 CortexSourceTimeout:");
  console.log(
    `  n=${results.with_timeout.n}  win_rate=${results.with_timeout.win_rate_pct ?? "—"}%  avg_pnl=${results.with_timeout.avg_pnl_pct ?? "—"}%`
  );
  console.log("Commits WITHOUT any CortexSourceTimeout:");
  console.log(
    `  n=${results.without_timeout.n}  win_rate=${results.without_timeout.win_rate_pct ?? "—"}%  avg_pnl=${results.without_timeout.avg_pnl_pct ?? "—"}%`
  );

  console.log("\nTimeout frequency by source (a shared upstream dependency shows as matching counts):");
  for (const [source, count] of Object.entries(bySource).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${source}: ${count}`);
  }

  console.log("\nVERDICT:");
  if (results.with_timeout.n < args.minN || results.without_timeout.n < args.minN) {
    console.log(
      `  INSUFFICIENT DATA for a full verdict — one bucket has n < ${args.minN}. Widen --days or treat this as directional only.`
    );
  } else if (
    results.with_timeout.win_rate_pct != null &&
    results.without_timeout.win_rate_pct != null &&
    results.with_timeout.win_rate_pct < results.without_timeout.win_rate_pct - 5
  ) {
    console.log(
      "  DEGRADES — commits with a Cortex source timeout grade meaningfully worse; the THIN_EVIDENCE discount may be under-pricing this risk."
    );
  } else if (
    results.with_timeout.win_rate_pct != null &&
    results.without_timeout.win_rate_pct != null &&
    results.with_timeout.win_rate_pct > results.without_timeout.win_rate_pct + 5
  ) {
    console.log(
      "  NO DEGRADATION (commits WITH a timeout graded no worse, in this sample even better) — the existing THIN_EVIDENCE tier discount already prices the risk; no gate change indicated."
    );
  } else {
    console.log("  ROUGHLY FLAT — no meaningful difference between the two buckets in this sample.");
  }
}

main().catch((e) => {
  console.error("FATAL:", e?.stack ?? e);
  process.exitCode = 1;
});
