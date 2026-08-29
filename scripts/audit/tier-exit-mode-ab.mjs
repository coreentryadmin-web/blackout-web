#!/usr/bin/env node
/**
 * C-TIER/UNTIERED EXIT-MODE A/B — the measurement docs/audit/0DTE-RESEARCH.md's 2026-08-28
 * "Follow-up scoped but BLOCKED" note and Task #59 both ask for: does the shipped policy
 * (C-tier and untiered 0DTE plays exit via RATCHET — see `resolveExitModeForTier` in
 * src/lib/zerodte/exit-sync.ts) actually beat the DEFAULT-OFF `trim_scale` exit (the E5
 * ⅓@+25%/⅓@+50%/run-the-last-⅓ scale-out already shipped for A/B-tier) on this population,
 * or is it just inherited from A/B without ever being measured for C/untiered specifically?
 *
 * WHY THIS WAS BLOCKED UNTIL NOW. The public `/api/market/zerodte/record` route only returns
 * AGGREGATE stats — no entry_premium/top_strike/expiry per play, so a historical row could
 * never be re-priced against the option's own minute bars. `GET /api/admin/zerodte/tier-export`
 * (PR #3112, src/app/api/admin/zerodte/tier-export/route.ts) exposes those three fields plus
 * the REAL historical tier (via the same `tierFromEntryContext` adapter the live system used at
 * commit — `assignZeroDteTier`, never re-derived from today's VIX/Cortex), unblocking this.
 *
 * WHAT'S REAL vs WHAT'S RE-IMPLEMENTED (honesty, per repo convention):
 *   REAL: `tierFromEntryContext`/`assignZeroDteTier` tier assignment (via the tier-export row,
 *     not re-derived here), `evaluateExitState` (the actual shipped exit-decision engine),
 *     `TRIM_SCALE_RULES` (the actual E5 tranche thresholds), Polygon minute bars for the real
 *     contract on its real 0DTE session date.
 *   RE-IMPLEMENTED (deliberately, matching zerodte-sim.mjs's own precedent — the bar-replay
 *     HARNESS is copied, never the graded DECISION LOGIC): the two grading loops
 *     (gradeThroughExitEngine/gradeTrimScaleExit) are copied verbatim from zerodte-sim.mjs
 *     rather than imported, because they are script-local helpers there too (not exported from
 *     src/) — every THRESHOLD and DECISION they consult still comes from the live
 *     evaluateExitState/TRIM_SCALE_RULES imports, so this cannot silently drift from what the
 *     board actually runs on a live ratchet/trim_scale flip.
 *   APPROXIMATED: Cortex evidence is null in replay (thesis-break can't be reconstructed
 *     offline — never fabricated, same caveat zerodte-sim.mjs documents). Entry premium and
 *     entry-bar timestamp come from the tier-export row's own `entry_premium`/`first_flagged_at`
 *     — not re-derived from the bars — so a row missing either field is skipped, never guessed.
 *
 * DATA SOURCE. Auth via scripts/audit/lib/audit-auth-fetch.mjs (cron-bearer first, Clerk
 * fallback, temp user always released) against the admin tier-export route — READ-ONLY, no
 * writes, no gate touched by this script. Bars are pure Polygon (no auth beyond
 * POLYGON_API_KEY/POLYGON_API_BASE).
 *
 * USAGE
 *   env -u AWS_ACCESS_KEY_ID -u AWS_SECRET_ACCESS_KEY \
 *   node --import tsx scripts/audit/tier-exit-mode-ab.mjs [--days=90] [--base=https://blackouttrades.com]
 *        [--min-n=10] [--regime=neutral] [--json]
 *
 * With neither a reachable live admin route NOR any re-priceable rows, this prints
 * INSUFFICIENT DATA rather than fabricating a verdict. No gate is changed by this script —
 * it is evidence, not a switch, per the same discipline as cortex-oppose-magnitude-ab.mjs.
 */

// ── Env guard: must run before any dynamic import of an app provider module below.
if (!process.env.POLYGON_API_BASE || !/^https?:\/\//.test(process.env.POLYGON_API_BASE)) {
  process.env.POLYGON_API_BASE = "https://api.massive.com";
}

import { fetchAuditJson, releaseAuditClerkSession } from "./lib/audit-auth-fetch.mjs";

const SRC = new URL("../../src/", import.meta.url).pathname;
const { evaluateExitState, TRIM_SCALE_RULES } = await import(`${SRC}lib/zerodte/exit-engine.ts`);
const { PLAN_RULES } = await import(`${SRC}lib/zerodte/plan.ts`);
const { fetchAggBars } = await import(`${SRC}lib/providers/polygon-largo.ts`);

const argv = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, "").split("=");
    return [k, v ?? true];
  })
);
const BASE = String(argv.base ?? process.env.AUDIT_APP_URL ?? "https://blackouttrades.com").replace(/\/$/, "");
const DAYS = Math.max(1, Math.min(90, Number(argv.days ?? 90) || 90));
const MIN_N = Math.max(1, Number(argv["min-n"] ?? 10));
const REGIME = ["trend", "neutral", "range"].includes(argv.regime) ? argv.regime : "neutral";
const JSON_OUT = argv.json === true || argv.json === "true";

const REPLAY_STOP_ET_MIN = PLAN_RULES.time_stop_et_minutes; // board hard time-stop (15:50 ET)

function etMinOfBar(t) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "numeric",
    minute: "numeric",
    hour12: false,
  }).formatToParts(new Date(t));
  return Number(parts.find((p) => p.type === "hour")?.value ?? 0) * 60 + Number(parts.find((p) => p.type === "minute")?.value ?? 0);
}

/** Build an OCC option symbol for Polygon aggs, e.g. O:NVDA260722C00210000. */
function occSymbol(ticker, expiryYmd, side, strike) {
  const yymmdd = expiryYmd.slice(2).replace(/-/g, "");
  const cp = side === "put" ? "P" : "C";
  const strikeInt = String(Math.round(strike * 1000)).padStart(8, "0");
  return `O:${ticker.toUpperCase()}${yymmdd}${cp}${strikeInt}`;
}

// ── The two grading loops — copied verbatim from zerodte-sim.mjs (script-local there too;
//    every threshold/decision still comes from the live evaluateExitState/TRIM_SCALE_RULES
//    imports above, so this cannot silently drift from the shipped engine). See that file's
//    own header comment for the full mark-faithfulness rationale (pessimistic-by-default
//    intrabar fills, entry-bar exclusion, 15:50 ET replay cutoff).
function gradeTrimScaleExit(seq, entry, planStop, planTarget, flaggedMs, regime) {
  const pnlAt = (mark) => ((mark - entry) / entry) * 100;
  const thresholds = TRIM_SCALE_RULES.tranches_by_regime[regime] ?? TRIM_SCALE_RULES.tranches_by_regime.neutral;
  const frac = TRIM_SCALE_RULES.tranche_fraction;
  let peak = entry, taken = 0, realized = 0, remaining = 1, exited = false, outcome = "time_stop", lastClose = entry;
  for (const b of seq) {
    lastClose = b.c;
    const age = (b.t - flaggedMs) / 60000;
    const mk = (m, pk) => ({ entryPremium: entry, currentMark: m, peakPremium: pk, ageMinutes: age, cortexEvidence: null, planStop, planTarget, status: taken > 0 ? "TRIM" : "OPEN", trimmed: taken > 0, entryCortexScore: null, exitMode: "trim_scale", regime, trimsTaken: taken });
    const dLow = evaluateExitState(mk(b.l, peak));
    if (dLow.action === "EXIT" && dLow.reason === "plan_stop") { realized += remaining * pnlAt(planStop); exited = true; outcome = "stopped"; break; }
    peak = Math.max(peak, b.h);
    let dHigh = evaluateExitState(mk(b.h, peak));
    while (dHigh.action === "TRIM" && taken < thresholds.length) {
      realized += frac * pnlAt(entry * (1 + thresholds[taken] / 100));
      remaining -= frac; taken += 1;
      dHigh = evaluateExitState(mk(b.h, peak));
    }
    if (dHigh.action === "EXIT" && dHigh.reason === "trim_scale_runner_target") { realized += remaining * pnlAt(planTarget); remaining = 0; exited = true; outcome = "doubled"; break; }
    const dClose = evaluateExitState(mk(b.c, peak));
    if (dClose.action === "EXIT" && dClose.reason === "flat_theta_bleed") { realized += remaining * pnlAt(b.c); exited = true; outcome = "flat_scratch"; break; }
  }
  if (!exited) { realized += remaining * pnlAt(lastClose); outcome = taken > 0 ? "runner_close" : "time_stop"; }
  return { pnl_pct: Math.round(realized * 10) / 10, outcome };
}

function gradeThroughExitEngine(bars, entry, planStop, planTarget, flaggedMs, mode, regime) {
  if (!(entry > 0)) return null;
  const seq = [...bars].filter((b) => b.t > flaggedMs && etMinOfBar(b.t) <= REPLAY_STOP_ET_MIN).sort((a, z) => a.t - z.t);
  if (!seq.length) return null;
  if (mode === "trim_scale") return gradeTrimScaleExit(seq, entry, planStop, planTarget, flaggedMs, regime);
  const pnlAt = (mark) => ((mark - entry) / entry) * 100;
  let peak = entry, trimmed = false, realized = 0, remaining = 1, exited = false, outcome = "time_stop", lastClose = entry;
  for (const b of seq) {
    lastClose = b.c;
    const age = (b.t - flaggedMs) / 60000;
    const mk = (m, pk) => ({ entryPremium: entry, currentMark: m, peakPremium: pk, ageMinutes: age, cortexEvidence: null, planStop, planTarget, status: trimmed ? "TRIM" : "OPEN", trimmed, entryCortexScore: null });
    const dLow = evaluateExitState(mk(b.l, peak)); // pessimistic: bar-low both triggers AND fills
    if (dLow.action === "EXIT" && (dLow.reason === "plan_stop" || /ratchet|runner/.test(dLow.reason))) {
      const exitPnl = dLow.reason === "plan_stop" ? pnlAt(planStop) : pnlAt(b.l);
      realized += remaining * exitPnl; exited = true;
      outcome = dLow.reason === "plan_stop" ? "stopped" : "ratchet";
      break;
    }
    peak = Math.max(peak, b.h);
    const dHigh = evaluateExitState(mk(b.h, peak));
    if (dHigh.action === "TRIM" && !trimmed) { realized += 0.5 * pnlAt(planTarget); trimmed = true; remaining = 0.5; }
    else if (dHigh.action === "EXIT" && trimmed && dHigh.reason === "plan_target_final") { realized += remaining * pnlAt(planTarget); exited = true; outcome = "doubled"; break; }
    const dClose = evaluateExitState(mk(b.c, peak));
    if (dClose.action === "EXIT" && dClose.reason === "flat_theta_bleed") { realized += remaining * pnlAt(b.c); exited = true; outcome = "flat_scratch"; break; }
  }
  if (!exited) { realized += remaining * pnlAt(lastClose); outcome = trimmed ? "runner_close" : "time_stop"; }
  return { pnl_pct: Math.round(realized * 10) / 10, outcome };
}

function insufficient(reason) {
  if (JSON_OUT) {
    console.log(JSON.stringify({ ok: false, insufficient_data: true, reason }, null, 2));
  } else {
    console.log(`\n=== tier-exit-mode-ab — INSUFFICIENT DATA ===`);
    console.log(reason);
  }
}

async function main() {
  const res = await fetchAuditJson(BASE, `/api/admin/zerodte/tier-export?days=${DAYS}`);
  if (!res.ok || !res.json) {
    insufficient(
      `Could not reach the live admin tier-export route (GET /api/admin/zerodte/tier-export?days=${DAYS} -> ` +
        `${res.status} via=${res.via ?? "none"}). Raw Postgres is blocked from this sandbox, so this admin ` +
        `route is the only live path to a real, correctly-tiered C/untiered population.`
    );
    await releaseAuditClerkSession();
    process.exitCode = 1;
    return;
  }
  const allPlays = Array.isArray(res.json?.plays) ? res.json.plays : [];
  const population = allPlays.filter((p) => p.tier === "C" || p.tier == null);
  const repriceable = population.filter(
    (p) =>
      typeof p.entry_premium === "number" &&
      p.entry_premium > 0 &&
      typeof p.top_strike === "number" &&
      p.top_strike > 0 &&
      typeof p.expiry === "string" &&
      p.expiry.length === 10 &&
      (p.direction === "long" || p.direction === "short") &&
      typeof p.first_flagged_at === "string"
  );
  const dropped = population.length - repriceable.length;

  if (repriceable.length < MIN_N) {
    insufficient(
      `Only ${repriceable.length} re-priceable C-tier/untiered rows in the last ${DAYS} days ` +
        `(${population.length} total in the population, ${dropped} missing entry_premium/top_strike/` +
        `expiry/direction/first_flagged_at) — below --min-n=${MIN_N}. Try a larger --days window.`
    );
    await releaseAuditClerkSession();
    process.exitCode = 1;
    return;
  }

  const ratchet = [];
  const trimScale = [];
  let barsFetchFailed = 0;

  for (const p of repriceable) {
    const side = p.direction === "long" ? "call" : "put";
    const occ = occSymbol(p.ticker, p.expiry, side, p.top_strike);
    // 0DTE: the play's own trade date IS the expiry date.
    const bars = await fetchAggBars(occ, 1, "minute", p.expiry, p.expiry, "1500").catch(() => []);
    if (!bars?.length) {
      barsFetchFailed += 1;
      continue;
    }
    const entry = p.entry_premium;
    const flaggedMs = Date.parse(p.first_flagged_at);
    if (!Number.isFinite(flaggedMs)) {
      barsFetchFailed += 1;
      continue;
    }
    const planStop = entry * (1 + PLAN_RULES.stop_pct / 100);
    const planTarget = entry * (1 + PLAN_RULES.target_pct / 100);

    const r = gradeThroughExitEngine(bars, entry, planStop, planTarget, flaggedMs, "ratchet", REGIME);
    const t = gradeThroughExitEngine(bars, entry, planStop, planTarget, flaggedMs, "trim_scale", REGIME);
    if (r) ratchet.push({ ticker: p.ticker, session_date: p.session_date, tier: p.tier, ...r });
    if (t) trimScale.push({ ticker: p.ticker, session_date: p.session_date, tier: p.tier, ...t });
  }

  if (ratchet.length < MIN_N || trimScale.length < MIN_N) {
    insufficient(
      `Only graded ${ratchet.length} (ratchet) / ${trimScale.length} (trim_scale) rows through the exit ` +
        `engine — ${barsFetchFailed} rows had no usable Polygon bars or an unparseable first_flagged_at. ` +
        `Below --min-n=${MIN_N}. Try a larger --days window.`
    );
    await releaseAuditClerkSession();
    process.exitCode = 1;
    return;
  }

  const summarize = (rows) => {
    const n = rows.length;
    const wins = rows.filter((r) => r.pnl_pct > 0).length;
    const avgPnl = rows.reduce((s, r) => s + r.pnl_pct, 0) / n;
    const byOutcome = {};
    for (const r of rows) byOutcome[r.outcome] = (byOutcome[r.outcome] ?? 0) + 1;
    return { n, win_rate: wins / n, avg_pnl_pct: Math.round(avgPnl * 10) / 10, by_outcome: byOutcome };
  };

  const ratchetSummary = summarize(ratchet);
  const trimScaleSummary = summarize(trimScale);

  const payload = {
    ok: true,
    source: `${BASE}/api/admin/zerodte/tier-export?days=${DAYS} (via=${res.via})`,
    regime: REGIME,
    population_c_and_untiered: population.length,
    repriceable_rows: repriceable.length,
    bars_fetch_failed: barsFetchFailed,
    ratchet: ratchetSummary,
    trim_scale: trimScaleSummary,
    delta_avg_pnl_pct_trim_minus_ratchet: Math.round((trimScaleSummary.avg_pnl_pct - ratchetSummary.avg_pnl_pct) * 10) / 10,
    delta_win_rate_trim_minus_ratchet:
      Math.round((trimScaleSummary.win_rate - ratchetSummary.win_rate) * 1000) / 1000,
    note:
      "Evidence only — no gate changed by this script. resolveExitModeForTier (exit-sync.ts) still " +
      "sends C-tier/untiered to ratchet regardless of this result; a policy change is a separate PR.",
  };

  if (JSON_OUT) {
    console.log(JSON.stringify(payload, null, 2));
  } else {
    console.log(`\n=== C-TIER/UNTIERED EXIT-MODE A/B (ratchet vs trim_scale, regime=${REGIME}) ===`);
    console.log(`source: ${payload.source}`);
    console.log(`population (tier=C or untiered): ${population.length} · re-priceable: ${repriceable.length} · bars-fetch-failed: ${barsFetchFailed}`);
    console.log(
      `RATCHET     n=${ratchetSummary.n}  win-rate=${(ratchetSummary.win_rate * 100).toFixed(1)}%  avg P&L=${ratchetSummary.avg_pnl_pct}%  outcomes=${JSON.stringify(ratchetSummary.by_outcome)}`
    );
    console.log(
      `TRIM_SCALE  n=${trimScaleSummary.n}  win-rate=${(trimScaleSummary.win_rate * 100).toFixed(1)}%  avg P&L=${trimScaleSummary.avg_pnl_pct}%  outcomes=${JSON.stringify(trimScaleSummary.by_outcome)}`
    );
    console.log(
      `DELTA (trim_scale − ratchet): avg P&L ${payload.delta_avg_pnl_pct_trim_minus_ratchet >= 0 ? "+" : ""}${payload.delta_avg_pnl_pct_trim_minus_ratchet}pp · win-rate ${payload.delta_win_rate_trim_minus_ratchet >= 0 ? "+" : ""}${(payload.delta_win_rate_trim_minus_ratchet * 100).toFixed(1)}pp`
    );
    console.log(`\n${payload.note}`);
  }

  await releaseAuditClerkSession();
}

main().catch(async (e) => {
  console.error(e);
  await releaseAuditClerkSession().catch(() => {});
  process.exitCode = 1;
});
