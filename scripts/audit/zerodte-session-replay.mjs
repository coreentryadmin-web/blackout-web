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
 *   --sessions=N  replay the last N session dates (overrides --date; use with --days=14+)
 *   --ab          compare trim_scale vs ratchet vs tier-runner trim on the same plays
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
  RUNNER_TARGET_PCT_A,
  RUNNER_TARGET_PCT_B_RUNNER,
} = await import(`${SRC}lib/zerodte/runner-profile.ts`);
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
const SESSION_COUNT = Math.max(1, Math.min(30, Number(argv.sessions ?? 1) || 1));
const JSON_OUT = argv.json === true || argv.json === "true";
const AB_MODE = argv.ab === true || argv.ab === "true";

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

/** Policy scenarios for exit-mode A/B (when tier-export lacks frozen snapshots). */
function buildPolicyScenario(p, scenario) {
  if (p.exit_policy_snapshot) {
    return { ...replayCtx(p), scenario };
  }
  const mode = scenario === "ratchet_tier" ? "ratchet" : "trim_scale";
  let target_pct;
  let regime = "neutral";
  if (scenario === "current_trim") {
    target_pct = undefined;
  } else if (scenario === "tier_trim" || scenario === "ratchet_tier") {
    regime = "trend";
    if (p.tier === "A") target_pct = RUNNER_TARGET_PCT_A;
    else if (p.tier === "B") target_pct = RUNNER_TARGET_PCT_B_RUNNER;
    else target_pct = undefined;
  } else {
    target_pct = undefined;
  }
  const rebuilt = buildResolvedExitPolicy(mode, { target_pct, regime });
  return { exit_policy_snapshot: rebuilt, plan_json: {}, policy_source: scenario, scenario };
}

function summarizeScenario(rows, label) {
  const graded = rows.filter((r) => r.exec_pnl != null);
  const avg =
    graded.length > 0
      ? Math.round((graded.reduce((s, r) => s + r.exec_pnl, 0) / graded.length) * 10) / 10
      : null;
  const winners = graded.filter((r) => r.exec_pnl > 0).length;
  return {
    scenario: label,
    replayed: graded.length,
    avg_exec_pnl_pct: avg,
    win_rate_pct: graded.length ? Math.round((winners / graded.length) * 1000) / 10 : null,
    runners_100_plus: graded.filter((r) => r.exec_pnl >= 100).length,
    runners_200_plus: graded.filter((r) => r.exec_pnl >= 200).length,
    worst_stop: graded.filter((r) => r.exec_pnl <= -45).length,
  };
}

async function fetchDirectionalBars(p) {
  const side = p.direction === "long" ? "call" : "put";
  const occ = occSymbol(p.ticker, p.expiry, side, p.top_strike);
  const bars = await fetchAggBars(occ, 1, "minute", p.session_date, p.session_date, "1500").catch(() => []);
  if (!bars?.length) return null;
  return bars.filter((b) => b.t != null && Number.isFinite(b.t)).map((b) => ({ t: b.t, h: b.h, l: b.l, c: b.c }));
}

async function gradeDirectionalWithBars(p, ctx, planBars) {
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
  const planBars = await fetchDirectionalBars(p);
  if (!planBars?.length) return { error: "no_bars" };
  return gradeDirectionalWithBars(p, ctx, planBars);
}

function summarizeResults(sessionDate, plays, results, barsFailed, via) {
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
  const runners200 = graded.filter((r) => (r.replay_exec_pnl ?? 0) >= 200).length;
  const runners300 = graded.filter((r) => (r.replay_exec_pnl ?? 0) >= 300).length;

  return {
    session_date: sessionDate,
    total_commits: plays.length,
    repriceable: results.length + barsFailed,
    bars_failed: barsFailed,
    replayed: graded.length,
    avg_replay_exec_pnl_pct: avgExec,
    avg_stored_exec_pnl_pct: avgStoredExec,
    win_rate_exec: graded.length ? Math.round((winners / graded.length) * 1000) / 10 : null,
    runners_100pct_plus: bigWinners,
    runners_200pct_plus: runners200,
    runners_300pct_plus: runners300,
    frozen_policy_rows: graded.filter((r) => r.has_frozen_policy).length,
    plays: results,
  };
}

async function replaySession(sessionDate, plays) {
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
        session_date: sessionDate,
        ticker: p.ticker,
        tier: p.tier,
        play_type: p.play_type ?? "DIRECTIONAL",
        error: replay.error,
      });
      continue;
    }

    results.push({
      session_date: sessionDate,
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

  return summarizeResults(sessionDate, plays, results, barsFailed);
}

function rollupSessions(sessions) {
  const allPlays = sessions.flatMap((s) => s.plays.filter((p) => p.replay_exec_pnl != null));
  const avgExec =
    allPlays.length > 0
      ? Math.round((allPlays.reduce((s, r) => s + (r.replay_exec_pnl ?? 0), 0) / allPlays.length) * 10) / 10
      : null;
  const winners = allPlays.filter((r) => (r.replay_exec_pnl ?? 0) > 0).length;
  return {
    sessions: sessions.length,
    total_commits: sessions.reduce((s, x) => s + x.total_commits, 0),
    replayed: allPlays.length,
    avg_replay_exec_pnl_pct: avgExec,
    win_rate_exec: allPlays.length ? Math.round((winners / allPlays.length) * 1000) / 10 : null,
    runners_100pct_plus: allPlays.filter((r) => (r.replay_exec_pnl ?? 0) >= 100).length,
    runners_200pct_plus: allPlays.filter((r) => (r.replay_exec_pnl ?? 0) >= 200).length,
    runners_300pct_plus: allPlays.filter((r) => (r.replay_exec_pnl ?? 0) >= 300).length,
    top_runners: [...allPlays]
      .sort((a, b) => (b.replay_exec_pnl ?? 0) - (a.replay_exec_pnl ?? 0))
      .slice(0, 15),
  };
}

async function runAbReplay(all, targetDates) {
  const scenarios = [
    { key: "current_trim", label: "trim_scale +100% neutral (current prod default)" },
    { key: "tier_trim", label: "trim_scale + tier runners (A=300/B=200 trend)" },
    { key: "ratchet_tier", label: "ratchet + tier runners (A=300/B=200 trend)" },
  ];
  const buckets = Object.fromEntries(scenarios.map((s) => [s.key, []]));
  let barsFailed = 0;

  for (const sessionDate of targetDates) {
    const plays = all.filter((p) => p.session_date === sessionDate).filter(isRepriceable);
    for (const p of plays) {
      if (p.play_type === "CONDOR") continue;
      const planBars = await fetchDirectionalBars(p);
      if (!planBars?.length) {
        barsFailed += 1;
        continue;
      }
      for (const sc of scenarios) {
        const ctx = buildPolicyScenario(p, sc.key);
        const replay = await gradeDirectionalWithBars(p, ctx, planBars);
        if (replay.error) continue;
        buckets[sc.key].push({
          session_date: sessionDate,
          ticker: p.ticker,
          tier: p.tier,
          exec_pnl: replay.exec_pnl_pct,
          mid_pnl: replay.mid_pnl_pct,
          outcome: replay.exec_outcome,
          runner_target_pct: replay.runner_target_pct,
        });
      }
    }
  }

  const compared = scenarios.map((s) => summarizeScenario(buckets[s.key], s.label));
  const deltas = [];
  const current = buckets.current_trim;
  const tierTrim = buckets.tier_trim;
  for (let i = 0; i < tierTrim.length; i++) {
    const cur = current[i];
    const tier = tierTrim[i];
    if (!cur || !tier || cur.ticker !== tier.ticker) continue;
    deltas.push({
      session_date: tier.session_date,
      ticker: tier.ticker,
      tier: tier.tier,
      current: cur.exec_pnl,
      tier_trim: tier.exec_pnl,
      delta: delta(tier.exec_pnl, cur.exec_pnl),
      mid: tier.mid_pnl,
    });
  }
  deltas.sort((a, b) => (b.delta ?? 0) - (a.delta ?? 0));

  return { scenarios: compared, bars_failed: barsFailed, top_improvements: deltas.slice(0, 10), top_regressions: [...deltas].sort((a, b) => (a.delta ?? 0) - (b.delta ?? 0)).slice(0, 5) };
}

function printAbReport(ab, targetDates) {
  console.log(`\n=== 0DTE EXIT MODE A/B — ${targetDates.length} sessions ===`);
  console.log(`${"SCENARIO".padEnd(48)} ${"N".padStart(4)} ${"AVG".padStart(8)} ${"WR".padStart(6)} ${"≥100".padStart(5)} ${"≥200".padStart(5)} ${"≤-45".padStart(5)}`);
  console.log("─".repeat(88));
  for (const s of ab.scenarios) {
    console.log(
      `${s.scenario.slice(0, 48).padEnd(48)} ${String(s.replayed).padStart(4)} ${fmtPct(s.avg_exec_pnl_pct).padStart(8)} ` +
        `${String(s.win_rate_pct ?? "—").padStart(5)}% ${String(s.runners_100_plus).padStart(5)} ` +
        `${String(s.runners_200_plus).padStart(5)} ${String(s.worst_stop).padStart(5)}`
    );
  }
  if (ab.top_improvements.length) {
    console.log("\nBiggest gains (tier-trim vs current):");
    for (const r of ab.top_improvements.filter((x) => (x.delta ?? 0) > 0).slice(0, 8)) {
      console.log(`  ${r.session_date} ${r.ticker.padEnd(6)} ${fmtPct(r.current)} → ${fmtPct(r.tier_trim)} (${fmtPct(r.delta)}) mid ${fmtPct(r.mid)}`);
    }
  }
  if (ab.bars_failed) console.log(`\nBar-fetch misses: ${ab.bars_failed}`);
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
  const targetDates = FILTER_DATE
    ? [FILTER_DATE]
    : SESSION_COUNT > 1 || AB_MODE
      ? dates.slice(-(AB_MODE ? Math.max(SESSION_COUNT, 10) : SESSION_COUNT))
      : [dates[dates.length - 1] ?? etTodayYmd()];

  if (AB_MODE) {
    const ab = await runAbReplay(all, targetDates);
    const summary = { ok: true, session_dates: targetDates, source: `${BASE}/api/admin/zerodte/tier-export?days=${DAYS}`, via: res.via, ab };
    if (JSON_OUT) console.log(JSON.stringify(summary, null, 2));
    else printAbReport(ab, targetDates);
    await releaseAuditClerkSession();
    return;
  }

  const sessionSummaries = [];
  for (const sessionDate of targetDates) {
    const plays = all.filter((p) => p.session_date === sessionDate);
    sessionSummaries.push(await replaySession(sessionDate, plays));
  }

  const summary = {
    ok: true,
    session_dates: targetDates,
    source: `${BASE}/api/admin/zerodte/tier-export?days=${DAYS}`,
    via: res.via,
    ...(sessionSummaries.length === 1
      ? sessionSummaries[0]
      : { rollup: rollupSessions(sessionSummaries), sessions: sessionSummaries }),
  };

  if (JSON_OUT) {
    console.log(JSON.stringify(summary, null, 2));
  } else if (sessionSummaries.length === 1) {
    printSessionReport(summary);
  } else {
    printMultiSessionReport(summary);
  }

  await releaseAuditClerkSession();
}

function printSessionReport(summary) {
  const graded = summary.plays.filter((r) => r.replay_exec_pnl != null || r.replay_mid_pnl != null);
  console.log(`\n=== 0DTE SESSION REPLAY — ${summary.session_date} ===`);
  console.log(`Source: ${summary.source ?? ""} (via=${summary.via ?? "—"})`);
  console.log(
    `Commits: ${summary.total_commits} total, ${summary.repriceable} re-priceable, ${summary.replayed} replayed (${summary.bars_failed} bar-fetch misses)`
  );
  if (summary.avg_replay_exec_pnl_pct != null) {
    console.log(
      `Executable lane: avg replay ${fmtPct(summary.avg_replay_exec_pnl_pct)}` +
        (summary.avg_stored_exec_pnl_pct != null ? ` vs stored ${fmtPct(summary.avg_stored_exec_pnl_pct)}` : "") +
        ` | WR ${summary.win_rate_exec}% | ≥100%: ${summary.runners_100pct_plus}`
    );
  }
  printPlayTable(graded);
  const skipped = summary.plays.filter((r) => r.error);
  if (skipped.length) {
    console.log(`\nSkipped/failed: ${skipped.map((r) => `${r.ticker}:${r.error}`).join(", ")}`);
  }
}

function printMultiSessionReport(summary) {
  const { rollup, sessions } = summary;
  console.log(`\n=== 0DTE SESSION REPLAY — LAST ${sessions.length} SESSIONS ===`);
  console.log(`Dates: ${summary.session_dates.join(", ")}`);
  console.log(`Source: ${summary.source} (via=${summary.via})`);
  console.log(
    `Rollup: ${rollup.replayed} plays | avg ${fmtPct(rollup.avg_replay_exec_pnl_pct)} | WR ${rollup.win_rate_exec}%`
  );
  console.log(
    `Runners: ≥100%: ${rollup.runners_100pct_plus} | ≥200%: ${rollup.runners_200pct_plus} | ≥300%: ${rollup.runners_300pct_plus}`
  );
  console.log("\nPer-session:");
  console.log(`${"DATE".padEnd(12)} ${"PLAYS".padStart(5)} ${"AVG".padStart(8)} ${"WR".padStart(6)} ${"≥100".padStart(5)}`);
  console.log("─".repeat(42));
  for (const s of sessions) {
    console.log(
      `${s.session_date.padEnd(12)} ${String(s.replayed).padStart(5)} ${fmtPct(s.avg_replay_exec_pnl_pct).padStart(8)} ` +
        `${String(s.win_rate_exec ?? "—").padStart(5)}% ${String(s.runners_100pct_plus).padStart(5)}`
    );
  }
  if (rollup.top_runners.length) {
    console.log("\nTop runners (executable lane):");
    printPlayTable(rollup.top_runners, true);
  }
}

function printPlayTable(graded, showDate = false) {
  console.log("");
  const frozenCount = graded.filter((r) => r.policy_source === "frozen").length;
  const rebuiltCount = graded.filter((r) => r.policy_source === "rebuilt").length;
  if (graded.length) {
    console.log(`Exit policy: ${frozenCount} frozen snapshot, ${rebuiltCount} rebuilt from commit metadata`);
  }
  const dateCol = showDate ? `${"DATE".padEnd(12)} ` : "";
  console.log(
    `${dateCol}${"TICKER".padEnd(8)} ${"TYPE".padEnd(5)} ${"TIER".padEnd(5)} ${"EXIT".padEnd(10)} ${"RUN%".padStart(5)} ` +
      `${"REPLAY".padStart(8)} ${"MID".padStart(8)} OUTCOME`
  );
  console.log("─".repeat(showDate ? 92 : 80));
  for (const r of graded.sort((a, b) => (b.replay_exec_pnl ?? 0) - (a.replay_exec_pnl ?? 0))) {
    console.log(
      `${showDate ? `${(r.session_date ?? "").padEnd(12)} ` : ""}` +
        `${r.ticker.padEnd(8)} ${String(r.play_type ?? "DIR").slice(0, 5).padEnd(5)} ${String(r.tier ?? "—").padEnd(5)} ` +
        `${String(r.exit_policy ?? "—").padEnd(10)} ` +
        `${String(r.runner_target_pct ?? "—").padStart(5)} ` +
        `${fmtPct(r.replay_exec_pnl).padStart(8)} ${fmtPct(r.replay_mid_pnl).padStart(8)} ${r.replay_exec_outcome ?? "—"}`
    );
  }
}

main().catch(async (e) => {
  console.error(e);
  await releaseAuditClerkSession();
  process.exitCode = 1;
});
