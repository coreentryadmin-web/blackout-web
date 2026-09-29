#!/usr/bin/env node
/**
 * 0DTE BLOCKED-SETUP PREMIUM-BASIS BACKTEST
 * ==========================================
 *
 * WHY THIS EXISTS
 * ---------------
 * The live calibration endpoint (GET /api/market/zerodte/calibration) already grades every
 * hard-gate rejection counterfactually — but ONLY on underlying-direction basis, because a
 * blocked setup never had a contract picked (no OCC pinned on the rejection row). "Would have
 * won" there means "the stock moved any amount in the right direction by session end" — a far
 * lower bar than a real 0DTE option actually turning a profit. The 2026-09-16 live-monitor
 * session found score_floor/thesis_rank_reject blocking a population that clears that
 * underlying-direction bar 58.7-58.8% of the time (n=755/823) — suggestive, but NOT proof these
 * blocked setups would have been profitable option trades.
 *
 * This script closes that gap: for each blocked setup, it PROBES A REAL ATM 0DTE CONTRACT (same
 * technique zerodte-sim.mjs's --grade mode already uses in production) and grades that contract's
 * OWN real Polygon minute bars through the SAME gradePlanFromBars/PLAN_RULES (-50%/+100%/15:50 ET)
 * every live commit is graded with. Nothing reimplemented; nothing fabricated — if no tradeable
 * ATM contract had real bars that day, the row is reported ungradeable, never guessed.
 *
 * WHAT'S REAL vs. APPROXIMATED (honesty)
 * ---------------------------------------
 * REAL: gradePlanFromBars + PLAN_RULES (src/lib/zerodte/plan.ts, imported, not reimplemented).
 *   Contract probing (probeAtm0dte/occSymbol/strikeIncrement) is copied verbatim from
 *   zerodte-sim.mjs's own backtest mode — same technique already used and disclosed there.
 * APPROXIMATED: the contract picked is an ATM 0DTE strike at block time, NOT necessarily the exact
 *   contract production's real selector (pickChainContract-equivalent, live-OI-filtered) would
 *   have chosen — zerodte-sim.mjs's own backtest-mode doc discloses the identical limitation
 *   ("historical per-strike OI is not available"). This measures "a reasonable, real, tradeable
 *   0DTE contract at that strike/day", not "the exact contract the live board would have printed".
 * ENTRY: the CLOSE of the first contract bar strictly after the block time (blockedAtMs) — never
 *   the block bar's own high/low (intrabar look-ahead), matching skip-grading.ts's own entry rule.
 *
 * USAGE
 *   env -u AWS_ACCESS_KEY_ID -u AWS_SECRET_ACCESS_KEY \
 *   node --import tsx scripts/audit/zerodte-blocked-premium-backtest.mjs [--gate=score_floor] [--max=150] [--days=14] [--json]
 */
if (!process.env.POLYGON_API_BASE || !/^https?:\/\//.test(process.env.POLYGON_API_BASE)) {
  process.env.POLYGON_API_BASE = "https://api.massive.com";
}

import { mintClerkPremiumSession } from "./lib/prod-clerk-session.mjs";

const SRC = new URL("../../src/", import.meta.url).pathname;
const { fetchAggBars } = await import(`${SRC}lib/providers/polygon-largo.ts`);
const { gradePlanFromBars, PLAN_RULES, etMinutesOf } = await import(`${SRC}lib/zerodte/plan.ts`);

const argv = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const m = /^--([^=]+)(?:=(.*))?$/.exec(a);
    return m ? [m[1], m[2] ?? "true"] : [a, "true"];
  })
);
const GATES = argv.gate ? String(argv.gate).split(",") : ["score_floor", "thesis_rank_reject"];
const MAX_PER_GATE = Math.max(1, Number(argv.max ?? 150));
const DAYS = Math.max(1, Number(argv.days ?? 14));
const EMIT_JSON = Boolean(argv.json);
const base = argv.base || "https://blackouttrades.com";

function etYmd(ms) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date(ms));
}
function strikeIncrement(spot) {
  if (spot < 25) return 0.5;
  if (spot < 100) return 1;
  if (spot < 250) return 2.5;
  return 5;
}
function occSymbol(ticker, expiryYmd, side, strike) {
  const yymmdd = expiryYmd.slice(2).replace(/-/g, "");
  const cp = side === "put" ? "P" : "C";
  const strikeInt = String(Math.round(strike * 1000)).padStart(8, "0");
  return `O:${ticker.toUpperCase()}${yymmdd}${cp}${strikeInt}`;
}

/** Spot at/just after blockedAtMs — first underlying bar with t >= blockedAtMs that session. */
async function spotAtBlock(underlying, date, blockedAtMs) {
  const bars = await fetchAggBars(underlying.toUpperCase(), 1, "minute", date, date, "1500").catch(() => []);
  const clean = (bars ?? [])
    .filter((b) => Number.isFinite(b.t) && Number.isFinite(b.c) && b.c > 0)
    .sort((a, b) => a.t - b.t);
  const at = clean.find((b) => b.t >= blockedAtMs) ?? clean[clean.length - 1];
  return at ? at.c : null;
}

/** Probe an ATM 0DTE contract with real bars that session — copied verbatim (technique) from
 *  zerodte-sim.mjs's own backtest-mode probeAtm0dte. */
async function probeAtm0dte(underlying, date, side, spot) {
  const inc = strikeIncrement(spot);
  const base = Math.round(spot / inc) * inc;
  const ladder = [base, base + inc, base - inc, base + 2 * inc, base - 2 * inc];
  for (const strike of ladder) {
    if (strike <= 0) continue;
    const occ = occSymbol(underlying, date, side, strike);
    const bars = await fetchAggBars(occ, 1, "minute", date, date, "1500").catch(() => []);
    const clean = (bars ?? [])
      .map((b) => ({ t: b.t, h: b.h, l: b.l, c: b.c }))
      .filter((b) => Number.isFinite(b.t) && Number.isFinite(b.h) && Number.isFinite(b.l) && Number.isFinite(b.c) && b.c > 0);
    if (clean.length) return { occ, strike, bars: clean };
  }
  return null;
}

/** Entry = close of the first contract bar STRICTLY AFTER blockedAtMs (never the block bar itself —
 *  matches skip-grading.ts's own entryBarOf rule). Null if no such bar (block too late in the day). */
function entryBarOf(bars, blockedAtMs) {
  for (const bar of [...bars].sort((a, b) => a.t - b.t)) {
    if (bar.t <= blockedAtMs) continue;
    if (etMinutesOf(bar.t) > PLAN_RULES.time_stop_et_minutes) return null;
    if (Number.isFinite(bar.c) && bar.c > 0) return bar;
  }
  return null;
}

async function gradeOneRow(row) {
  const direction = row.direction === "long" || row.direction === "short" ? row.direction : null;
  if (direction == null) return { verdict: "ungradeable", reason: "no long/short direction" };
  const blockedAtMs = Date.parse(row.observed_at);
  if (!Number.isFinite(blockedAtMs)) return { verdict: "ungradeable", reason: "block time unreadable" };
  if (etMinutesOf(blockedAtMs) > PLAN_RULES.time_stop_et_minutes) {
    return { verdict: "ungradeable", reason: "blocked after 3:50 ET hard exit" };
  }
  const date = row.session_date || etYmd(blockedAtMs);
  const side = direction === "long" ? "call" : "put";

  const spot = await spotAtBlock(row.ticker, date, blockedAtMs);
  if (spot == null) return { verdict: "ungradeable", reason: "no underlying bars that session" };

  const atm = await probeAtm0dte(row.ticker, date, side, spot);
  if (!atm) return { verdict: "ungradeable", reason: "no ATM 0DTE contract with real bars that session" };

  const entryBar = entryBarOf(atm.bars, blockedAtMs);
  if (!entryBar) return { verdict: "ungradeable", reason: "no contract bar after block time inside plan window" };

  const grade = gradePlanFromBars(atm.bars, entryBar.c, entryBar.t + 1);
  if (grade.outcome === "ungradeable") return { verdict: "ungradeable", reason: "grader returned ungradeable" };
  return {
    verdict: grade.pnl_pct > 0 ? "would_have_won" : "would_have_lost",
    outcome: grade.outcome,
    pnl_pct: grade.pnl_pct,
    occ: atm.occ,
    entry: entryBar.c,
  };
}

async function main() {
  const session = await mintClerkPremiumSession({ appUrl: base });
  if (session.skip) {
    console.log("SKIP —", session.reason);
    return;
  }
  const headers = { Cookie: session.cookieHeader, Accept: "application/json" };
  const results = {};
  try {
    for (const gate of GATES) {
      const res = await fetch(`${base}/api/admin/zerodte/rejection-export?gate_failed=${gate}&limit=1000`, { headers });
      const json = await res.json().catch(() => ({}));
      const allRows = json.rows || [];
      const cutoff = Date.now() - DAYS * 24 * 3600 * 1000;
      const rows = allRows.filter((r) => Date.parse(r.observed_at) >= cutoff).slice(0, MAX_PER_GATE);
      console.log(`\n[${gate}] ${allRows.length} total rejections, ${rows.length} in last ${DAYS}d sampled (cap ${MAX_PER_GATE})`);

      let won = 0, lost = 0, ungradeable = 0;
      const ungradeableReasons = {};
      const pnlPcts = [];
      let i = 0;
      for (const row of rows) {
        i += 1;
        if (i % 25 === 0) console.log(`    ...${i}/${rows.length}`);
        const g = await gradeOneRow(row);
        if (g.verdict === "ungradeable") {
          ungradeable += 1;
          ungradeableReasons[g.reason] = (ungradeableReasons[g.reason] || 0) + 1;
        } else {
          if (g.verdict === "would_have_won") won += 1; else lost += 1;
          pnlPcts.push(g.pnl_pct);
        }
      }
      const graded = won + lost;
      const avgPnl = pnlPcts.length ? pnlPcts.reduce((a, b) => a + b, 0) / pnlPcts.length : null;
      results[gate] = {
        sampled: rows.length,
        graded,
        ungradeable,
        won,
        lost,
        win_rate_pct: graded ? Math.round((won / graded) * 1000) / 10 : null,
        avg_pnl_pct: avgPnl != null ? Math.round(avgPnl * 10) / 10 : null,
        ungradeable_reasons: ungradeableReasons,
      };
      console.log(`    PREMIUM-BASIS: graded=${graded} won=${won} lost=${lost} win_rate=${results[gate].win_rate_pct}% avg_pnl=${results[gate].avg_pnl_pct}% ungradeable=${ungradeable}`);
      console.log(`    ungradeable reasons:`, JSON.stringify(ungradeableReasons));
    }
  } finally {
    if (session.cleanup) await session.cleanup();
  }
  if (EMIT_JSON) console.log("\n" + JSON.stringify(results, null, 2));
}

main().catch((e) => {
  console.error("ERR", e.message, e.stack);
  process.exitCode = 1;
});
