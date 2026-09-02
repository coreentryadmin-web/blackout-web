#!/usr/bin/env node
/**
 * RTH deep play audit — SPX Slayer, Legacy, 0DTE Command, Vector board.
 * Fetches every live play, scores quality flags, writes JSON report.
 *
 * Run: node scripts/audit/rth-four-engine-play-audit.mjs [--json]
 */
import { mkdir, writeFile } from "node:fs/promises";
import { fetchAuditJson, releaseAuditClerkSession } from "./lib/audit-auth-fetch.mjs";
import { auditSecret } from "./lib/prod-secrets.mjs";

const BASE = (process.env.VALIDATE_BASE || process.env.AUDIT_APP_URL || "https://blackouttrades.com").replace(/\/$/, "");
const OUT = process.env.SCREENSHOT_OUT || "/opt/cursor/artifacts/rth-monitor";
const JSON_ONLY = process.argv.includes("--json");
const CRON = auditSecret("CRON_SECRET");

const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);

function flag(play, code, severity, detail) {
  return { code, severity, detail, ticker: play.ticker ?? play.symbol ?? "SPX" };
}

function entryBandMid(entryRange) {
  if (!entryRange || typeof entryRange !== "string") return null;
  const nums = [...entryRange.matchAll(/\$?([\d.]+)/g)]
    .map((m) => Number(m[1]))
    .filter((n) => Number.isFinite(n) && n > 0);
  if (!nums.length) return null;
  if (nums.length === 1) return nums[0];
  return (nums[0] + nums[nums.length - 1]) / 2;
}

function stockMoveFromQuote(play, price) {
  const mid = entryBandMid(play.entry_range ?? play.entryRange);
  if (mid == null || !Number.isFinite(price)) return null;
  const dir = String(play.direction ?? "LONG").toUpperCase();
  if (dir === "SHORT") return ((mid - price) / mid) * 100;
  return ((price - mid) / mid) * 100;
}

async function fetchLegacyQuoteOverlay(tickers) {
  const out = new Map();
  await Promise.all(
    tickers.map(async (t) => {
      const r = await fetchAuditJson(BASE, `/api/market/quote?ticker=${encodeURIComponent(t)}`);
      if (r.ok && r.json?.available && r.json?.price != null) out.set(t, Number(r.json.price));
    })
  );
  return out;
}

function analyzeSpx(play) {
  const issues = [];
  if (!play) return { issues: [flag({}, "NO_PLAY", "RED", "SPX play payload null")] };
  const action = play.action ?? play.phase ?? play.status;
  const spot = num(play.spot ?? play.underlying_price ?? play.spx_price);
  if (action === "SCANNING" || action === "FLAT") {
    issues.push(flag({ ticker: "SPX" }, "FLAT", "AMBER", `No open play — ${action}`));
  }
  if (play.degraded) issues.push(flag({ ticker: "SPX" }, "DEGRADED", "RED", "Degraded play payload"));
  const entry = num(play.entry_price ?? play.entry);
  const stop = num(play.stop_price ?? play.stop);
  const target = num(play.target_price ?? play.target);
  if (entry != null && stop != null && target != null) {
    const risk = Math.abs(entry - stop);
    const reward = Math.abs(target - entry);
    if (risk > 0 && reward / risk < 0.8) {
      issues.push(flag({ ticker: "SPX" }, "LOW_RR", "WARN", `R:R ${(reward / risk).toFixed(2)}:1`));
    }
  }
  if (play.stale === true || play.is_stale) {
    issues.push(flag({ ticker: "SPX" }, "STALE", "RED", "Play marked stale"));
  }
  const pnl = num(play.pnl_pct ?? play.unrealized_pnl_pct);
  if (action && !["SCANNING", "FLAT", "WATCH"].includes(String(action).toUpperCase()) && pnl == null) {
    issues.push(flag({ ticker: "SPX" }, "NO_PNL", "WARN", "Open play missing PnL"));
  }
  return {
    ticker: "SPX",
    action,
    spot,
    direction: play.direction ?? play.bias,
    entry,
    stop,
    target,
    pnl,
    issues,
  };
}

function analyzeLegacyPlay(p, i) {
  const issues = [];
  const ticker = p.ticker ?? `LEGACY-${i}`;
  const morning = p.morning_status ?? p.morningStatus;
  if (morning === "INVALIDATED") issues.push(flag({ ticker }, "INVALIDATED", "WARN", "Morning invalidated"));
  if (morning === "DEGRADED") issues.push(flag({ ticker }, "DEGRADED", "AMBER", p.morning_reason ?? "Pre-market degraded"));
  if (morning === "UNVERIFIED") {
    issues.push(flag({ ticker }, "MORNING_PENDING", "AMBER", "Morning confirm not run"));
  }
  const score = num(p.score);
  const rr = num(p.rr_ratio ?? p.rrRatio);
  if (rr != null && rr < 1) {
    const rank = num(p.rank) ?? 99;
    const severity = rr < 0.75 && rank <= 3 ? "AMBER" : "WARN";
    issues.push(flag({ ticker }, "LOW_RR", severity, `R:R ${rr.toFixed(1)}:1`));
  }
  if (score != null && score < 55) issues.push(flag({ ticker }, "LOW_SCORE", "AMBER", `Score ${score}`));
  if (p.premium_cap_ok === false || p.premiumCapOk === false) {
    issues.push(flag({ ticker }, "PREMIUM_CAP", "WARN", "Above premium cap"));
  }
  if (p.gate_promoted && !p.morning_reason?.trim()) {
    issues.push(flag({ ticker }, "GATE_PROMOTED", "AMBER", "Gate promoted without morning reason"));
  }
  const stockMove = num(p.stock_move_pct ?? p.stockMovePct);
  const premiumPct = num(p.pnl_pct ?? p.premiumPct);
  if (stockMove != null && premiumPct != null && Math.sign(stockMove) !== 0 && Math.sign(premiumPct) !== 0) {
    if (Math.sign(stockMove) !== Math.sign(premiumPct) && Math.abs(premiumPct) > 15) {
      issues.push(flag({ ticker }, "STOCK_OPTION_DIVERGE", "WARN", `Stock ${stockMove}% vs prem ${premiumPct}%`));
    }
  }
  return {
    ticker,
    rank: p.rank,
    tier: p.tier_label ?? p.tierLabel,
    score,
    morning,
    direction: p.direction,
    rr,
    stockMove,
    premiumPct,
    recommendation: p.recommendation,
    issues,
  };
}

function analyzeZerodteRow(row) {
  const issues = [];
  const ticker = row.ticker ?? row.symbol ?? "?";
  const pnl = num(row.live_pnl_pct ?? row.pnl_pct ?? row.premium_pct);
  const status = row.status ?? row.action_status;
  if (status === "OPEN" && pnl == null) {
    issues.push(flag({ ticker }, "NO_LIVE_PNL", "WARN", "Open 0DTE row missing live PnL"));
  }
  const tier = row.tier ?? row.conviction_tier;
  if (tier && String(tier).toLowerCase().includes("skip")) {
    issues.push(flag({ ticker }, "SKIP_TIER", "AMBER", `Tier ${tier}`));
  }
  const stop = num(row.stop ?? row.stop_level);
  const entry = num(row.entry ?? row.entry_mid);
  if (entry != null && stop != null && Math.abs(entry - stop) / entry > 0.08) {
    issues.push(flag({ ticker }, "WIDE_STOP", "WARN", `Stop ${((Math.abs(entry - stop) / entry) * 100).toFixed(1)}% from entry`));
  }
  return { ticker, status, tier, pnl, issues };
}

function analyzeVectorPick(row) {
  const issues = [];
  const ticker = row.ticker ?? "?";
  const prem = num(row.premium_pct_from_entry ?? row.premiumPct);
  const peak = num(row.peak_premium_pct ?? row.peakPct);
  const action = row.action_status ?? row.status;
  if (action === "dont_buy" && prem != null && prem > 30) {
    issues.push(flag({ ticker }, "DONT_BUY_WINNER", "AMBER", `dont_buy but +${prem}%`));
  }
  if (prem != null && peak != null && peak - prem > 40) {
    issues.push(flag({ ticker }, "GAVE_BACK", "WARN", `Peak ${peak}% now ${prem}% (gave back ${(peak - prem).toFixed(0)}%)`));
  }
  if (prem != null && prem < -50) {
    issues.push(flag({ ticker }, "DEEP_LOSS", "WARN", `Premium ${prem}%`));
  }
  const iv = num(row.iv_rank ?? row.ivRank);
  if (iv != null && iv > 85) issues.push(flag({ ticker }, "HIGH_IV", "AMBER", `IV rank ${iv}`));
  return { ticker, action, prem, peak, issues };
}

async function main() {
  await mkdir(OUT, { recursive: true });
  const ts = new Date().toISOString();
  const report = { base: BASE, capturedAt: ts, systems: {}, summary: { red: 0, amber: 0, warn: 0, plays: 0 } };

  const [spx, nhEdition, nhStatus, zboard, vboard] = await Promise.all([
    fetchAuditJson(BASE, "/api/market/spx/play"),
    fetchAuditJson(BASE, "/api/market/nighthawk/edition"),
    fetchAuditJson(BASE, "/api/nighthawk/play-status"),
    fetchAuditJson(BASE, "/api/market/zerodte/board"),
    fetchAuditJson(BASE, "/api/market/vector/pick-closures/board?limit=500"),
  ]);

  // SPX
  const spxPlay = spx.json;
  const spxAnalysis = analyzeSpx(spxPlay);
  report.systems.spx = {
    ok: spx.ok,
    status: spx.status,
    play: spxAnalysis,
    issueCount: spxAnalysis.issues.length,
  };

  // Legacy (edition + play-status morning overlay)
  const editionPlays = nhEdition.json?.plays ?? nhEdition.json?.edition?.plays ?? [];
  const statusByTicker = new Map(
    (nhStatus.json?.plays ?? []).map((p) => [String(p.ticker ?? "").toUpperCase(), p])
  );
  const legacyTickers = [...new Set(editionPlays.map((p) => String(p.ticker ?? "").toUpperCase()).filter(Boolean))];
  const liveQuotes = await fetchLegacyQuoteOverlay(legacyTickers);
  const legacyAnalysis = editionPlays.map((p, i) => {
    const ticker = String(p.ticker ?? "").toUpperCase();
    const confirm = statusByTicker.get(ticker);
    const livePrice = liveQuotes.get(ticker);
    const liveStockMove = livePrice != null ? stockMoveFromQuote(p, livePrice) : null;
    const merged = confirm
      ? {
          ...p,
          morning_status: confirm.status ?? p.morning_status,
          morning_reason: confirm.reason ?? p.morning_reason,
          swing_promoted: confirm.swingPromoted ?? p.swing_promoted,
        }
      : { ...p };
    if (liveStockMove != null) merged.stock_move_pct = liveStockMove;
    return analyzeLegacyPlay(merged, i);
  });
  report.systems.legacy = {
    ok: nhEdition.ok,
    editionFor: nhEdition.json?.edition_for ?? nhEdition.json?.edition?.edition_for,
    playCount: legacyAnalysis.length,
    morningConfirmAvailable: nhStatus.json?.available === true,
    morningCheckedAt: nhStatus.json?.checked_at ?? nhStatus.json?.checkedAt ?? null,
    liveQuotesResolved: liveQuotes.size,
    plays: legacyAnalysis,
    macro: nhStatus.json?.macro ?? nhStatus.json?.morning_confirm ?? null,
    issueCount: legacyAnalysis.reduce((n, p) => n + p.issues.length, 0),
  };

  // 0DTE
  const ledger = zboard.json?.ledger ?? [];
  const setups = zboard.json?.setups ?? [];
  const zAnalysis = [...ledger, ...setups].map(analyzeZerodteRow);
  report.systems.zerodte = {
    ok: zboard.ok && zboard.json?.available !== false,
    session: zboard.json?.session?.date,
    ledgerCount: ledger.length,
    setupCount: setups.length,
    coveredElsewhere: zboard.json?.covered_elsewhere?.length ?? 0,
    plays: zAnalysis,
    issueCount: zAnalysis.reduce((n, p) => n + p.issues.length, 0),
  };

  // Vector
  const leaders = vboard.json?.leaders ?? [];
  const winners = vboard.json?.winners ?? [];
  const closed = vboard.json?.closed ?? [];
  const vAll = [...leaders, ...winners, ...closed];
  const vAnalysis = vAll.map(analyzeVectorPick);
  report.systems.vector = {
    ok: vboard.ok,
    leaders: leaders.length,
    winners: winners.length,
    closed: closed.length,
    plays: vAnalysis,
    issueCount: vAnalysis.reduce((n, p) => n + p.issues.length, 0),
  };

  // Summary
  for (const sys of Object.values(report.systems)) {
    const plays = sys.plays ?? (sys.play ? [sys.play] : []);
    report.summary.plays += Array.isArray(plays) ? plays.length : 1;
    for (const p of Array.isArray(plays) ? plays : [plays]) {
      for (const iss of p.issues ?? []) {
        if (iss.severity === "RED") report.summary.red++;
        else if (iss.severity === "AMBER") report.summary.amber++;
        else report.summary.warn++;
      }
    }
    for (const iss of sys.play?.issues ?? []) {
      if (iss.severity === "RED") report.summary.red++;
      else if (iss.severity === "AMBER") report.summary.amber++;
      else report.summary.warn++;
    }
  }

  report.verdict =
    !spx.ok || !nhEdition.ok || !zboard.ok || !vboard.ok
      ? "RED — API fetch failure"
      : report.summary.red > 0
        ? "RED — critical play issues"
        : report.summary.amber > 8
          ? "AMBER — multiple play quality flags"
          : "GREEN — all four engines responding";

  const path = `${OUT}/four-engine-plays-${ts.slice(0, 16).replace(/[:T]/g, "-")}.json`;
  await writeFile(path, JSON.stringify(report, null, 2));
  await writeFile(`${OUT}/four-engine-plays-latest.json`, JSON.stringify(report, null, 2));

  if (JSON_ONLY) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(`\n=== RTH Four-Engine Play Audit ===`);
    console.log(`Target: ${BASE}`);
    console.log(`Verdict: ${report.verdict}`);
    console.log(`Plays: ${report.summary.plays} | RED: ${report.summary.red} AMBER: ${report.summary.amber} WARN: ${report.summary.warn}`);
    console.log(`\nSPX: ${spxAnalysis.action ?? "—"} spot=${spxAnalysis.spot ?? "—"} issues=${spxAnalysis.issues.length}`);
    console.log(`Legacy: ${legacyAnalysis.length} plays issues=${report.systems.legacy.issueCount}`);
    console.log(`0DTE: ledger=${ledger.length} setups=${setups.length} issues=${report.systems.zerodte.issueCount}`);
    console.log(`Vector: leaders=${leaders.length} winners=${winners.length} closed=${closed.length} issues=${report.systems.vector.issueCount}`);

    for (const [name, sys] of Object.entries(report.systems)) {
      const plays = sys.plays ?? [];
      const topIssues = plays.flatMap((p) => p.issues.map((i) => ({ ...i, ticker: p.ticker }))).slice(0, 5);
      if (topIssues.length) {
        console.log(`\n  ${name} flags:`);
        for (const i of topIssues) console.log(`    [${i.severity}] ${i.ticker}: ${i.code} — ${i.detail}`);
      }
    }
    console.log(`\nReport: ${path}`);
  }

  await releaseAuditClerkSession();
  process.exit(report.verdict.startsWith("RED") ? 1 : 0);
}

main().catch(async (e) => {
  console.error(e);
  await releaseAuditClerkSession();
  process.exit(1);
});
