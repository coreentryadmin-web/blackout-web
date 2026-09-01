#!/usr/bin/env node
/**
 * Deep Vector session analysis — winners, losers, closure reasons, engine signals.
 * READ-ONLY prod probe.
 *
 * Run: node --import tsx scripts/audit/vector-session-deep-analysis.mjs [--json]
 */
import { mkdir, writeFile } from "node:fs/promises";
import { fetchAuditJson, releaseAuditClerkSession } from "./lib/audit-auth-fetch.mjs";
import { classifyVectorClosureReason } from "../../src/features/nighthawk/lib/vector-pick-log-board-utils.ts";
import {
  isVectorPickRunner,
  isVectorPickWinner,
  VECTOR_PICK_LEADER_PCT_FLOOR,
  VECTOR_PICK_WINNER_PCT_FLOOR,
} from "../../src/lib/vector/vector-pick-sweep-core.ts";

const BASE = (process.env.VALIDATE_BASE || "https://blackouttrades.com").replace(/\/$/, "");
const JSON_OUT = process.argv.includes("--json");
const OUT = "/opt/cursor/artifacts/vector-session-deep-analysis";

function pct(n) {
  return n == null || !Number.isFinite(n) ? null : n;
}

function bucketPct(n) {
  if (n == null) return "unknown";
  if (n >= VECTOR_PICK_WINNER_PCT_FLOOR) return "winner";
  if (n >= VECTOR_PICK_LEADER_PCT_FLOOR) return "runner";
  if (n >= 0) return "flat_positive";
  if (n >= -25) return "small_loss";
  if (n >= -50) return "medium_loss";
  return "large_loss";
}

function summarizeRows(rows, kind) {
  const byReason = new Map();
  const bySetup = new Map();
  const byBias = new Map();
  const byRole = new Map();
  const byConviction = { low: 0, mid: 0, high: 0 };
  const byGrade = new Map();
  const byPctBucket = new Map();
  const chaseRiskWinners = [];
  const setupInvalidatedWinners = [];
  const pennyEntries = [];
  const losers = [];

  for (const row of rows) {
    const p = pct(row.premium_pct_from_entry);
    const peak = pct(row.peak_premium_pct ?? row.premium_pct_from_entry);
    const entry = row.entry_mid;
    const play = row.play ?? {};
    const setup = play.setup ?? play.headline?.split("·")?.[1]?.trim()?.split(" ")?.[0] ?? "unknown";
    const bias = play.bias ?? "unknown";
    const role = row.role ?? row.pick_context?.role ?? "unknown";
    const conviction = play.conviction ?? row.pick_context?.confidence ?? null;
    const grade = play.grade ?? "?";
    const reason =
      kind === "closed"
        ? classifyVectorClosureReason({ close_reason: row.close_reason, setup_invalidated: row.setup_invalidated })
        : row.action_status === "dont_buy"
          ? /chase|extended/i.test(row.action_reason ?? "")
            ? "premium_chase"
            : row.setup_invalidated
              ? "setup_invalidated"
              : "other"
          : row.setup_invalidated
            ? "setup_invalidated"
            : "open";

    byReason.set(reason, (byReason.get(reason) ?? 0) + 1);
    bySetup.set(setup, (bySetup.get(setup) ?? 0) + 1);
    byBias.set(bias, (byBias.get(bias) ?? 0) + 1);
    byRole.set(role, (byRole.get(role) ?? 0) + 1);
    byGrade.set(grade, (byGrade.get(grade) ?? 0) + 1);

    if (conviction != null) {
      if (conviction < 65) byConviction.low++;
      else if (conviction < 78) byConviction.mid++;
      else byConviction.high++;
    }

    const bucket = bucketPct(p);
    byPctBucket.set(bucket, (byPctBucket.get(bucket) ?? 0) + 1);

    if (entry != null && entry > 0 && entry < 0.1) {
      pennyEntries.push({ ticker: row.ticker, entry, pct: p, occ: row.contract?.occ ?? row.occ });
    }

    if (reason === "premium_chase" && (p >= VECTOR_PICK_WINNER_PCT_FLOOR || peak >= VECTOR_PICK_WINNER_PCT_FLOOR)) {
      chaseRiskWinners.push({
        ticker: row.ticker,
        pct: p,
        peak,
        occ: row.contract?.occ ?? row.occ,
        reason: row.close_reason ?? row.action_reason,
      });
    }

    if (row.setup_invalidated && (p >= VECTOR_PICK_LEADER_PCT_FLOOR || peak >= VECTOR_PICK_LEADER_PCT_FLOOR)) {
      setupInvalidatedWinners.push({ ticker: row.ticker, pct: p, peak, occ: row.contract?.occ ?? row.occ });
    }

    if (p != null && p < 0) {
      losers.push({
        ticker: row.ticker,
        pct: p,
        peak,
        setup,
        bias,
        role,
        conviction,
        grade,
        reason,
        entry,
        occ: row.contract?.occ ?? row.occ,
        close_reason: row.close_reason ?? row.action_reason,
      });
    }
  }

  losers.sort((a, b) => a.pct - b.pct);

  return {
    count: rows.length,
    byReason: Object.fromEntries([...byReason.entries()].sort((a, b) => b[1] - a[1])),
    bySetup: Object.fromEntries([...bySetup.entries()].sort((a, b) => b[1] - a[1])),
    byBias: Object.fromEntries([...byBias.entries()].sort((a, b) => b[1] - a[1])),
    byRole: Object.fromEntries([...byRole.entries()].sort((a, b) => b[1] - a[1])),
    byGrade: Object.fromEntries([...byGrade.entries()].sort((a, b) => b[1] - a[1])),
    byConviction,
    byPctBucket: Object.fromEntries([...byPctBucket.entries()]),
    chaseRiskWinners: chaseRiskWinners.slice(0, 15),
    setupInvalidatedWinners: setupInvalidatedWinners.slice(0, 10),
    pennyEntries: pennyEntries.slice(0, 10),
    worstLosers: losers.slice(0, 20),
    loserCount: losers.length,
    avgLoserPct:
      losers.length > 0 ? losers.reduce((s, r) => s + r.pct, 0) / losers.length : null,
  };
}

async function main() {
  await mkdir(OUT, { recursive: true });
  const board = await fetchAuditJson(BASE, "/api/market/vector/pick-closures/board?limit=500");
  if (!board.ok) {
    console.error("BOARD fetch failed", board.status);
    process.exit(1);
  }

  const j = board.json;
  const leaders = j.leaders ?? [];
  const winners = j.winners ?? [];
  const closed = j.closed ?? [];
  const runners = leaders.filter((r) =>
    isVectorPickRunner({
      premium_pct_from_entry: r.premium_pct_from_entry,
      peak_premium_pct: r.peak_premium_pct,
      action_status: r.action_status,
    })
  );

  const analysis = {
    session_date: j.session_date,
    as_of: j.as_of,
    coverage: j.coverage,
    runners: runners.length,
    leadersSummary: summarizeRows(leaders, "leaders"),
    winnersSummary: summarizeRows(winners, "winners"),
    closedSummary: summarizeRows(closed, "closed"),
    topWinners: winners.slice(0, 10).map((w) => ({
      ticker: w.ticker,
      pct: w.premium_pct_from_entry,
      peak: w.peak_premium_pct,
      status: w.action_status,
      reason: w.action_reason,
      setup: w.play?.setup,
      bias: w.play?.bias,
      conviction: w.play?.conviction,
      grade: w.play?.grade,
      role: w.role,
    })),
    findings: [],
  };

  const cs = analysis.closedSummary;
  const ls = analysis.leadersSummary;

  if (cs.byReason.premium_chase > 0) {
    analysis.findings.push({
      severity: "P0",
      issue: "Chase-risk closures archive winners",
      detail: `${cs.byReason.premium_chase} closed as premium_chase; ${cs.chaseRiskWinners.length} were +50% winners at close`,
      fix: "intent=tracked in sweep (shipped); skip chase-risk closure persistence",
    });
  }

  if (ls.chaseRiskWinners.length > 0) {
    analysis.findings.push({
      severity: "P0",
      issue: "Live leaders marked dont_buy chase risk while winning",
      detail: `${ls.chaseRiskWinners.length} leaders: ${ls.chaseRiskWinners.map((w) => `${w.ticker} +${w.pct?.toFixed(0)}%`).join(", ")}`,
      fix: "evaluateVectorPickLiveStatus intent=tracked",
    });
  }

  if (cs.loserCount > 0) {
    const setupInvalidatedLosers = cs.worstLosers.filter((l) => l.reason === "setup_invalidated");
    analysis.findings.push({
      severity: "P1",
      issue: "Setup-invalidated noise",
      detail: `${cs.byReason.setup_invalidated ?? 0} setup_invalidated; bar-close + 0.15% buffer shipped`,
      fix: "Deploy vector-pick-invalidation bar-close in sweep + live route",
    });
  }

  if (cs.pennyEntries.length > 0 || ls.pennyEntries.length > 0) {
    analysis.findings.push({
      severity: "P2",
      issue: "Penny-option entries distort %",
      detail: `${cs.pennyEntries.length + ls.pennyEntries.length} sub-$0.10 entries`,
      fix: "MIN_VECTOR_PICK_PREMIUM floor in rankPick",
    });
  }

  const lowConvLosers = cs.worstLosers.filter((l) => l.conviction != null && l.conviction < 65);
  if (lowConvLosers.length >= 3) {
    analysis.findings.push({
      severity: "P2",
      issue: "Low-conviction picks in worst losers",
      detail: `${lowConvLosers.length} worst losers had conviction < 65`,
      fix: "Raise minRankScoreToShow or require grade B+ for sweep universe",
    });
  }

  if (JSON_OUT) {
    console.log(JSON.stringify(analysis, null, 2));
  } else {
    console.log(`Vector deep session analysis — ${j.session_date}`);
    console.log(`leaders=${leaders.length} runners=${runners.length} winners=${winners.length} closed=${closed.length}`);
    console.log("\n## Closed by reason");
    console.log(JSON.stringify(cs.byReason, null, 2));
    console.log("\n## Closed P&L buckets");
    console.log(JSON.stringify(cs.byPctBucket, null, 2));
    console.log("\n## Chase-risk winners (should NOT have closed)");
    for (const w of cs.chaseRiskWinners) console.log(`  ${w.ticker} +${w.pct?.toFixed(1)}% — ${w.reason}`);
    console.log("\n## Worst 10 losers (closed)");
    for (const l of cs.worstLosers.slice(0, 10)) {
      console.log(
        `  ${l.ticker} ${l.pct?.toFixed(1)}% setup=${l.setup} conv=${l.conviction} grade=${l.grade} — ${l.close_reason?.slice(0, 60)}`
      );
    }
    console.log("\n## Findings");
    for (const f of analysis.findings) console.log(`  [${f.severity}] ${f.issue}: ${f.detail}`);
  }

  await writeFile(`${OUT}/analysis.json`, JSON.stringify(analysis, null, 2));
  await releaseAuditClerkSession();
  process.exit(0);
}

main().catch(async (e) => {
  console.error(e);
  await releaseAuditClerkSession();
  process.exit(1);
});
