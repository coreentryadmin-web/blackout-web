#!/usr/bin/env node
/**
 * REGIME DEAD-ZONE A/B — measures the residual gap `decideTrimScale`'s own 2026-08-27
 * dead-zone-guard comment (src/lib/zerodte/exit-engine.ts, ~line 300-320) names but
 * deliberately left unfixed: the shared `ratchetFloorPct` breakeven arm is a FIXED
 * peak +20% while `TRIM_SCALE_RULES.tranches_by_regime` is regime-conditioned
 * (neutral +20, range +15, trend +40). The 2026-08-27 fix (`trimAvailable = armed >
 * taken`) already closes the gap for neutral/range, where the two tables coincide or
 * cross before the floor can dump a position no trim has ever touched. It does NOT
 * (and by the comment's own admission, cannot) help `trend`: a peak in [20,40) arms
 * the shared breakeven floor but has armed ZERO trim tranches (trend's first tranche
 * is +40), so `trimAvailable` is false and the floor dumps the WHOLE position to ~0%
 * — the exact live pattern this session's own record-sweep found (37/372 graded 0DTE
 * plays, 9.9%, hit `ratchet_breakeven_floor` after a median +26.67% peak).
 *
 * THIS SCRIPT measures whether that residual trend-regime gap is worth closing, and
 * how, against REAL historical A/B-tier trim_scale plays — same discipline as
 * tier-exit-mode-ab.mjs (which this file's harness is copied from): real tier-export
 * rows, real Polygon minute bars, re-graded through the SAME shipped
 * `evaluateExitState`/`TRIM_SCALE_RULES` for CURRENT and FIX A (a real engine, just a
 * mutated threshold table); FIX B needs a decision-logic change `decideTrimScale`
 * does not expose, so it is a script-local, clearly-labeled REIMPLEMENTATION (bar-
 * replay harness copied, decision logic re-derived — same "REAL vs RE-IMPLEMENTED"
 * honesty header tier-exit-mode-ab.mjs already carries).
 *
 * CANDIDATE FIXES (evidence-gathering only — see the note in the JSON/console output;
 * this script changes NO gate on its own):
 *   FIX A — lower the regime's first trim-arm threshold to the shared floor's own
 *     +20% arm point, so a tranche always arms AT OR BEFORE the floor (mutates
 *     TRIM_SCALE_RULES.tranches_by_regime[regime] in-process, restored after).
 *   FIX B — replace the hard 0% breakeven floor with a PARTIAL floor (peak * 0.5)
 *     specifically in the dead-zone case (no tranche armed yet, not trimmed, peak in
 *     [ratchet_arm_pnl_pct, next-tranche-threshold)) — closer to what the shipped
 *     ratchet ALREADY does at higher peaks (peak>=50 locks the floor at +20%, not 0%).
 *
 * A row is IN a regime's dead zone only if: session_regime is known, exit_mode was
 * (or would be) trim_scale, and the graded peak fell in [ratchet_arm_pnl_pct=20,
 * first tranche threshold for that regime) with zero tranches ever armed. For
 * neutral/range that interval is EMPTY or already covered by the 2026-08-27 guard
 * (first tranche <= 20), so only `trend` (first tranche 40) can populate it —
 * confirmed by the per-regime breakdown this script prints.
 *
 * USAGE
 *   env -u AWS_ACCESS_KEY_ID -u AWS_SECRET_ACCESS_KEY \
 *   node --import tsx scripts/audit/regime-dead-zone-ab.mjs [--days=90] [--base=https://blackouttrades.com]
 *        [--min-n=15] [--json]
 *
 * Prints INSUFFICIENT DATA rather than fabricating a verdict when there aren't enough
 * re-priceable, dead-zone rows. No gate is changed by this script.
 */

if (!process.env.POLYGON_API_BASE || !/^https?:\/\//.test(process.env.POLYGON_API_BASE)) {
  process.env.POLYGON_API_BASE = "https://api.massive.com";
}

import { fetchAuditJson, releaseAuditClerkSession } from "./lib/audit-auth-fetch.mjs";

const SRC = new URL("../../src/", import.meta.url).pathname;
const exitEngine = await import(`${SRC}lib/zerodte/exit-engine.ts`);
const { evaluateExitState, TRIM_SCALE_RULES, EXIT_RULES, trimTranchesArmed } = exitEngine;
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
const MIN_N = Math.max(1, Number(argv["min-n"] ?? 15));
const JSON_OUT = argv.json === true || argv.json === "true";

const REPLAY_STOP_ET_MIN = PLAN_RULES.time_stop_et_minutes;
const REGIMES = ["trend", "neutral", "range"];

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

/** Does this regime have a dead zone at all, given ITS OWN first tranche threshold? */
function deadZoneWindow(regime) {
  const firstTranche = TRIM_SCALE_RULES.tranches_by_regime[regime][0];
  const armAt = EXIT_RULES.ratchet_arm_pnl_pct; // 20
  if (firstTranche <= armAt) return null; // guard already covers it (neutral/range today)
  return [armAt, firstTranche]; // e.g. trend: [20, 40)
}

// ── CURRENT / FIX A grading — REAL evaluateExitState (decideTrimScale internally).
// FIX A only differs in the mutated TRIM_SCALE_RULES table passed in via `overrideFirstTranche`.
function gradeTrimScaleExit(seq, entry, planStop, planTarget, flaggedMs, regime, overrideFirstTranche) {
  const pnlAt = (mark) => ((mark - entry) / entry) * 100;
  const baseThresholds = TRIM_SCALE_RULES.tranches_by_regime[regime] ?? TRIM_SCALE_RULES.tranches_by_regime.neutral;
  const thresholds = overrideFirstTranche != null ? [overrideFirstTranche, baseThresholds[1]] : baseThresholds;
  const frac = TRIM_SCALE_RULES.tranche_fraction;
  let peak = entry, taken = 0, realized = 0, remaining = 1, exited = false, outcome = "time_stop", lastClose = entry;
  const restore = overrideFirstTranche != null ? swapThresholds(regime, thresholds) : null;
  try {
    for (const b of seq) {
      lastClose = b.c;
      const age = (b.t - flaggedMs) / 60000;
      const mk = (m, pk) => ({ entryPremium: entry, currentMark: m, peakPremium: pk, ageMinutes: age, cortexEvidence: null, planStop, planTarget, status: taken > 0 ? "TRIM" : "OPEN", trimmed: taken > 0, entryCortexScore: null, exitMode: "trim_scale", regime, trimsTaken: taken });
      // Pessimistic protective check FIRST at the bar LOW (peak still pre-widen) —
      // mirrors gradeThroughExitEngine's ratchet-mode precedent exactly (that harness
      // checks `/ratchet|runner/` on dLow too); tier-exit-mode-ab.mjs's own copy of
      // this trim_scale loop only checked `plan_stop` here and silently dropped floor
      // exits that occur before the bar's high is reached, which never mattered for
      // ITS neutral-regime C-tier population (the 2026-08-27 guard already suppresses
      // the floor there) but would silently miss exactly the trend dead-zone dumps
      // this script exists to measure — so both reasons are handled here.
      const dLow = evaluateExitState(mk(b.l, peak));
      if (dLow.action === "EXIT" && dLow.reason === "plan_stop") { realized += remaining * pnlAt(planStop); exited = true; outcome = "stopped"; break; }
      if (dLow.action === "EXIT" && /^ratchet|^runner_floor/.test(dLow.reason)) {
        const floorMark = dLow.floorPnlPct != null ? entry * (1 + dLow.floorPnlPct / 100) : b.l;
        realized += remaining * pnlAt(Math.max(b.l, floorMark));
        remaining = 0; exited = true; outcome = dLow.reason; break;
      }
      peak = Math.max(peak, b.h);
      let dHigh = evaluateExitState(mk(b.h, peak));
      while (dHigh.action === "TRIM" && taken < thresholds.length) {
        realized += frac * pnlAt(entry * (1 + thresholds[taken] / 100));
        remaining -= frac; taken += 1;
        dHigh = evaluateExitState(mk(b.h, peak));
      }
      if (dHigh.action === "EXIT" && dHigh.reason === "trim_scale_runner_target") { realized += remaining * pnlAt(planTarget); remaining = 0; exited = true; outcome = "doubled"; break; }
      if (dHigh.action === "EXIT" && /^ratchet|^runner_floor/.test(dHigh.reason)) {
        // Floor dump — honor the floor mark exactly as production's resolveExitMark does.
        const floorMark = dHigh.floorPnlPct != null ? entry * (1 + dHigh.floorPnlPct / 100) : b.l;
        realized += remaining * pnlAt(Math.max(b.l, floorMark));
        remaining = 0; exited = true; outcome = dHigh.reason; break;
      }
      const dClose = evaluateExitState(mk(b.c, peak));
      if (dClose.action === "EXIT" && dClose.reason === "flat_theta_bleed") { realized += remaining * pnlAt(b.c); exited = true; outcome = "flat_scratch"; break; }
    }
  } finally {
    restore?.();
  }
  if (!exited) { realized += remaining * pnlAt(lastClose); outcome = taken > 0 ? "runner_close" : "time_stop"; }
  return { pnl_pct: Math.round(realized * 10) / 10, outcome, peak_pnl_pct: Math.round(pnlAt(peak) * 10) / 10 };
}

function swapThresholds(regime, newThresholds) {
  const prev = TRIM_SCALE_RULES.tranches_by_regime[regime];
  TRIM_SCALE_RULES.tranches_by_regime[regime] = newThresholds;
  return () => {
    TRIM_SCALE_RULES.tranches_by_regime[regime] = prev;
  };
}

// ── FIX B — RE-IMPLEMENTED decision logic (decideTrimScale is not exported and its
// floor computation isn't overridable in-process). Bar-replay harness is the same
// shape as gradeTrimScaleExit above; only the floor-in-the-dead-zone rule differs:
// a peak in the regime's own dead zone [ratchet_arm_pnl_pct, firstTranche) floors at
// peak*0.5 instead of the hard 0% breakeven — everything else (early-arm 5%, lock
// 20%, post-trim runner 50%, trim ladder, runner target, flat timeout) is identical
// to the shipped decideTrimScale, copied from its own comments/thresholds so this
// cannot silently invent behavior beyond the one line being tested.
function fixBFloorPct(peakPnlPct, trimmed, regime) {
  if (trimmed) return EXIT_RULES.runner_floor_pct; // 50 — unchanged
  if (peakPnlPct == null) return null;
  if (peakPnlPct >= EXIT_RULES.ratchet_lock_pnl_pct) return EXIT_RULES.ratchet_lock_floor_pct; // 20 — unchanged
  const firstTranche = TRIM_SCALE_RULES.tranches_by_regime[regime][0];
  const armAt = EXIT_RULES.ratchet_arm_pnl_pct; // 20
  if (peakPnlPct >= armAt) {
    if (firstTranche > armAt && peakPnlPct < firstTranche) {
      // Genuine dead zone: no tranche will ever arm before this floor could. Partial
      // floor instead of breakeven — bank HALF the peak rather than giving it all back.
      return Math.round(peakPnlPct * 0.5 * 100) / 100;
    }
    return EXIT_RULES.ratchet_arm_floor_pct; // 0 — outside the dead zone, unchanged
  }
  if (peakPnlPct >= EXIT_RULES.ratchet_early_arm_pnl_pct) return EXIT_RULES.ratchet_early_arm_floor_pct; // 5
  return null;
}

function gradeTrimScaleExitFixB(seq, entry, planStop, planTarget, flaggedMs, regime) {
  const pnlAt = (mark) => ((mark - entry) / entry) * 100;
  const thresholds = TRIM_SCALE_RULES.tranches_by_regime[regime] ?? TRIM_SCALE_RULES.tranches_by_regime.neutral;
  const frac = TRIM_SCALE_RULES.tranche_fraction;
  let peak = entry, taken = 0, realized = 0, remaining = 1, exited = false, outcome = "time_stop", lastClose = entry;
  for (const b of seq) {
    lastClose = b.c;
    const low = b.l, high = b.h, close = b.c;
    const pnlLow = pnlAt(low);
    // 1. Protective: plan stop vs shared/fixB floor, whichever sits higher (mirrors
    //    decideTrimScale's own stopIsHigher precedence).
    const armed = trimTranchesArmed(pnlAt(peak), regime);
    const trimAvailable = armed > taken;
    const floor = fixBFloorPct(pnlAt(peak), taken > 0, regime);
    const floorMark = floor != null ? entry * (1 + floor / 100) : null;
    const floorBreached = floor != null && pnlLow <= floor && !trimAvailable;
    // planStop/planTarget are always real numbers here (computed at the two call
    // sites below from PLAN_RULES, never null) — this harness has no code path that
    // omits them, unlike the shipped decideTrimScale it mirrors.
    if (low <= planStop) {
      const stopIsHigher = floorMark == null || planStop >= floorMark;
      if (stopIsHigher && !floorBreached) {
        realized += remaining * pnlAt(planStop); exited = true; outcome = "stopped"; break;
      }
    }
    if (floorBreached) {
      realized += remaining * pnlAt(Math.max(low, floorMark));
      remaining = 0; exited = true; outcome = "fixb_floor"; break;
    }
    peak = Math.max(peak, high);
    const peakPnl = pnlAt(peak);
    const armedNow = trimTranchesArmed(peakPnl, regime);
    while (armedNow > taken) {
      realized += frac * pnlAt(entry * (1 + thresholds[taken] / 100));
      remaining -= frac; taken += 1;
    }
    if (taken >= thresholds.length && high >= planTarget) {
      realized += remaining * pnlAt(planTarget); remaining = 0; exited = true; outcome = "doubled"; break;
    }
    const age = (b.t - flaggedMs) / 60000;
    if (age >= EXIT_RULES.flat_timeout_min && peakPnl < EXIT_RULES.flat_band_pct && pnlAt(close) > -EXIT_RULES.flat_band_pct) {
      realized += remaining * pnlAt(close); exited = true; outcome = "flat_scratch"; break;
    }
  }
  if (!exited) { realized += remaining * pnlAt(lastClose); outcome = taken > 0 ? "runner_close" : "time_stop"; }
  return { pnl_pct: Math.round(realized * 10) / 10, outcome, peak_pnl_pct: Math.round(pnlAt(peak) * 10) / 10 };
}

function insufficient(reason) {
  if (JSON_OUT) console.log(JSON.stringify({ ok: false, insufficient_data: true, reason }, null, 2));
  else {
    console.log(`\n=== regime-dead-zone-ab — INSUFFICIENT DATA ===`);
    console.log(reason);
  }
}

function summarize(rows) {
  const n = rows.length;
  if (n === 0) return { n: 0, win_rate: null, avg_pnl_pct: null };
  const wins = rows.filter((r) => r.pnl_pct > 0).length;
  const avgPnl = rows.reduce((s, r) => s + r.pnl_pct, 0) / n;
  return { n, win_rate: Math.round((wins / n) * 1000) / 1000, avg_pnl_pct: Math.round(avgPnl * 10) / 10 };
}

async function main() {
  const res = await fetchAuditJson(BASE, `/api/admin/zerodte/tier-export?days=${DAYS}`);
  if (!res.ok || !res.json) {
    insufficient(
      `Could not reach GET /api/admin/zerodte/tier-export?days=${DAYS} -> ${res.status} via=${res.via ?? "none"}.`
    );
    await releaseAuditClerkSession();
    process.exitCode = 1;
    return;
  }
  const allPlays = Array.isArray(res.json?.plays) ? res.json.plays : [];
  // Population: DIRECTIONAL plays with a known session_regime (trim_scale's own
  // conditioning input) — condor plays don't run through decideTrimScale at all.
  const population = allPlays.filter(
    (p) =>
      p.play_type !== "CONDOR" &&
      REGIMES.includes(p.session_regime) &&
      typeof p.entry_premium === "number" &&
      p.entry_premium > 0 &&
      typeof p.top_strike === "number" &&
      p.top_strike > 0 &&
      typeof p.expiry === "string" &&
      p.expiry.length === 10 &&
      (p.direction === "long" || p.direction === "short") &&
      typeof p.first_flagged_at === "string"
  );

  if (population.length < MIN_N) {
    insufficient(
      `Only ${population.length} directional rows with a known session_regime in the last ${DAYS} days ` +
        `(${allPlays.length} total) — below --min-n=${MIN_N}. Try a larger --days window.`
    );
    await releaseAuditClerkSession();
    process.exitCode = 1;
    return;
  }

  const graded = { current: [], fixA: [], fixB: [] };
  const byRegime = {
    trend: { current: [], fixA: [], fixB: [] },
    neutral: { current: [], fixA: [], fixB: [] },
    range: { current: [], fixA: [], fixB: [] },
  };
  let barsFetchFailed = 0;
  let deadZoneRows = 0;

  for (const p of population) {
    const side = p.direction === "long" ? "call" : "put";
    const occ = occSymbol(p.ticker, p.expiry, side, p.top_strike);
    const bars = await fetchAggBars(occ, 1, "minute", p.expiry, p.expiry, "1500").catch(() => []);
    if (!bars?.length) { barsFetchFailed += 1; continue; }
    const entry = p.entry_premium;
    const flaggedMs = Date.parse(p.first_flagged_at);
    if (!Number.isFinite(flaggedMs)) { barsFetchFailed += 1; continue; }
    const planStop = entry * (1 + PLAN_RULES.stop_pct / 100);
    const planTarget = entry * (1 + PLAN_RULES.target_pct / 100);
    const seq = bars.filter((b) => b.t > flaggedMs && etMinOfBar(b.t) <= REPLAY_STOP_ET_MIN).sort((a, z) => a.t - z.t);
    if (!seq.length) { barsFetchFailed += 1; continue; }
    const regime = p.session_regime;

    const window = deadZoneWindow(regime);
    const current = gradeTrimScaleExit(seq, entry, planStop, planTarget, flaggedMs, regime, null);
    // Only rows whose graded peak actually fell in the regime's own dead zone (and
    // never armed a tranche) are the population this A/B is about — everywhere else
    // CURRENT/FIX A/FIX B are structurally identical (no floor dump to compare).
    const inDeadZone =
      window != null &&
      current.peak_pnl_pct >= window[0] &&
      current.peak_pnl_pct < window[1] &&
      /^ratchet/.test(current.outcome);
    if (!inDeadZone) continue;
    deadZoneRows += 1;

    const fixA = gradeTrimScaleExit(seq, entry, planStop, planTarget, flaggedMs, regime, window[0]);
    const fixB = gradeTrimScaleExitFixB(seq, entry, planStop, planTarget, flaggedMs, regime);

    const row = { ticker: p.ticker, session_date: p.session_date, regime };
    graded.current.push({ ...row, ...current });
    graded.fixA.push({ ...row, ...fixA });
    graded.fixB.push({ ...row, ...fixB });
    byRegime[regime].current.push({ ...row, ...current });
    byRegime[regime].fixA.push({ ...row, ...fixA });
    byRegime[regime].fixB.push({ ...row, ...fixB });
  }

  if (deadZoneRows < MIN_N) {
    insufficient(
      `Only ${deadZoneRows} rows actually landed in a regime's own dead zone (population=${population.length}, ` +
        `bars-fetch-failed=${barsFetchFailed}) — below --min-n=${MIN_N}. This measures a NARROW slice (peak in ` +
        `[ratchet_arm_pnl_pct, first-tranche) with zero tranches armed) so a small --days window can easily miss ` +
        `it; try a larger --days window before concluding anything.`
    );
    await releaseAuditClerkSession();
    process.exitCode = 1;
    return;
  }

  const overall = {
    current: summarize(graded.current),
    fixA: summarize(graded.fixA),
    fixB: summarize(graded.fixB),
  };
  const perRegime = {};
  for (const r of REGIMES) {
    perRegime[r] = {
      current: summarize(byRegime[r].current),
      fixA: summarize(byRegime[r].fixA),
      fixB: summarize(byRegime[r].fixB),
      note: byRegime[r].current.length < MIN_N
        ? `n=${byRegime[r].current.length} < --min-n=${MIN_N} — too few samples to draw a conclusion for this regime alone.`
        : null,
    };
  }

  const payload = {
    ok: true,
    source: `${BASE}/api/admin/zerodte/tier-export?days=${DAYS} (via=${res.via})`,
    population_directional_with_regime: population.length,
    bars_fetch_failed: barsFetchFailed,
    dead_zone_rows: deadZoneRows,
    overall,
    per_regime: perRegime,
    note:
      "Evidence only — no gate changed by this script. TRIM_SCALE_RULES.tranches_by_regime and " +
      "decideTrimScale's floor computation in exit-engine.ts are unchanged; a policy change is a separate PR " +
      "gated on this evidence meeting the same robustness bar as tier-exit-mode-ab.mjs/E5.",
  };

  if (JSON_OUT) {
    console.log(JSON.stringify(payload, null, 2));
  } else {
    console.log(`\n=== REGIME DEAD-ZONE A/B (CURRENT vs FIX A vs FIX B) ===`);
    console.log(`source: ${payload.source}`);
    console.log(`population (directional, known regime): ${population.length} · bars-fetch-failed: ${barsFetchFailed} · dead-zone rows: ${deadZoneRows}`);
    const fmt = (s) => (s.n === 0 ? "n=0" : `n=${s.n}  win-rate=${(s.win_rate * 100).toFixed(1)}%  avg P&L=${s.avg_pnl_pct}%`);
    console.log(`\nOVERALL`);
    console.log(`  CURRENT  ${fmt(overall.current)}`);
    console.log(`  FIX A    ${fmt(overall.fixA)}`);
    console.log(`  FIX B    ${fmt(overall.fixB)}`);
    for (const r of REGIMES) {
      const pr = perRegime[r];
      console.log(`\n${r.toUpperCase()}${pr.note ? "  (" + pr.note + ")" : ""}`);
      console.log(`  CURRENT  ${fmt(pr.current)}`);
      console.log(`  FIX A    ${fmt(pr.fixA)}`);
      console.log(`  FIX B    ${fmt(pr.fixB)}`);
    }
    console.log(`\n${payload.note}`);
  }

  await releaseAuditClerkSession();
}

main().catch(async (e) => {
  console.error(e);
  await releaseAuditClerkSession().catch(() => {});
  process.exitCode = 1;
});
