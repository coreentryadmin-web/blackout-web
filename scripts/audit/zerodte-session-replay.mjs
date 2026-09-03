#!/usr/bin/env node
/**
 * 0DTE SESSION REPLAY — "how would today's committed plays have performed under the
 * CURRENT engine's frozen-policy graders?"
 *
 * Pulls REAL ledger rows via GET /api/admin/zerodte/tier-export (admin auth), fetches
 * Polygon minute bars for each play's contract (or underlying for condors), and re-runs
 * the SAME grading functions production uses in gradeZeroDteLedger (scan.ts):
 *   • gradePlanFromBars (mid mechanical baseline)
 *   • reconstructTrimScaleExecutableFromBars OR gradePlanExecutableFromBars (official executable)
 *   • gradeCondorFromBars for CONDOR rows
 *
 * Compares replayed grades to what's already stamped on the row (plan_pnl_pct,
 * entry_context.executable) so you can see whether the new engine would have changed
 * outcomes on today's session.
 *
 * USAGE
 *   env -u AWS_ACCESS_KEY_ID -u AWS_SECRET_ACCESS_KEY \
 *   node --import tsx scripts/audit/zerodte-session-replay.mjs [--days=3] [--date=YYYY-MM-DD] [--json]
 *
 *   --date   filter to one ET session (defaults to latest session_date in the export window)
 *   --days   tier-export lookback (default 3 — enough to catch today even on a Monday)
 */

if (!process.env.POLYGON_API_BASE || !/^https?:\/\//.test(process.env.POLYGON_API_BASE)) {
  process.env.POLYGON_API_BASE = "[REDACTED]";
}

import { fetchAuditJson, releaseAuditClerkSession } from "./lib/audit-auth-fetch.mjs";
import { auditSecret } from "./lib/prod-secrets.mjs";

// polygon-largo.ts reads POLYGON_API_KEY at module load — hydrate from AWS/env first.
const polygonKey = auditSecret("POLYGON_API_KEY");
if (polygonKey) process.env.POLYGON_API_KEY = polygonKey;

const SRC = new URL("../../src/", import.meta.url).pathname;
const { gradePlanFromBars, gradePlanExecutableFromBars, reconstructTrimScaleExecutableFromBars } =
  await import(`${SRC}lib/zerodte/plan.ts`);
const { gradeCondorFromBars } = await import(`${SRC}lib/zerodte/condor.ts`);
const { readFrozenExitPolicy } = await import(`${SRC}lib/zerodte/exit-sync.ts`);
const { exitPolicyGraderParams, buildResolvedExitPolicy } = await import(`${SRC}lib/zerodte/strategy-version.ts`);
const {
  zeroDteHalfSpreadFrac,
  ZERODTE_DEFAULT_HALF_SPREAD_FRAC,
  executionTaxBps,
} = await import(`${SRC}lib/zerodte/marks-math.ts`);
const { fetchAggBars } = await import(`${SRC}lib/providers/polygon-largo.ts`);
const { polygonSpotTicker } = await import(`${SRC}lib/zerodte/board.ts`);

const argv = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, "").split("=");
    return [k, v ?? true];
  })
);
const BASE = String(argv.base ?? process.env.AUDIT_APP_URL ?? "https://blackouttrades.com").replace(/\/$/, "");
const DAYS = Math.max(1, Math.min(30, Number(argv.days ?? 3) || 3));
const FILTER_DATE = typeof argv.date === "string" && argv.date !== "true" ? argv.date : null;
const JSON_OUT = argv.json === true || argv.json === "true";

function etTodayYmd() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function occSymbol(ticker, expiryYmd, side, strike) {
  const yymmdd = expiryYmd.slice(2).replace(/-/g, "");
  const cp = side === "put" ? "P" : "C";
  const strikeInt = String(Math.round(strike * 1000)).padStart(8, "0");
  return `O:${ticker.toUpperCase()}${yymmdd}${cp}${strikeInt}`;
}

function fmtPct(n) {
  if (n == null || !Number.isFinite(n)) return "—";
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(1)}%`;
}

function delta(a, b) {
  if (a == null || b == null || !Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.round((a - b) * 10) / 10;
}

function replayCtx(p) {
  if (p.exit_policy_snapshot) {
    return { exit_policy_snapshot: p.exit_policy_snapshot, plan_json: {} };
  }
  // Prod tier-export may not yet carry the frozen snapshot — rebuild from commit metadata
  // with CURRENT engine constants (honest for "how would today's engine grade this?").
  const mode = p.exit_policy_at_commit === "trim_scale" ? "trim_scale" : "ratchet";
  const regime =
    p.session_regime === "trend" || p.session_regime === "neutral" || p.session_regime === "range"
      ? p.session_regime
      : "neutral";
  const rebuilt = buildResolvedExitPolicy(mode, {
    target_pct: typeof p.runner_target_pct === "number" ? p.runner_target_pct : undefined,
    regime,
  });
  return { exit_policy_snapshot: rebuilt, plan_json: {}, policy_source: "rebuilt" };
}

function isRepriceable(p) {
  if (typeof p.first_flagged_at !== "string") return false;
  if (p.play_type === "CONDOR") {
    const c = p.condor;
    return (
      c != null &&
      Number.isFinite(c.breach_lower) &&
      Number.isFinite(c.breach_upper) &&
      Number.isFinite(c.gross_wing_risk) &&
      c.gross_wing_risk > 0 &&
      typeof p.session_date === "string" &&
      p.session_date.length === 10 &&
      typeof p.ticker === "string"
    );
  }
  return (
    typeof p.entry_premium === "number" &&
    p.entry_premium > 0 &&
    typeof p.top_strike === "number" &&
    p.top_strike > 0 &&
    typeof p.expiry === "string" &&
    p.expiry.length === 10 &&
    (p.direction === "long" || p.direction === "short")
  );
}

async function gradeCondorPlay(p, ctx) {
  const bars = await fetchAggBars(
    polygonSpotTicker(p.ticker),
    1,
    "minute",
    p.session_date,
    p.session_date,
    "1500"
  ).catch(() => []);
  if (!bars?.length) return { error: "no_bars" };
  const planBars = bars.filter((b) => b.t != null && Number.isFinite(b.t)).map((b) => ({ t: b.t, h: b.h, l: b.l, c: b.c }));
  const flaggedMs = Date.parse(p.first_flagged_at);
  if (!Number.isFinite(flaggedMs)) return { error: "bad_flag_time" };

  const frozenExitPolicy = readFrozenExitPolicy(ctx);
  const graderParams = frozenExitPolicy ? exitPolicyGraderParams(frozenExitPolicy) : null;
  const grade = gradeCondorFromBars(
    planBars,
    p.condor,
    flaggedMs,
    graderParams ? { time_stop_et_minutes: graderParams.time_stop_et_minutes } : null
  );

  return {
    mid_outcome: grade.outcome,
    mid_pnl_pct: grade.pnl_pct,
    exec_outcome: grade.outcome,
    exec_pnl_pct: grade.pnl_pct,
    execution_tax_bps: 0,
    exit_policy: frozenExitPolicy?.policy ?? p.exit_policy_at_commit ?? "condor_breach",
    runner_target_pct: frozenExitPolicy?.target_pct ?? p.runner_target_pct ?? null,
    tranche_count: 0,
  };
}

async function gradeDirectionalPlay(p, ctx) {
  const side = p.direction === "long" ? "call" : "put";
  const occ = occSymbol(p.ticker, p.expiry, side, p.top_strike);
  const bars = await fetchAggBars(occ, 1, "minute", p.session_date, p.session_date, "1500").catch(() => []);
  if (!bars?.length) return { error: "no_bars" };
  const planBars = bars.filter((b) => b.t != null && Number.isFinite(b.t)).map((b) => ({ t: b.t, h: b.h, l: b.l, c: b.c }));
  const flaggedMs = Date.parse(p.first_flagged_at);
  if (!Number.isFinite(flaggedMs)) return { error: "bad_flag_time" };

  const frozenExitPolicy = readFrozenExitPolicy(ctx);
  const graderParams = frozenExitPolicy ? exitPolicyGraderParams(frozenExitPolicy) : null;
  const mid = gradePlanFromBars(planBars, p.entry_premium, flaggedMs, graderParams);

  const planQuote = ctx?.plan_json ?? {};
  const entryBid = typeof planQuote.bid === "number" ? planQuote.bid : null;
  const entryAsk = typeof planQuote.ask === "number" ? planQuote.ask : null;
  const halfSpreadFrac = zeroDteHalfSpreadFrac(entryBid, entryAsk) ?? ZERODTE_DEFAULT_HALF_SPREAD_FRAC;

  const trimSpec =
    frozenExitPolicy?.policy === "trim_scale" &&
    Array.isArray(frozenExitPolicy.trim_levels) &&
    frozenExitPolicy.trim_levels.length > 0
      ? { trim_levels: frozenExitPolicy.trim_levels, runner_fraction: frozenExitPolicy.runner_fraction }
      : null;

  const exec = trimSpec
    ? reconstructTrimScaleExecutableFromBars(
        planBars,
        p.entry_premium,
        flaggedMs,
        halfSpreadFrac,
        trimSpec,
        graderParams
      )
    : gradePlanExecutableFromBars(planBars, p.entry_premium, flaggedMs, halfSpreadFrac, graderParams);

  return {
    mid_outcome: mid.outcome,
    mid_pnl_pct: mid.pnl_pct,
    exec_outcome: exec.outcome,
    exec_pnl_pct: exec.pnl_pct,
    execution_tax_bps: executionTaxBps(mid.pnl_pct, exec.pnl_pct),
    exit_policy: trimSpec ? "trim_scale" : frozenExitPolicy?.policy ?? "ratchet",
    runner_target_pct: frozenExitPolicy?.target_pct ?? p.runner_target_pct ?? null,
    tranche_count: exec.tranches?.length ?? 0,
  };
}

async function main() {
  const res = await fetchAuditJson(BASE, `/api/admin/zerodte/tier-export?days=${DAYS}`);
  if (!res.ok || !res.json) {
    const msg = `tier-export unreachable (${res.status} via=${res.via ?? "none"})`;
    if (JSON_OUT) console.log(JSON.stringify({ ok: false, error: msg }, null, 2));
    else console.error(msg);
    await releaseAuditClerkSession();
    process.exitCode = 1;
    return;
  }

  const all = Array.isArray(res.json?.plays) ? res.json.plays : [];
  const dates = [...new Set(all.map((p) => p.session_date))].sort();
  const sessionDate = FILTER_DATE ?? dates[dates.length - 1] ?? etTodayYmd();
  const plays = all.filter((p) => p.session_date === sessionDate);

  const repriceable = plays.filter(isRepriceable);

  const results = [];
  let barsFailed = 0;

  for (const p of repriceable) {
    const ctx = replayCtx(p);
    const replay =
      p.play_type === "CONDOR" ? await gradeCondorPlay(p, ctx) : await gradeDirectionalPlay(p, ctx);
    if (replay.error) {
      barsFailed += 1;
      results.push({
        ticker: p.ticker,
        tier: p.tier,
        play_type: p.play_type ?? "DIRECTIONAL",
        error: replay.error,
      });
      continue;
    }

    results.push({
      ticker: p.ticker,
      tier: p.tier,
      play_type: p.play_type ?? "DIRECTIONAL",
      direction: p.direction,
      exit_policy: p.exit_policy_at_commit ?? replay.exit_policy,
      runner_target_pct: replay.runner_target_pct,
      runner_tag: p.runner_tag,
      stored_mid_pnl: p.plan_pnl_pct,
      stored_exec_pnl: p.stored_executable_pnl_pct,
      replay_mid_pnl: replay.mid_pnl_pct,
      replay_exec_pnl: replay.exec_pnl_pct,
      exec_delta_vs_stored: delta(replay.exec_pnl_pct, p.stored_executable_pnl_pct),
      mid_delta_vs_stored: delta(replay.mid_pnl_pct, p.plan_pnl_pct),
      replay_mid_outcome: replay.mid_outcome,
      replay_exec_outcome: replay.exec_outcome,
      tranches: replay.tranche_count,
      execution_tax_bps: replay.execution_tax_bps,
      peak_premium: p.peak_premium,
      trough_premium: p.trough_premium,
      has_frozen_policy: Boolean(p.exit_policy_snapshot),
      policy_source: ctx.policy_source ?? (p.exit_policy_snapshot ? "frozen" : "rebuilt"),
    });
  }

  const graded = results.filter((r) => r.replay_exec_pnl != null || r.replay_mid_pnl != null);
  const avgExec =
    graded.length > 0
      ? Math.round((graded.reduce((s, r) => s + (r.replay_exec_pnl ?? 0), 0) / graded.length) * 10) / 10
      : null;
  const avgStoredExec =
    graded.filter((r) => r.stored_exec_pnl != null).length > 0
      ? Math.round(
          (graded.reduce((s, r) => s + (r.stored_exec_pnl ?? 0), 0) /
            graded.filter((r) => r.stored_exec_pnl != null).length) *
            10
        ) / 10
      : null;
  const winners = graded.filter((r) => (r.replay_exec_pnl ?? 0) > 0).length;
  const bigWinners = graded.filter((r) => (r.replay_exec_pnl ?? 0) >= 100).length;

  const summary = {
    ok: true,
    session_date: sessionDate,
    source: `${BASE}/api/admin/zerodte/tier-export?days=${DAYS}`,
    via: res.via,
    total_commits: plays.length,
    repriceable: repriceable.length,
    bars_failed: barsFailed,
    replayed: graded.length,
    avg_replay_exec_pnl_pct: avgExec,
    avg_stored_exec_pnl_pct: avgStoredExec,
    win_rate_exec: graded.length ? Math.round((winners / graded.length) * 1000) / 10 : null,
    runners_100pct_plus: bigWinners,
    frozen_policy_rows: graded.filter((r) => r.has_frozen_policy).length,
    plays: results,
  };

  if (JSON_OUT) {
    console.log(JSON.stringify(summary, null, 2));
  } else {
    console.log(`\n=== 0DTE SESSION REPLAY — ${sessionDate} ===`);
    console.log(`Source: ${summary.source} (via=${summary.via})`);
    console.log(
      `Commits: ${plays.length} total, ${repriceable.length} re-priceable, ${graded.length} replayed (${barsFailed} bar-fetch misses)`
    );
    if (avgExec != null) {
      console.log(
        `Executable lane: avg replay ${fmtPct(avgExec)}` +
          (avgStoredExec != null ? ` vs stored ${fmtPct(avgStoredExec)}` : "") +
          ` | WR ${summary.win_rate_exec}% | ≥100%: ${bigWinners}`
      );
    }
    console.log("");
    const frozenCount = graded.filter((r) => r.policy_source === "frozen").length;
    const rebuiltCount = graded.filter((r) => r.policy_source === "rebuilt").length;
    if (graded.length) {
      console.log(
        `Exit policy: ${frozenCount} frozen snapshot, ${rebuiltCount} rebuilt from commit metadata`
      );
    }
    console.log(
      `${"TICKER".padEnd(8)} ${"TYPE".padEnd(5)} ${"TIER".padEnd(5)} ${"EXIT".padEnd(10)} ${"RUN%".padStart(5)} ` +
        `${"REPLAY".padStart(8)} ${"STORED".padStart(8)} ${"Δ".padStart(7)} OUTCOME`
    );
    console.log("─".repeat(80));
    for (const r of graded.sort((a, b) => (b.replay_exec_pnl ?? 0) - (a.replay_exec_pnl ?? 0))) {
      console.log(
        `${r.ticker.padEnd(8)} ${String(r.play_type ?? "DIR").slice(0, 5).padEnd(5)} ${String(r.tier ?? "—").padEnd(5)} ` +
          `${String(r.exit_policy ?? "—").padEnd(10)} ` +
          `${String(r.runner_target_pct ?? "—").padStart(5)} ` +
          `${fmtPct(r.replay_exec_pnl).padStart(8)} ${fmtPct(r.stored_exec_pnl).padStart(8)} ` +
          `${fmtPct(r.exec_delta_vs_stored).padStart(7)} ${r.replay_exec_outcome ?? "—"}`
      );
    }
    const skipped = results.filter((r) => r.error);
    if (skipped.length) {
      console.log(`\nSkipped/failed: ${skipped.map((r) => `${r.ticker}:${r.error}`).join(", ")}`);
    }
  }

  await releaseAuditClerkSession();
}

main().catch(async (e) => {
  console.error(e);
  await releaseAuditClerkSession();
  process.exitCode = 1;
});
