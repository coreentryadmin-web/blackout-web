#!/usr/bin/env node
/**
 * Play engine quality audit — scores every live play on four boards for 100–500% winner geometry.
 *
 * Requires Clerk/CRON via auditSecret (run scripts/bootstrap-audit-secrets.mjs first).
 *
 * Usage:
 *   node scripts/audit/play-engine-quality-audit.mjs
 *   node scripts/audit/play-engine-quality-audit.mjs --json
 */
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fetchAuditJson, releaseAuditClerkSession } from "./lib/audit-auth-fetch.mjs";

const BASE = (process.env.VALIDATE_BASE || "https://blackouttrades.com").replace(/\/$/, "");
const OUT = join(process.cwd(), "audit-output");
const JSON_ONLY = process.argv.includes("--json");

const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);

function band(pct) {
  if (pct == null) return "unknown";
  if (pct >= 500) return "500%+";
  if (pct >= 300) return "300-499%";
  if (pct >= 200) return "200-299%";
  if (pct >= 100) return "100-199%";
  if (pct >= 50) return "50-99%";
  if (pct >= 15) return "15-49%";
  if (pct >= 0) return "0-14%";
  return "loss";
}

function analyzeZerodteRow(row) {
  const ticker = row.ticker ?? row.symbol ?? "?";
  const live = num(row.live_pnl_pct ?? row.pnl_pct ?? row.premium_pct);
  const peak = num(row.peak_premium_pct ?? row.peak_premium ?? live);
  const target = num(row.runner_target_pct ?? row.entry_context?.runner_profile?.target_pct ?? 100);
  const tier = row.tier ?? row.conviction_tier ?? row.entry_context?.tier?.tier;
  const tag = row.entry_context?.runner_profile?.tag ?? row.runner_profile?.tag ?? "standard";
  const status = row.status ?? row.action_status ?? "—";
  return {
    engine: "0dte",
    ticker,
    status,
    tier,
    runner_tag: tag,
    target_pct: target,
    live_pct: live,
    peak_pct: peak,
    live_band: band(live),
    peak_band: band(peak),
    multi_bagger_target: target >= 200,
    at_target: peak != null && peak >= target,
  };
}

function analyzeVectorRow(row) {
  const ticker = row.ticker ?? "?";
  const live = num(row.premium_pct_from_entry ?? row.premiumPct);
  const peak = num(row.peak_premium_pct ?? row.peakPct ?? live);
  const action = row.action_status ?? row.status ?? "—";
  return {
    engine: "vector",
    ticker,
    status: action,
    tier: row.role ?? row.lane ?? null,
    runner_tag: peak != null && peak >= 100 ? "vector_100+" : peak != null && peak >= 50 ? "vector_50+" : "vector",
    target_pct: 100,
    live_pct: live,
    peak_pct: peak,
    live_band: band(live),
    peak_band: band(peak),
    multi_bagger_target: true,
    at_target: peak != null && peak >= 100,
  };
}

function analyzeLegacyRow(p, i) {
  const ticker = p.ticker ?? `LEGACY-${i}`;
  const prem = num(p.pnl_pct ?? p.premiumPct ?? p.stock_move_pct);
  const peak = num(p.peak_premium_pct ?? prem);
  return {
    engine: "legacy",
    ticker,
    status: p.morning_status ?? p.recommendation ?? "—",
    tier: p.tier_label ?? p.tierLabel ?? null,
    runner_tag: "swing",
    target_pct: null,
    live_pct: prem,
    peak_pct: peak,
    live_band: band(prem),
    peak_band: band(peak),
    multi_bagger_target: false,
    at_target: null,
  };
}

function analyzeSpx(play) {
  if (!play) return null;
  const pnl = num(play.pnl_pct ?? play.unrealized_pnl_pct);
  return {
    engine: "spx_slayer",
    ticker: "SPX",
    status: play.action ?? play.phase ?? "—",
    tier: play.direction ?? play.bias ?? null,
    runner_tag: "index",
    target_pct: null,
    live_pct: pnl,
    peak_pct: pnl,
    live_band: band(pnl),
    peak_band: band(pnl),
    multi_bagger_target: false,
    at_target: null,
  };
}

function summarize(plays) {
  const withPeak = plays.filter((p) => p.peak_pct != null);
  const winners100 = withPeak.filter((p) => (p.peak_pct ?? 0) >= 100);
  const winners200 = withPeak.filter((p) => (p.peak_pct ?? 0) >= 200);
  const runners = plays.filter((p) => p.multi_bagger_target);
  const runnerHits = runners.filter((p) => p.at_target);
  return {
    total: plays.length,
    with_peak: withPeak.length,
    peak_100_plus: winners100.length,
    peak_200_plus: winners200.length,
    runner_profile_count: runners.length,
    runner_at_target: runnerHits.length,
    peak_100_rate_pct:
      withPeak.length > 0 ? Math.round((winners100.length / withPeak.length) * 100) : null,
  };
}

async function main() {
  await mkdir(OUT, { recursive: true });
  const ts = new Date().toISOString();

  const [spx, nhEdition, zboard, vboard] = await Promise.all([
    fetchAuditJson(BASE, "/api/market/spx/play"),
    fetchAuditJson(BASE, "/api/market/nighthawk/edition"),
    fetchAuditJson(BASE, "/api/market/zerodte/board"),
    fetchAuditJson(BASE, "/api/market/vector/pick-closures/board?limit=500"),
  ]);

  const plays = [];
  const spxPlay = analyzeSpx(spx.json);
  if (spxPlay) plays.push(spxPlay);

  const editionPlays = nhEdition.json?.plays ?? nhEdition.json?.edition?.plays ?? [];
  plays.push(...editionPlays.map(analyzeLegacyRow));

  const ledger = zboard.json?.ledger ?? [];
  const setups = zboard.json?.setups ?? [];
  plays.push(...[...ledger, ...setups].map(analyzeZerodteRow));

  const leaders = vboard.json?.leaders ?? [];
  const winners = vboard.json?.winners ?? [];
  const closed = vboard.json?.closed ?? [];
  plays.push(...[...leaders, ...winners, ...closed].map(analyzeVectorRow));

  const byEngine = {
    spx_slayer: summarize(plays.filter((p) => p.engine === "spx_slayer")),
    legacy: summarize(plays.filter((p) => p.engine === "legacy")),
    zerodte: summarize(plays.filter((p) => p.engine === "0dte")),
    vector: summarize(plays.filter((p) => p.engine === "vector")),
  };

  const report = {
    base: BASE,
    capturedAt: ts,
    apis_ok: { spx: spx.ok, legacy: nhEdition.ok, zerodte: zboard.ok, vector: vboard.ok },
    summary: summarize(plays),
    by_engine: byEngine,
    plays: plays.sort((a, b) => (b.peak_pct ?? -999) - (a.peak_pct ?? -999)),
    top_100_plus: plays.filter((p) => (p.peak_pct ?? 0) >= 100).slice(0, 20),
    zerodte_runner_profiles: plays.filter((p) => p.engine === "0dte" && p.runner_tag !== "standard"),
  };

  const path = join(OUT, `play-engine-quality-${ts.slice(0, 16).replace(/[:T]/g, "-")}.json`);
  await writeFile(path, JSON.stringify(report, null, 2));
  await writeFile(join(OUT, "play-engine-quality-latest.json"), JSON.stringify(report, null, 2));

  if (JSON_ONLY) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(`\n=== Play Engine Quality Audit ===`);
    console.log(`Target: ${BASE} @ ${ts}`);
    console.log(
      `APIs: SPX=${spx.ok ? "ok" : spx.status} Legacy=${nhEdition.ok ? "ok" : nhEdition.status} ` +
        `0DTE=${zboard.ok ? "ok" : zboard.status} Vector=${vboard.ok ? "ok" : vboard.status}`
    );
    console.log(`\nAll engines: ${report.summary.total} plays`);
    for (const [eng, s] of Object.entries(byEngine)) {
      console.log(
        `  ${eng}: ${s.total} plays | peak≥100%: ${s.peak_100_plus}/${s.with_peak} ` +
          `(${s.peak_100_rate_pct ?? "—"}%) | runner profiles: ${s.runner_profile_count}`
      );
    }
    if (report.top_100_plus.length) {
      console.log(`\nTop 100%+ peak plays:`);
      for (const p of report.top_100_plus.slice(0, 8)) {
        console.log(
          `  [${p.engine}] ${p.ticker} peak=${p.peak_pct}% live=${p.live_pct}% tag=${p.runner_tag} target=${p.target_pct ?? "—"}%`
        );
      }
    }
    console.log(`\nReport: ${path}`);
  }

  await releaseAuditClerkSession();
  const apiFail = !spx.ok || !nhEdition.ok || !zboard.ok || !vboard.ok;
  process.exit(apiFail ? 1 : 0);
}

main().catch(async (e) => {
  console.error(e);
  await releaseAuditClerkSession();
  process.exit(1);
});
