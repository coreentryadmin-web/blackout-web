/**
 * LOSS-SIDE EARLY DE-RISK A/B — does a symmetric early loss-mitigation rule beat the
 * shipped exit ladder, under real option costs, point-in-time, on held-out sessions?
 * ============================================================================================
 * WHY THIS EXISTS (2026-10-20, member live-book audit directive: "Investigate why we're
 * closing winners around +8% while holding numerous positions down 20-34%... don't dismiss
 * this as normal chop... Test proposed improvements on separate historical sessions with
 * realistic costs before changing production rules. Preserve current exit management and
 * risk controls during testing.")
 *
 * THE STRUCTURAL ASYMMETRY (read directly from src/lib/zerodte/exit-engine.ts, real code,
 * not inferred): the shipped profit-management ladder (ratchet OR trim_scale, per-row frozen
 * exit_policy_at_commit) actively de-risks WINNERS early and often -- the ratchet arms a
 * floor off a peak as low as +5%; trim_scale banks a third of the position at a peak of only
 * +15-20% (range regime) to +40% (trend). There is NO SYMMETRIC mechanism on the LOSS side.
 * A losing position's only protections are: the -50% hard stop (PLAN_RULES.stop_pct), a
 * thesis-break (requires a Cortex veto or >=2 clustered opposing readings exceeding the
 * entry's own committed score margin -- evidence-based, not P&L-based), or flat_theta_bleed
 * (ONLY fires if the play stayed inside the +-10% band the whole time -- never reachable once
 * a position has moved past -10%, which is exactly the population sitting at -20% to -34%
 * live today). Between -10% and -50%, a loser that hasn't broken thesis has ZERO exit
 * protection of any kind. This script tests the most direct candidate fix: a LOSS-side
 * tranche, symmetric in spirit to the existing profit-side ladder, layered ONLY onto the
 * still-fully-open loser population (never touching a row that has already banked any
 * profit tranche, and never touching the winner side at all).
 *
 * METHOD (real, point-in-time, no look-ahead):
 *   1. Pull the REAL historical committed 0DTE population from
 *      GET /api/admin/zerodte/tier-export (entry_premium/top_strike/expiry/direction/
 *      exit_policy_at_commit -- the ADMIN-only fields the public /record route drops,
 *      same source tier-exit-mode-ab.mjs already uses for this exact reason).
 *   2. Chronological TRAIN (older half) / VALIDATION (newer half) split -- held out, never
 *      shapes the read.
 *   3. For every real CLOSED, non-condor, non-is_condor row with a real entry_premium,
 *      build its REAL OCC (ticker already known -- no reference-contracts round trip) and
 *      fetch REAL Polygon minute bars for its session day.
 *   4. Replay the bar path under TWO policies, starting from the REAL entry instant
 *      (first_flagged_at) to the REAL 15:50 ET time-stop:
 *      BASELINE -- the row's OWN frozen exit_policy_at_commit (ratchet or trim_scale),
 *        replayed using the REAL, imported exit-engine.ts pure functions (ratchetFloorPct,
 *        trimTranchesArmed, trimScaleFloorPct, ratchetTargetReached, TRIM_SCALE_RULES,
 *        EXIT_RULES) -- never reimplemented. Thesis-break and flat_theta_bleed are NOT
 *        replayed (no point-in-time Cortex evidence exists to reconstruct them from
 *        historical bars alone -- same disclosed simplification swing-early-trim-ab.mjs
 *        uses for its own sibling swing-side question); this measures the mechanical
 *        profit-ladder + hard-stop + time-stop skeleton only.
 *      CANDIDATE -- BYTE-IDENTICAL to BASELINE on the profit side (same tranches, same
 *        floors, same target) PLUS one new rule: once peak-to-current drawdown reaches
 *        --loss-trigger-pct AND age-in-market >= --age-min-minutes AND NO profit tranche has
 *        yet been banked on this row, exit the WHOLE remaining position immediately at that
 *        bar's realistic fill. Never fires on a row that already banked any profit (the
 *        winner side is completely untouched).
 *   5. Grade BOTH policies with REAL NBBO entry/exit quotes (fetchQuoteNear) and the same
 *      $100-multiplier-correct fee model this toolkit's sibling real-cost scripts already
 *      fee-bug-fixed. Paired comparison (same trade, two policies) -- mean delta + a
 *      normal-approx CI, never a bare point estimate.
 *
 * THIS SCRIPT NEVER CHANGES A GATE, FILTER, OR EXIT RULE -- evidence-gathering only. No
 * threshold here ships unless BOTH halves agree in direction and the CI clears zero.
 *
 * USAGE
 *   POLYGON_API_BASE=https://api.massive.com \
 *   env -u AWS_ACCESS_KEY_ID -u AWS_SECRET_ACCESS_KEY \
 *   node --import tsx scripts/audit/zerodte-loss-side-exit-ab.mjs [options]
 * OPTIONS
 *   --days=N            tier-export lookback (default 45, split TRAIN/VALIDATION)
 *   --max-per-half=N    cap on graded rows PER half (default 40)
 *   --fee-per-leg=USD   disclosed flat per-contract commission assumption (default 0.65)
 *   --base=URL          site base for the admin fetch (default https://blackouttrades.com)
 *   --json
 */

if (!process.env.POLYGON_API_BASE || !/^https?:\/\//.test(process.env.POLYGON_API_BASE)) {
  process.env.POLYGON_API_BASE = "https://api.massive.com";
}

const SRC = new URL("../../src/", import.meta.url).pathname;
const argv = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const m = /^--([^=]+)(?:=(.*))?$/.exec(a);
    return m ? [m[1], m[2] ?? "true"] : [a, "true"];
  })
);
const DAYS = Math.max(4, Number(argv.days ?? 45));
const MAX_PER_HALF = Math.max(1, Number(argv["max-per-half"] ?? 40));
const FEE_PER_LEG = Math.max(0, Number(argv["fee-per-leg"] ?? 0.65));
const BASE = argv.base ?? "https://blackouttrades.com";
const EMIT_JSON = Boolean(argv.json);

const {
  EXIT_RULES,
  TRIM_SCALE_RULES,
  ratchetFloorPct,
  trimTranchesArmed,
  trimScaleFloorPct,
  ratchetTargetReached,
} = await import(`${SRC}lib/zerodte/exit-engine.ts`);
const { PLAN_RULES } = await import(`${SRC}lib/zerodte/plan.ts`);
const { fetchAuditJson, releaseAuditClerkSession } = await import("./lib/audit-auth-fetch.mjs");

const POLYGON_BASE = process.env.POLYGON_API_BASE;
const POLYGON_KEY = process.env.POLYGON_API_KEY;

const fmtPct = (n) => (n == null ? "—" : `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`);
const line = (c = "─", w = 112) => c.repeat(w);
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
function stderr(xs) {
  if (xs.length < 2) return null;
  const m = mean(xs);
  const variance = xs.reduce((a, x) => a + (x - m) ** 2, 0) / (xs.length - 1);
  return Math.sqrt(variance / xs.length);
}
function ci95(xs) {
  const m = mean(xs);
  const se = stderr(xs);
  if (m == null || se == null) return null;
  return [Math.round((m - 1.96 * se) * 100) / 100, Math.round((m + 1.96 * se) * 100) / 100];
}

function buildOcc(ticker, expiryYmd, direction, strike) {
  const [y, m, d] = expiryYmd.split("-");
  const cp = direction === "long" ? "C" : "P";
  const strikeStr = String(Math.round(strike * 1000)).padStart(8, "0");
  return `O:${ticker}${y.slice(2)}${m}${d}${cp}${strikeStr}`;
}

async function fetchQuoteNear(occ, atMs, windowMs = 120_000) {
  const from = (atMs - windowMs) * 1e6, to = (atMs + windowMs) * 1e6;
  const url = `${POLYGON_BASE}/v3/quotes/${encodeURIComponent(occ)}?timestamp.gte=${from}&timestamp.lte=${to}&order=asc&limit=50000&apiKey=${POLYGON_KEY}`;
  const res = await fetch(url);
  const data = await res.json().catch(() => null);
  if (!data?.results?.length) return null;
  let best = null, bestDiff = Infinity;
  for (const q of data.results) {
    const t = Math.floor(q.sip_timestamp / 1e6);
    const diff = Math.abs(t - atMs);
    if (diff < bestDiff) { bestDiff = diff; best = q; }
  }
  return best ? { bid: best.bid_price, ask: best.ask_price } : null;
}

async function fetchOptionBars(occ, day) {
  const url = `${POLYGON_BASE}/v2/aggs/ticker/${encodeURIComponent(occ)}/range/1/minute/${day}/${day}?limit=1000&apiKey=${POLYGON_KEY}`;
  const res = await fetch(url);
  const data = await res.json().catch(() => null);
  return (data?.results ?? []).map((b) => ({ t: b.t, o: b.o, h: b.h, l: b.l, c: b.c }));
}

function pctOf(entry, mark) {
  return entry > 0 ? ((mark - entry) / entry) * 100 : null;
}

/**
 * Replay one row's REAL bar path under the row's OWN frozen policy, optionally with the
 * candidate loss-side rule layered on top. Returns { exitMark, exitReason, exitAtMs,
 * trancheFraction } where trancheFraction is the fraction of the ORIGINAL position still
 * open at exit (1 = never trimmed, 1/3 or 2/3 = ratchet/trim_scale already banked some).
 * We report the BLENDED pnl% across whatever fraction was banked at its own trigger price
 * plus whatever fraction remains at the final exit price -- the same "blended outcome"
 * concept swing-early-trim-ab.mjs already uses for its own paired comparison.
 */
function replay(bars, entryPx, policy, regime, lossRule) {
  let peak = entryPx, trough = entryPx;
  let trimmed = false; // ratchet's own "runner" latch (peak cleared target)
  let tranchesTaken = 0; // trim_scale's own latch
  const bankedLegs = []; // { fraction, px, reason }
  const tranches = TRIM_SCALE_RULES.tranches_by_regime[regime] ?? TRIM_SCALE_RULES.tranches_by_regime.neutral;
  const stopPx = entryPx * (1 + PLAN_RULES.stop_pct / 100);
  const targetPx = entryPx * (1 + PLAN_RULES.target_pct / 100);
  const entryAtMs = bars.length ? bars[0].t : null;

  for (const b of bars) {
    // Intrabar extremes widen peak/trough BEFORE this bar's own exit checks -- mirrors the
    // live latch (Math.max/Math.min widening) in exit-engine.ts.
    peak = Math.max(peak, b.h);
    trough = Math.min(trough, b.l);
    const peakPct = pctOf(entryPx, peak);
    const closePct = pctOf(entryPx, b.c);
    const ageMinutes = entryAtMs != null ? (b.t - entryAtMs) / 60_000 : 0;

    // ── CANDIDATE loss-side rule: only on the still-fully-open remainder, never on a
    //    row that already banked a profit tranche. ────────────────────────────────────
    if (lossRule && bankedLegs.length === 0 && peakPct != null) {
      // Drawdown is measured off the LATCHED PEAK (not entry) -- same "retracing can only
      // breach, peak can only grow" discipline the ratchet floor uses -- so a trade that
      // never had a real favorable excursion is judged on its excursion from the best it
      // ever did, not on a raw entry-anchored number that double-counts entry slippage.
      const drawdownFromPeak = closePct != null && peakPct != null ? closePct - peakPct : null;
      if (ageMinutes >= lossRule.ageMinMinutes && drawdownFromPeak != null && drawdownFromPeak <= -lossRule.lossTriggerPct) {
        return { exitMark: b.c, exitReason: "loss_side_candidate", exitAtMs: b.t, bankedLegs, finalFraction: 1 };
      }
    }

    if (policy === "ratchet") {
      const floor = ratchetFloorPct(peakPct, trimmed);
      const floorPx = floor != null ? entryPx * (1 + floor / 100) : null;
      if (floorPx != null && b.l <= floorPx) {
        return { exitMark: Math.max(floorPx, b.l), exitReason: "ratchet_floor", exitAtMs: b.t, bankedLegs, finalFraction: 1 };
      }
      if (b.l <= stopPx) return { exitMark: stopPx, exitReason: "plan_stop", exitAtMs: b.t, bankedLegs, finalFraction: 1 };
      if (b.h >= targetPx) {
        if (!trimmed) {
          bankedLegs.push({ fraction: 0.5, px: targetPx, reason: "plan_target_trim" });
          trimmed = true;
          continue; // runner continues with the new +50% floor from here
        }
        return { exitMark: targetPx, exitReason: "plan_target_final", exitAtMs: b.t, bankedLegs, finalFraction: 0.5 };
      }
    } else {
      // trim_scale
      const armed = trimTranchesArmed(peakPct, regime);
      const peakClearedTarget = ratchetTargetReached(peakPct, PLAN_RULES.target_pct);
      const floor = trimScaleFloorPct(peakPct, peakClearedTarget, regime);
      const floorPx = floor != null ? entryPx * (1 + floor / 100) : null;
      const trimAvailable = armed > tranchesTaken && !(b.l <= stopPx);
      if (b.l <= stopPx && !(floorPx != null && b.c <= floorPx && !trimAvailable)) {
        return { exitMark: stopPx, exitReason: "plan_stop", exitAtMs: b.t, bankedLegs, finalFraction: 1 - tranchesTaken * TRIM_SCALE_RULES.tranche_fraction };
      }
      if (floorPx != null && b.l <= floorPx && !trimAvailable) {
        return { exitMark: Math.max(floorPx, b.l), exitReason: "trim_scale_floor", exitAtMs: b.t, bankedLegs, finalFraction: 1 - tranchesTaken * TRIM_SCALE_RULES.tranche_fraction };
      }
      if (armed > tranchesTaken) {
        const at = tranches[tranchesTaken];
        const triggerPx = entryPx * (1 + at / 100);
        bankedLegs.push({ fraction: TRIM_SCALE_RULES.tranche_fraction, px: triggerPx, reason: "trim_scale_tranche" });
        tranchesTaken += 1;
        continue;
      }
      if (tranchesTaken >= tranches.length && b.c >= targetPx) {
        return { exitMark: targetPx, exitReason: "trim_scale_runner_target", exitAtMs: b.t, bankedLegs, finalFraction: 1 - tranchesTaken * TRIM_SCALE_RULES.tranche_fraction };
      }
    }
  }
  // Ran to the end of the real bars (time-stop) with nothing else firing.
  const lastBar = bars[bars.length - 1];
  const remainingFraction = policy === "ratchet"
    ? (trimmed ? 0.5 : 1)
    : 1 - tranchesTaken * TRIM_SCALE_RULES.tranche_fraction;
  return {
    exitMark: lastBar ? lastBar.c : entryPx,
    exitReason: "time_stop",
    exitAtMs: lastBar ? lastBar.t : null,
    bankedLegs,
    finalFraction: remainingFraction,
  };
}

/** Blended $PnL% across banked legs + the final remaining fraction, real $100-multiplier
 *  fee charged once PER LEG (banked tranche or final exit), real entry fee charged once. */
function bledPnlPct(entryPx, result, fees) {
  let dollarPnl = -entryPx * 100 - fees.entryFee; // cost basis + entry commission, charged once
  let totalFraction = 0;
  for (const leg of result.bankedLegs) {
    dollarPnl += leg.px * 100 * leg.fraction - fees.legFee;
    totalFraction += leg.fraction;
  }
  const finalFraction = Math.max(0, 1 - totalFraction);
  dollarPnl += result.exitMark * 100 * finalFraction - fees.legFee;
  const costBasis = entryPx * 100;
  return costBasis > 0 ? (dollarPnl / costBasis) * 100 : null;
}

console.log(line("═"));
console.log(`  LOSS-SIDE EARLY DE-RISK A/B — point-in-time, real NBBO, held-out split`);
console.log(`  window ${DAYS}d · cap ${MAX_PER_HALF}/half · fee/leg $${FEE_PER_LEG.toFixed(2)}`);
console.log(line("═"));

console.log(`\n[1] Fetching real committed history from ${BASE}/api/admin/zerodte/tier-export (days=${DAYS})…`);
let rows = [];
try {
  const res = await fetchAuditJson(BASE, `/api/admin/zerodte/tier-export?days=${DAYS}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  rows = (res.json?.plays ?? []).filter(
    (r) =>
      r.status === "CLOSED" &&
      r.play_type !== "CONDOR" &&
      !r.condor &&
      typeof r.entry_premium === "number" &&
      r.entry_premium > 0 &&
      typeof r.top_strike === "number" &&
      typeof r.expiry === "string" &&
      typeof r.first_flagged_at === "string"
  );
} finally {
  await releaseAuditClerkSession();
}
console.log(`    ${rows.length} real CLOSED, non-condor rows with usable entry data`);

rows.sort((a, b) => Date.parse(a.first_flagged_at) - Date.parse(b.first_flagged_at));
const mid = Math.floor(rows.length / 2);
const train = rows.slice(0, mid).slice(-MAX_PER_HALF);
const validation = rows.slice(mid).slice(0, MAX_PER_HALF);
console.log(`    TRAIN n=${train.length} (older half, capped) · VALIDATION n=${validation.length} (newer half, capped, held out)`);

const LOSS_RULE_CANDIDATES = [
  { lossTriggerPct: 15, ageMinMinutes: 10 },
  { lossTriggerPct: 20, ageMinMinutes: 15 },
  { lossTriggerPct: 25, ageMinMinutes: 15 },
  { lossTriggerPct: 30, ageMinMinutes: 20 },
];

async function gradeHalf(label, population) {
  console.log(`\n[${label}] Grading ${population.length} real rows against ${LOSS_RULE_CANDIDATES.length} candidate loss-side rules…`);
  const results = new Map(); // ruleKey -> graded[]
  for (const rule of LOSS_RULE_CANDIDATES) {
    results.set(`${rule.lossTriggerPct}/${rule.ageMinMinutes}`, []);
  }
  let graded = 0, skipped = 0;
  for (const row of population) {
    // One real entry quote + one real bar fetch per row, reused across every rule
    // candidate (the replay itself is pure/offline) -- never re-fetched per rule.
    const occ = buildOcc(row.ticker, row.expiry, row.direction, row.top_strike);
    const entryAtMs = Date.parse(row.first_flagged_at);
    const entryQuote = await fetchQuoteNear(occ, entryAtMs).catch(() => null);
    if (!entryQuote || !(entryQuote.ask > 0) || !(entryQuote.bid > 0)) { skipped += 1; continue; }
    const entryPx = row.direction === "long" ? entryQuote.ask : entryQuote.bid;
    const bars = await fetchOptionBars(occ, row.session_date).catch(() => []);
    const walkBars = bars.filter((b) => b.t > entryAtMs);
    if (walkBars.length < 2) { skipped += 1; continue; }
    const regime = row.session_regime === "trend" || row.session_regime === "range" ? row.session_regime : "neutral";
    const policy = row.exit_policy_at_commit === "ratchet" ? "ratchet" : "trim_scale";
    const fees = { entryFee: FEE_PER_LEG, legFee: FEE_PER_LEG };
    const baseline = replay(walkBars, entryPx, policy, regime, null);
    const baselinePnl = bledPnlPct(entryPx, baseline, fees);
    if (baselinePnl == null) { skipped += 1; continue; }
    for (const rule of LOSS_RULE_CANDIDATES) {
      const candidate = replay(walkBars, entryPx, policy, regime, rule);
      const candidatePnl = bledPnlPct(entryPx, candidate, fees);
      if (candidatePnl == null) continue;
      results.get(`${rule.lossTriggerPct}/${rule.ageMinMinutes}`).push({
        ticker: row.ticker, baselinePnl, candidatePnl, delta: candidatePnl - baselinePnl,
        baselineReason: baseline.exitReason, candidateReason: candidate.exitReason,
      });
    }
    graded += 1;
  }
  console.log(`    graded ${graded}, skipped ${skipped} (no quote/bars)`);
  return results;
}

const trainResults = await gradeHalf("TRAIN", train);
const validationResults = await gradeHalf("VALIDATION", validation);

function reportHalf(label, resultsMap) {
  console.log(`\n${line()}\n  ${label}\n${line()}`);
  for (const [key, rows] of resultsMap) {
    if (rows.length === 0) { console.log(`  rule ${key}: n=0 (no eligible loss-side trigger fired)`); continue; }
    const deltas = rows.map((r) => r.delta);
    const [lo, hi] = ci95(deltas) ?? [null, null];
    const baselineMean = mean(rows.map((r) => r.baselinePnl));
    const candidateMean = mean(rows.map((r) => r.candidatePnl));
    const triggered = rows.filter((r) => r.candidateReason === "loss_side_candidate").length;
    console.log(
      `  rule trigger=-${key.split("/")[0]}% age>=${key.split("/")[1]}min: n=${rows.length} (fired on ${triggered}) ` +
      `baseline=${fmtPct(baselineMean)} candidate=${fmtPct(candidateMean)} mean_delta=${fmtPct(mean(deltas))} ` +
      `CI95=[${fmtPct(lo)}, ${fmtPct(hi)}] ${lo != null && hi != null ? (lo > 0 ? "CANDIDATE SEPARATED (better)" : hi < 0 ? "BASELINE SEPARATED (better)" : "INCONCLUSIVE") : "INSUFFICIENT"}`
    );
  }
}

reportHalf("TRAIN", trainResults);
reportHalf("VALIDATION (held-out)", validationResults);

console.log(`\n${line()}`);
console.log(`  NO GATE/EXIT RULE CHANGED BY THIS SCRIPT. A rule only ships if BOTH halves agree`);
console.log(`  in direction and the VALIDATION CI clears zero on a real n — report only.`);
console.log(line("═"));

if (EMIT_JSON) {
  const dump = {};
  for (const [k, v] of trainResults) dump[`train:${k}`] = v;
  for (const [k, v] of validationResults) dump[`validation:${k}`] = v;
  console.log(JSON.stringify(dump));
}
