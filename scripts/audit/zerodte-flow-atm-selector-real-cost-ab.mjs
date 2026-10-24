#!/usr/bin/env node
/**
 * FLOW-ORIGIN ATM-SELECTOR REAL-COST A/B — the measurement named as the next real candidate in
 * docs/audit/0DTE-RESEARCH.md E7 Step 6/7 ("catch bangers like Swift" mandate, 2026-10-22+).
 * ============================================================================================
 * WHY THIS EXISTS. Comparing Swift's real trades against Night Hawk's own real committed plays
 * (zerodte-swift-comparison.mjs) found: on the 7 COMMITTED trades that matched Swift's same
 * ticker/direction (SPY x5, NVDA, AAPL, 2026-10-21), Night Hawk traded a materially less-leveraged
 * strike than Swift did (e.g. SPY 775C vs Swift's 771/772/773C). Traced to `board.ts`'s FLOW-origin
 * `top_strike` selection: the strike with the MAXIMUM aggression-weighted real premium among the
 * dominant side's own options-flow prints -- i.e. "trade where the real institutional flow money
 * concentrated," not a deliberate ATM/conservative pick. A separate check (the E7 Step 6 BREAKOUT
 * co-flag probe) ruled out the one other live mechanism that could have supplied an ATM pick on
 * these specific trades (BREAKOUT's own `pickAtmZeroDteContract` -- it never co-flagged any of
 * SPY/NVDA/AAPL/AMD that day, so there was no competing contract to merge in). This script answers
 * the resulting, precisely-scoped question directly: across the REAL FLOW-origin committed
 * population (not just the 7 Swift-matched rows), would picking the strike NEAREST TO SPOT at
 * commit time -- instead of FLOW's premium-concentration pick -- have graded better, net of the
 * SAME real exit-engine mechanics, SAME real time-stop, SAME real regime?
 *
 * WHAT'S REAL vs WHAT'S RE-IMPLEMENTED vs WHAT'S APPROXIMATED (honesty, per repo convention):
 *   REAL: `resolveExitModeForTier`/`evaluateExitState`/`TRIM_SCALE_RULES`/`PLAN_RULES` (the actual
 *     shipped exit-decision engine and its real thresholds), `polygonSpotTicker` (the actual
 *     production index-root mapping), the tier-export row's own real `entry_premium`/`top_strike`/
 *     `expiry`/`direction`/`first_flagged_at`/`tier`/`discovery_origin`, Polygon minute bars for
 *     both the real traded contract AND the counterfactual ATM contract on their real 0DTE session
 *     date, and the real listed-strike universe from Polygon's reference endpoint.
 *   RE-IMPLEMENTED (deliberately, same precedent as tier-exit-mode-ab.mjs/zerodte-sim.mjs): the two
 *     grading loops (gradeThroughExitEngine/gradeTrimScaleExit) are copied verbatim from
 *     tier-exit-mode-ab.mjs -- every threshold/decision they consult still comes from the live
 *     evaluateExitState/TRIM_SCALE_RULES imports, so this cannot silently drift from the shipped
 *     engine.
 *   APPROXIMATED, explicitly disclosed, never hidden:
 *     (1) The counterfactual ATM strike is picked by PURE distance-to-spot from the real listed
 *         strike universe -- it does NOT reproduce `pickAtmZeroDteContract`'s full liquidity-quality
 *         scoring (spread tightness + OI depth), because that needs a real NBBO+OI snapshot for
 *         EVERY listed strike at the exact historical commit instant, which this sandbox cannot
 *         pull offline. A contract this simplified picker chooses that never actually traded that
 *         session (zero minute bars) is dropped from the comparison, not kept with a fabricated
 *         fill -- the real, no-bars population is reported honestly as `atm_dropped_no_bars`.
 *     (2) "Spot at commit" is the real underlying's own minute bar closest to (at-or-before,
 *         falling back to the first available) the commit timestamp -- a real traded print, not a
 *         synthetic mid.
 *     (3) The counterfactual's entry premium has NO recorded real value (nobody actually traded it)
 *         -- it is the real ATM contract's own first traded bar's OPEN at-or-after the commit
 *         timestamp. This is DIFFERENT from the actual side, whose entry premium is the REAL
 *         recorded `entry_premium` the live system actually paid -- an unavoidable asymmetry
 *         (one side has a real fill, the other can only have a real market print at the same
 *         instant) disclosed here rather than smoothed over.
 *     (4) Cortex evidence is null in replay (thesis-break can't be reconstructed offline) --
 *         same caveat every sibling real-cost script in this toolkit already documents.
 *
 * STATISTICAL DESIGN: PAIRED comparison (same commit instant, two different strikes graded through
 * the identical exit mechanics) -- far more powerful than treating the two sides as independent
 * samples, same discipline as swing-early-trim-ab.mjs's comparePolicies(). Reports mean paired
 * delta (ATM - actual) with a normal-approx 95% CI, chronological TRAIN/VALIDATION split (not
 * random), and the same verdict taxonomy: CANDIDATE SEPARATED / CURRENT SEPARATED / INCONCLUSIVE.
 * No gate or selector is changed by this script -- it is evidence, not a switch, per the standing
 * "do not manufacture bangers by loosening risk controls, cherry-picking winners, or using
 * hindsight" instruction this whole investigation operates under.
 *
 * DATA SOURCE. Auth via scripts/audit/lib/audit-auth-fetch.mjs (cron-bearer first, Clerk fallback,
 * temp user always released) against the admin tier-export route -- READ-ONLY, no writes, no gate
 * touched. Bars/reference lookups are pure Polygon (POLYGON_API_KEY/POLYGON_API_BASE only).
 *
 * USAGE
 *   env -u AWS_ACCESS_KEY_ID -u AWS_SECRET_ACCESS_KEY \
 *   node --import tsx scripts/audit/zerodte-flow-atm-selector-real-cost-ab.mjs \
 *        [--days=90] [--base=https://blackouttrades.com] [--min-n=10] [--regime=neutral] [--json]
 *
 * With neither a reachable live admin route NOR any re-priceable rows, this prints
 * INSUFFICIENT DATA rather than fabricating a verdict.
 */

if (!process.env.POLYGON_API_BASE || !/^https?:\/\//.test(process.env.POLYGON_API_BASE)) {
  process.env.POLYGON_API_BASE = "https://api.massive.com";
}

import { fetchAuditJson, releaseAuditClerkSession } from "./lib/audit-auth-fetch.mjs";
import { nearestStrike, pairedCompare, winRate } from "./lib/flow-atm-selector-eval.mjs";

const SRC = new URL("../../src/", import.meta.url).pathname;
const { evaluateExitState, TRIM_SCALE_RULES } = await import(`${SRC}lib/zerodte/exit-engine.ts`);
const { PLAN_RULES } = await import(`${SRC}lib/zerodte/plan.ts`);
const { fetchAggBars } = await import(`${SRC}lib/providers/polygon-largo.ts`);
const { resolveExitModeForTier } = await import(`${SRC}lib/zerodte/exit-sync.ts`);
const { polygonSpotTicker } = await import(`${SRC}lib/zerodte/board.ts`);

const POLYGON_BASE = process.env.POLYGON_API_BASE;
const POLYGON_KEY = process.env.POLYGON_API_KEY;

// Separate from polygonSpotTicker's `I:`-namespace mapping (spot bars) -- this is the Polygon
// REFERENCE-CONTRACTS endpoint's own underlying_ticker quirk (verified live in
// zerodte-swift-comparison.mjs: the OPTION ROOT "SPXW" and the reference API's "underlying_ticker"
// filter are two different fields that happen to look like they should match and don't).
const REFERENCE_TICKER_OVERRIDE = { SPXW: "SPX", NDXP: "NDX", RUTW: "RUT" };

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

const REPLAY_STOP_ET_MIN = PLAN_RULES.time_stop_et_minutes;

function etMinOfBar(t) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "numeric",
    minute: "numeric",
    hour12: false,
  }).formatToParts(new Date(t));
  return Number(parts.find((p) => p.type === "hour")?.value ?? 0) * 60 + Number(parts.find((p) => p.type === "minute")?.value ?? 0);
}

function occSymbol(ticker, expiryYmd, side, strike) {
  const yymmdd = expiryYmd.slice(2).replace(/-/g, "");
  const cp = side === "put" ? "P" : "C";
  const strikeInt = String(Math.round(strike * 1000)).padStart(8, "0");
  return `O:${ticker.toUpperCase()}${yymmdd}${cp}${strikeInt}`;
}

// ── The two grading loops, copied verbatim from tier-exit-mode-ab.mjs (itself copied from
//    zerodte-sim.mjs) -- every threshold/decision still comes from the live
//    evaluateExitState/TRIM_SCALE_RULES imports above, so this cannot silently drift.
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
    const mk = (m, pk) => ({ entryPremium: entry, currentMark: m, peakPremium: pk, ageMinutes: age, cortexEvidence: null, planStop, planTarget, status: trimmed ? "TRIM" : "OPEN", trimmed, entryCortexScore: null, exitMode: "ratchet" });
    const dLow = evaluateExitState(mk(b.l, peak));
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

async function jget(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`HTTP ${r.status} for ${url}`);
  return r.json();
}

async function listRealStrikes(ticker, expiryYmd, side) {
  const refTicker = REFERENCE_TICKER_OVERRIDE[ticker.toUpperCase()] ?? ticker.toUpperCase();
  const qs = new URLSearchParams({
    underlying_ticker: refTicker, contract_type: side, expired: "true",
    "expiration_date.gte": expiryYmd, "expiration_date.lte": expiryYmd,
    limit: "1000", apiKey: POLYGON_KEY,
  });
  const j = await jget(`${POLYGON_BASE}/v3/reference/options/contracts?${qs}`);
  return [...new Set((j?.results ?? []).map((r) => Number(r.strike_price)).filter(Number.isFinite))];
}

async function spotAtCommit(ticker, dayYmd, commitMs) {
  const spotTicker = polygonSpotTicker(ticker);
  const bars = await fetchAggBars(spotTicker, 1, "minute", dayYmd, dayYmd, "1000").catch(() => []);
  if (!bars?.length) return null;
  const sorted = [...bars].sort((a, b) => a.t - b.t);
  let chosen = null;
  for (const b of sorted) {
    if (b.t <= commitMs) chosen = b;
    else break;
  }
  return (chosen ?? sorted[0])?.c ?? null;
}

function insufficient(reason) {
  if (JSON_OUT) {
    console.log(JSON.stringify({ ok: false, insufficient_data: true, reason }, null, 2));
  } else {
    console.log(`\n=== zerodte-flow-atm-selector-real-cost-ab — INSUFFICIENT DATA ===`);
    console.log(reason);
  }
}

async function main() {
  const res = await fetchAuditJson(BASE, `/api/admin/zerodte/tier-export?days=${DAYS}`);
  if (!res.ok || !res.json) {
    insufficient(
      `Could not reach the live admin tier-export route (GET /api/admin/zerodte/tier-export?days=${DAYS} -> ` +
        `${res.status} via=${res.via ?? "none"}). Raw Postgres is blocked from this sandbox.`
    );
    await releaseAuditClerkSession();
    process.exitCode = 1;
    return;
  }
  const allPlays = Array.isArray(res.json?.plays) ? res.json.plays : [];
  const population = allPlays.filter((p) => Array.isArray(p.discovery_origin) && p.discovery_origin.includes("FLOW"));
  const repriceable = population.filter(
    (p) =>
      typeof p.entry_premium === "number" && p.entry_premium > 0 &&
      typeof p.top_strike === "number" && p.top_strike > 0 &&
      typeof p.expiry === "string" && p.expiry.length === 10 &&
      (p.direction === "long" || p.direction === "short") &&
      typeof p.first_flagged_at === "string" &&
      typeof p.ticker === "string"
  );
  const dropped = population.length - repriceable.length;

  if (repriceable.length < MIN_N) {
    insufficient(
      `Only ${repriceable.length} re-priceable FLOW-origin rows in the last ${DAYS} days ` +
        `(${population.length} total FLOW-origin, ${dropped} missing entry_premium/top_strike/expiry/` +
        `direction/first_flagged_at/ticker) -- below --min-n=${MIN_N}. Try a larger --days window.`
    );
    await releaseAuditClerkSession();
    process.exitCode = 1;
    return;
  }

  const rows = [];
  let actualBarsFetchFailed = 0, atmNoSpot = 0, atmNoChain = 0, atmNoBars = 0, atmSameStrike = 0;

  for (const p of repriceable) {
    const side = p.direction === "long" ? "call" : "put";
    const mode = resolveExitModeForTier(p.tier);

    const occActual = occSymbol(p.ticker, p.expiry, side, p.top_strike);
    const barsActual = await fetchAggBars(occActual, 1, "minute", p.expiry, p.expiry, "1500").catch(() => []);
    const flaggedMs = Date.parse(p.first_flagged_at);
    if (!barsActual?.length || !Number.isFinite(flaggedMs)) { actualBarsFetchFailed += 1; continue; }

    const entryActual = p.entry_premium;
    const planStopActual = entryActual * (1 + PLAN_RULES.stop_pct / 100);
    const planTargetActual = entryActual * (1 + PLAN_RULES.target_pct / 100);
    const rActual = gradeThroughExitEngine(barsActual, entryActual, planStopActual, planTargetActual, flaggedMs, mode, REGIME);
    if (!rActual) { actualBarsFetchFailed += 1; continue; }

    const spot = await spotAtCommit(p.ticker, p.expiry, flaggedMs);
    if (!(spot > 0)) { atmNoSpot += 1; await pace(); continue; }

    const strikes = await listRealStrikes(p.ticker, p.expiry, side);
    const atmStrike = nearestStrike(strikes, spot);
    if (atmStrike == null) { atmNoChain += 1; await pace(); continue; }
    if (atmStrike === p.top_strike) { atmSameStrike += 1; }

    const occAtm = occSymbol(p.ticker, p.expiry, side, atmStrike);
    const barsAtm = await fetchAggBars(occAtm, 1, "minute", p.expiry, p.expiry, "1500").catch(() => []);
    const entryBarAtm = [...(barsAtm ?? [])].filter((b) => b.t >= flaggedMs).sort((a, b) => a.t - b.t)[0];
    if (!barsAtm?.length || !entryBarAtm || !(entryBarAtm.o > 0)) { atmNoBars += 1; await pace(); continue; }

    const entryAtm = entryBarAtm.o;
    const planStopAtm = entryAtm * (1 + PLAN_RULES.stop_pct / 100);
    const planTargetAtm = entryAtm * (1 + PLAN_RULES.target_pct / 100);
    const rAtm = gradeThroughExitEngine(barsAtm, entryAtm, planStopAtm, planTargetAtm, flaggedMs, mode, REGIME);
    if (!rAtm) { atmNoBars += 1; await pace(); continue; }

    rows.push({
      ticker: p.ticker, session_date: p.session_date, tier: p.tier ?? null,
      actual_strike: p.top_strike, atm_strike: atmStrike, spot_at_commit: Math.round(spot * 100) / 100,
      strike_delta_pct: Math.round(((atmStrike - p.top_strike) / p.top_strike) * 1000) / 10,
      actual: rActual.pnl_pct, atm: rAtm.pnl_pct, delta: Math.round((rAtm.pnl_pct - rActual.pnl_pct) * 10) / 10,
      actual_outcome: rActual.outcome, atm_outcome: rAtm.outcome,
    });
    await pace();
  }

  if (rows.length < MIN_N) {
    insufficient(
      `Only paired-graded ${rows.length} rows (actual_bars_fetch_failed=${actualBarsFetchFailed}, ` +
        `atm_no_spot=${atmNoSpot}, atm_no_chain=${atmNoChain}, atm_no_bars=${atmNoBars}) -- below ` +
        `--min-n=${MIN_N}. Try a larger --days window.`
    );
    await releaseAuditClerkSession();
    process.exitCode = 1;
    return;
  }

  rows.sort((a, b) => a.session_date.localeCompare(b.session_date));
  const mid = Math.floor(rows.length / 2);
  const train = rows.slice(0, mid);
  const validation = rows.slice(mid);

  const trainCmp = pairedCompare(train);
  const validationCmp = pairedCompare(validation);

  const payload = {
    ok: true,
    source: `${BASE}/api/admin/zerodte/tier-export?days=${DAYS} (via=${res.via})`,
    regime: REGIME,
    population_flow_origin: population.length,
    repriceable_rows: repriceable.length,
    paired_graded_rows: rows.length,
    dropped: { actual_bars_fetch_failed: actualBarsFetchFailed, atm_no_spot: atmNoSpot, atm_no_chain: atmNoChain, atm_no_bars: atmNoBars, atm_same_strike_as_actual: atmSameStrike },
    train: { ...trainCmp, win_rate_actual: winRate(train, "actual"), win_rate_atm: winRate(train, "atm") },
    validation: { ...validationCmp, win_rate_actual: winRate(validation, "actual"), win_rate_atm: winRate(validation, "atm") },
    note:
      "Evidence only -- no gate/selector changed by this script. board.ts's FLOW-origin top_strike " +
      "selection is unchanged regardless of this result; a selector change is a separate, " +
      "explicitly-reviewed PR, per the standing 'do not manufacture bangers using hindsight' instruction.",
  };

  if (JSON_OUT) {
    console.log(JSON.stringify(payload, null, 2));
  } else {
    console.log(`\n=== FLOW-ORIGIN ATM-SELECTOR REAL-COST A/B (top_strike vs nearest-to-spot, regime=${REGIME}) ===`);
    console.log(`source: ${payload.source}`);
    console.log(`population (FLOW-origin): ${population.length} · re-priceable: ${repriceable.length} · paired-graded: ${rows.length}`);
    console.log(`dropped: ${JSON.stringify(payload.dropped)}`);
    console.log(
      `\nTRAIN       n=${train.length}  win-rate actual=${payload.train.win_rate_actual}%  atm=${payload.train.win_rate_atm}%  ` +
      `mean P&L actual=${trainCmp.meanActual}%  atm=${trainCmp.meanAtm}%  mean delta(atm-actual)=${trainCmp.meanDelta}pp [${trainCmp.ci?.lo}, ${trainCmp.ci?.hi}] -> ${trainCmp.verdict}`
    );
    console.log(
      `VALIDATION  n=${validation.length}  win-rate actual=${payload.validation.win_rate_actual}%  atm=${payload.validation.win_rate_atm}%  ` +
      `mean P&L actual=${validationCmp.meanActual}%  atm=${validationCmp.meanAtm}%  mean delta(atm-actual)=${validationCmp.meanDelta}pp [${validationCmp.ci?.lo}, ${validationCmp.ci?.hi}] -> ${validationCmp.verdict}`
    );
    console.log(`\n${payload.note}`);
  }

  await releaseAuditClerkSession();
}

function pace() {
  return new Promise((r) => setTimeout(r, 150));
}

main().catch(async (e) => {
  console.error(e);
  await releaseAuditClerkSession().catch(() => {});
  process.exitCode = 1;
});
