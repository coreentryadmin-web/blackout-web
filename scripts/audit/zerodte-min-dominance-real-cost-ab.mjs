/**
 * MIN_DOMINANCE REAL-COST A/B — does the FLOW-origin call/put dominance evidence gate
 * (`SETUP_MIN_DOMINANCE=0.55`, board.ts) actually separate winners from losers, under real
 * option costs, point-in-time, on held-out data?
 * ============================================================================================
 * WHY THIS EXISTS (2026-10-20, member directive: "Compare timestamped Swift examples against
 * Night Hawk's decisions and identify exactly where each was missed... Test the strongest
 * remaining explanation and implement a candidate improvement if the evidence supports it.
 * Validate on unseen sessions with realistic option spreads, slippage, fees, and losses
 * included. Keep existing risk controls intact.")
 * ------------------------------------------------------------------------------------------
 * A literal comparison against a real Swift trade recap (2026-10-19,
 * `docs/audit/history/swift-trades/2026-10-19.json`, via `zerodte-swift-comparison.mjs`) found
 * 11/13 (84.6%) of Swift's real 0DTE winners that day were NOT discovery misses and NOT timing
 * misses — Night Hawk generated a real candidate for the same ticker/direction, often with
 * timing comparable to or earlier than Swift's own apparent entry, and REJECTED it on a hard or
 * evidence gate. The single most frequent individual gate code across that real-missed
 * population was `min_dominance` (QQQ 16x, SPX 3x, SPY 3x that one day alone) — a gate this
 * round's work had not yet tested quantitatively (unlike `score_floor`/`thesis_rank_reject`,
 * both already real-cost/held-out tested this round). This script closes that gap.
 *
 * THE GATE (board.ts's `deriveZeroDteSetups`, real/unmodified): before a FLOW-origin candidate
 * is even built, call-side vs put-side AGGRESSION-WEIGHTED premium must show a clear majority —
 * `dominance = max(callAggr, putAggr) / (callAggr + putAggr) >= SETUP_MIN_DOMINANCE (0.55)`. A
 * ticker whose real options flow is genuinely two-sided that day (common on heavily-hedged,
 * highly-liquid names like QQQ/SPX) never becomes a setup at all under this gate, regardless of
 * what the underlying price is actually doing.
 *
 * METHOD (real, point-in-time, no look-ahead — same discipline as
 * zerodte-missed-trades-tracker.mjs, whose flow-loading/walk scaffold this script reuses):
 *   1. Load real multi-day UW flow (persisted local history + live top-up).
 *   2. For every ticker/direction pair, walk EVERY one of its own real print instants
 *      chronologically. At each instant, call the REAL `deriveZeroDteSetups` on flow rows
 *      truncated to THAT instant only (`alerted_at <= cutoffMs`) — never a full-day aggregate,
 *      which would leak later prints into an earlier decision (the exact bug a prior tool in
 *      this toolkit already caught and fixed, see that script's own header).
 *   3. Classify each pair by its FULL DAY of evaluation:
 *      - PASS: the pair appears in `setups` (cleared ALL FOUR evidence gates — min_gross,
 *        min_aggr_share, min_dominance, max_itm_pct) at ANY instant that day. Entry instant =
 *        the FIRST such instant (earliest the evidence engine would have had a real candidate).
 *      - REJECT_MIN_DOMINANCE: the pair NEVER clears evidence gates all day, AND its FINAL
 *        (most-mature, last-instant) rejection reason is specifically `min_dominance` — isolates
 *        this one gate from the other three evidence gates, which are NOT this test's subject.
 *        Entry instant = the FIRST instant `min_dominance` was the rejection reason (the
 *        earliest point a real missed opportunity's clock could be said to start).
 *   4. Grade BOTH populations identically under REAL costs: point-in-time OCC built directly
 *      from the setup's own real ticker/expiry/direction/strike (no reference-contracts round
 *      trip needed — the strike is already known), real NBBO entry/exit (`fetchQuoteNear`),
 *      realistic entry delay, real option minute-bar walk under the UNCHANGED, real
 *      `PLAN_RULES` mechanical -50/+100 stop/target (exit management and risk controls held
 *      fixed throughout — never touched by this test), minus the same $100-multiplier-correct
 *      fee model this round's RVOL/thesis-rank-reject real-cost scripts already fee-bug-fixed.
 *   5. TRAIN/VALIDATION: chronological session-day split, held-out half never shapes the read.
 *
 * WHAT'S REAL vs. APPROXIMATED: REAL — deriveZeroDteSetups (the exact evidence-gate math, not
 * reimplemented), real UW flow alerts, real Polygon NBBO/minute bars, real PLAN_RULES. NOT
 * measured — the downstream HARD-gate stack (score_floor/thesis_rank_reject/VIX/etc.) is not
 * evaluated here on purpose: this test isolates the EVIDENCE-gate question (would this ticker
 * even have become a scoreable candidate) from the commit-decision question those other,
 * already-tested gates answer. A PASS row is not a claim production would have COMMITTED it —
 * only that it would have existed as a real, scoreable setup for the downstream gates to judge.
 *
 * THIS SCRIPT NEVER CHANGES A GATE, FILTER, OR EXIT RULE — evidence-gathering only.
 *
 * USAGE
 *   POLYGON_API_BASE=https://api.massive.com \
 *   env -u AWS_ACCESS_KEY_ID -u AWS_SECRET_ACCESS_KEY \
 *   node --import tsx scripts/audit/zerodte-min-dominance-real-cost-ab.mjs [options]
 * OPTIONS
 *   --days=N            multi-day flow lookback (default 20, split TRAIN/VALIDATION)
 *   --min-premium=N     min alert premium (default 250000)
 *   --max-per-half=N    cap on graded candidates PER population PER half (default 40)
 *   --entry-delay=SEC   realistic entry delay (default 90)
 *   --hold-minutes=N    max holding window (default 90)
 *   --fee-per-leg=USD   disclosed flat per-contract commission assumption (default 0.65)
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
const DAYS = Math.max(2, Number(argv.days ?? 20));
const MIN_PREMIUM = Math.max(0, Number(argv["min-premium"] ?? 250_000));
const MAX_PER_HALF = Math.max(1, Number(argv["max-per-half"] ?? 40));
const ENTRY_DELAY_SEC = Math.max(0, Number(argv["entry-delay"] ?? 90));
const HOLD_MINUTES = Math.max(5, Number(argv["hold-minutes"] ?? 90));
const FEE_PER_LEG = Math.max(0, Number(argv["fee-per-leg"] ?? 0.65));
const EMIT_JSON = Boolean(argv.json);

const { fetchMarketFlowAlertRows } = await import(`${SRC}lib/providers/unusual-whales.ts`);
const { extractChainFieldsFromRaw } = await import(`${SRC}lib/flow-raw-fields.ts`);
const { dteFromExpiry } = await import(`${SRC}lib/flow-dte.ts`);
const { deriveZeroDteSetups } = await import(`${SRC}lib/zerodte/board.ts`);
const { PLAN_RULES } = await import(`${SRC}lib/zerodte/plan.ts`);
const { loadHistoricalFlowDays } = await import("./lib/zerodte-flow-history.mjs");

const POLYGON_BASE = process.env.POLYGON_API_BASE;
const POLYGON_KEY = process.env.POLYGON_API_KEY;

const fmtUsd = (n) => (n == null ? "—" : n >= 1e6 ? `$${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `$${(n / 1e3).toFixed(0)}k` : `$${n.toFixed(0)}`);
const fmtPct = (n) => (n == null ? "—" : `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`);
const pct = (x) => (x == null ? "n/a" : `${(x * 100).toFixed(1)}%`);
const line = (c = "─", w = 112) => c.repeat(w);
function etYmd(ms) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date(ms));
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
  return (data?.results ?? []).map((b) => ({ t: b.t, o: b.o, h: b.h, l: b.l, c: b.c, v: b.v }));
}

/** Real-cost grade — same $100-multiplier-correct fee math this round's RVOL/thesis-rank-reject
 *  real-cost scripts already fee-bug-fixed (see those scripts' own headers for the SKHX
 *  -2500%-vs-+74% bug this already caught once; applied verbatim here, not re-derived). */
async function gradeRealOption({ occ, direction, day, entryAtMs }) {
  const entryQuote = await fetchQuoteNear(occ, entryAtMs);
  if (!entryQuote || !(entryQuote.bid > 0) || !(entryQuote.ask > 0)) return { outcome: "NO_QUOTE" };
  const entryPxRaw = direction === "long" ? entryQuote.ask : entryQuote.bid;
  const timeStopMs = Date.parse(`${day}T19:50:00Z`);
  const holdEndMs = Math.min(entryAtMs + HOLD_MINUTES * 60_000, timeStopMs);
  const bars = await fetchOptionBars(occ, day).catch(() => []);
  const walkBars = bars.filter((b) => b.t > entryAtMs && b.t <= holdEndMs);
  const stopPx = entryPxRaw * (1 + PLAN_RULES.stop_pct / 100);
  const targetPx = entryPxRaw * (1 + PLAN_RULES.target_pct / 100);
  let exitPx = null, exitReason = "time_stop", exitAtMs = holdEndMs;
  for (const b of walkBars) {
    if (b.l <= stopPx) { exitPx = stopPx; exitReason = "stopped"; exitAtMs = b.t; break; }
    if (b.h >= targetPx) { exitPx = targetPx; exitReason = "target"; exitAtMs = b.t; break; }
  }
  if (exitPx == null) {
    const exitQuote = await fetchQuoteNear(occ, exitAtMs);
    if (!exitQuote || !(exitQuote.bid > 0) || !(exitQuote.ask > 0)) return { outcome: "NO_EXIT_QUOTE" };
    exitPx = exitQuote.bid;
  }
  const dollarPnl = (exitPx - entryPxRaw) * 100 - 2 * FEE_PER_LEG;
  const dollarCost = entryPxRaw * 100;
  const pnlPct = dollarCost > 0 ? (dollarPnl / dollarCost) * 100 : null;
  if (pnlPct == null) return { outcome: "NO_QUOTE" };
  return {
    entryPx: Math.round(entryPxRaw * 100) / 100, exitPx: Math.round(exitPx * 100) / 100,
    pnlPct: Math.round(pnlPct * 100) / 100, exitReason, outcome: pnlPct > 0 ? "WIN" : "LOSS",
  };
}

async function fetchMultiDayFlow(endMs, days, minPremium) {
  const cutoffMs = endMs - days * 86_400_000;
  const rows = [];
  const seen = new Set();
  let olderThan = new Date(endMs).toISOString();
  for (let page = 0; page < 32; page++) {
    let batch;
    try {
      batch = await fetchMarketFlowAlertRows({ limit: 200, min_premium: minPremium, older_than: olderThan });
    } catch (e) {
      console.warn(`  [flow] page ${page + 1} failed: ${e instanceof Error ? e.message : e}`);
      break;
    }
    if (!batch?.length) break;
    let oldestIso = null, oldestMs = Infinity;
    for (const mr of batch) {
      const iso = mr.flow?.alerted_at;
      const ms = Date.parse(iso ?? "");
      if (Number.isFinite(ms) && ms < oldestMs) { oldestMs = ms; oldestIso = iso; }
      const key = `${mr.flow?.ticker}|${mr.flow?.expiry}|${mr.flow?.strike}|${mr.flow?.option_type}|${mr.flow?.alerted_at}|${mr.flow?.premium}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const alertMs = Date.parse(mr.flow?.alerted_at ?? "");
      if (Number.isFinite(alertMs) && alertMs >= cutoffMs && alertMs <= endMs) rows.push(mr);
    }
    if (!oldestIso || oldestMs === Infinity) break;
    if (oldestMs < cutoffMs) break;
    if (oldestIso === olderThan) break;
    olderThan = oldestIso;
  }
  return rows;
}

const nowMs = Date.now();
console.log(line("═"));
console.log(`  MIN_DOMINANCE REAL-COST A/B — point-in-time, real NBBO, held-out split`);
console.log(`  window ${DAYS}d · min premium ${fmtUsd(MIN_PREMIUM)} · cap ${MAX_PER_HALF}/population/half · entry delay ${ENTRY_DELAY_SEC}s`);
console.log(line("═"));

console.log(`\n[1] Loading persisted flow history + a small live top-up…`);
const cutoffMs = nowMs - DAYS * 86_400_000;
const localByDay = loadHistoricalFlowDays({ cutoffMs, endMs: nowMs });
console.log(`    ${localByDay.size} day(s) loaded from local history store`);
const newestLocalMs = localByDay.size
  ? Math.max(...[...localByDay.keys()].map((d) => Date.parse(`${d}T20:00:00Z`)))
  : cutoffMs;
const topUpDays = Math.max(1, Math.ceil((nowMs - newestLocalMs) / 86_400_000) + 1);
const mrows = await fetchMultiDayFlow(nowMs, topUpDays, MIN_PREMIUM);
console.log(`    ${mrows.length} raw alerts fetched live (top-up window ~${topUpDays}d)`);

const byDay = new Map();
for (const [day, rows] of localByDay) byDay.set(day, rows.slice());
for (const mr of mrows) {
  const f = mr.flow;
  const raw = mr.raw ?? {};
  if (!f?.ticker || !f.option_type || f.option_type === "UNKNOWN") continue;
  const chain = extractChainFieldsFromRaw(raw, { strike: f.strike, option_type: f.option_type });
  const alertMs = Date.parse(f.alerted_at ?? "");
  if (!Number.isFinite(alertMs)) continue;
  const day = etYmd(alertMs);
  if (localByDay.has(day)) continue;
  const row = {
    ticker: f.ticker, premium: f.premium, option_type: f.option_type, strike: f.strike, expiry: f.expiry,
    dte: f.expiry ? dteFromExpiry(f.expiry) ?? undefined : undefined,
    alert_rule: chain.alert_rule ?? f.alert_rule ?? undefined, ask_pct: chain.ask_pct,
    underlying_price: chain.underlying_price, fill_price: chain.fill_price, open_interest: chain.open_interest,
    alerted_at: f.alerted_at,
  };
  (byDay.get(day) ?? byDay.set(day, []).get(day)).push(row);
}
const sortedDays = [...byDay.keys()].sort();
console.log(`    spread across ${sortedDays.length} session days: ${sortedDays.join(", ")}`);
if (sortedDays.length < 2) {
  console.log("\n  Fewer than 2 session days — cannot split TRAIN/VALIDATION. Widen --days.");
  process.exit(0);
}
const splitIdx = Math.ceil(sortedDays.length / 2);
const trainDays = new Set(sortedDays.slice(0, splitIdx));
const validationDays = new Set(sortedDays.slice(splitIdx));
console.log(`    TRAIN (older): ${[...trainDays].join(", ")}`);
console.log(`    VALIDATION (newer, held-out): ${[...validationDays].join(", ")}`);

console.log(`\n[2] Walking every ticker/direction's own real print instants (no look-ahead)…`);
const allCandidates = [];
for (const day of sortedDays) {
  const rows = byDay.get(day);
  const byTickerDir = new Map();
  for (const r of rows) {
    const dir = r.option_type === "CALL" ? "long" : "short";
    const key = `${r.ticker}:${dir}`;
    (byTickerDir.get(key) ?? byTickerDir.set(key, []).get(key)).push(r);
  }
  let pairIdx = 0;
  const totalPairs = byTickerDir.size;
  for (const [key, tdRows] of byTickerDir) {
    const [ticker, dir] = key.split(":");
    pairIdx++;
    if (pairIdx === 1 || pairIdx % 20 === 0 || pairIdx === totalPairs) {
      console.log(`    [${day}] ${pairIdx}/${totalPairs} ticker/direction pairs…`);
    }
    const ownPrints = [...tdRows].map((r) => Date.parse(r.alerted_at)).filter((ms) => Number.isFinite(ms)).sort((a, b) => a - b);
    if (!ownPrints.length) continue;

    let firstPass = null; // earliest instant this pair cleared evidence gates
    let lastRejection = null; // the LAST (most mature) instant's rejection, if it never passed
    let firstMinDominanceRejection = null; // earliest instant min_dominance specifically was the reason

    for (const cutoffMs of ownPrints) {
      const truncated = rows.filter((r) => (Date.parse(r.alerted_at) || Infinity) <= cutoffMs);
      const rejections = [];
      const setups = deriveZeroDteSetups(truncated, { maxSetups: 500, nowMs: cutoffMs, todayYmd: day, rejections });
      const s = setups.find((x) => x.ticker === ticker && x.direction === dir && x.expiry && x.top_strike);
      if (s) { firstPass = firstPass ?? { setup: s, decisionMs: cutoffMs }; break; } // once PASSed, stop — this pair is in the PASS population
      const r = rejections.find((x) => x.ticker === ticker && x.direction === dir);
      if (r) {
        lastRejection = { gate: r.gate_failed, decisionMs: cutoffMs };
        if (r.gate_failed === "min_dominance" && !firstMinDominanceRejection) {
          firstMinDominanceRejection = { decisionMs: cutoffMs };
        }
      }
    }

    if (firstPass) {
      allCandidates.push({
        population: "PASS", ticker, direction: dir, day,
        decisionMs: firstPass.decisionMs, expiry: firstPass.setup.expiry, strike: firstPass.setup.top_strike,
        half: trainDays.has(day) ? "TRAIN" : "VALIDATION",
      });
    } else if (lastRejection?.gate === "min_dominance" && firstMinDominanceRejection) {
      // Use the LAST print's own expiry/strike context to build a comparable contract — the
      // rejection record itself doesn't carry expiry/strike (evidence gates fire before a
      // setup object exists), so pull it from this pair's own most recent real flow print.
      const lastRow = [...tdRows].sort((a, b) => Date.parse(b.alerted_at) - Date.parse(a.alerted_at))[0];
      if (lastRow?.expiry && lastRow?.strike) {
        allCandidates.push({
          population: "REJECT_MIN_DOMINANCE", ticker, direction: dir, day,
          decisionMs: firstMinDominanceRejection.decisionMs, expiry: lastRow.expiry.slice(0, 10), strike: Number(lastRow.strike),
          half: trainDays.has(day) ? "TRAIN" : "VALIDATION",
        });
      }
    }
    // Any other final gate (min_gross/min_aggr_share/max_itm_pct) → excluded, not this test's subject.
  }
}
console.log(`    ${allCandidates.length} total candidates (PASS + REJECT_MIN_DOMINANCE combined)`);

const trainPass = allCandidates.filter((c) => c.half === "TRAIN" && c.population === "PASS").slice(0, MAX_PER_HALF);
const trainReject = allCandidates.filter((c) => c.half === "TRAIN" && c.population === "REJECT_MIN_DOMINANCE").slice(0, MAX_PER_HALF);
const valPass = allCandidates.filter((c) => c.half === "VALIDATION" && c.population === "PASS").slice(0, MAX_PER_HALF);
const valReject = allCandidates.filter((c) => c.half === "VALIDATION" && c.population === "REJECT_MIN_DOMINANCE").slice(0, MAX_PER_HALF);
console.log(`    TRAIN: ${trainPass.length} PASS, ${trainReject.length} REJECT_MIN_DOMINANCE`);
console.log(`    VALIDATION: ${valPass.length} PASS, ${valReject.length} REJECT_MIN_DOMINANCE`);

async function gradeAll(label, cands) {
  const out = [];
  for (const c of cands) {
    const occ = buildOcc(c.ticker, c.expiry, c.direction, c.strike);
    const entryAtMs = c.decisionMs + ENTRY_DELAY_SEC * 1000;
    const leg = await gradeRealOption({ occ, direction: c.direction, day: c.day, entryAtMs });
    out.push({ ...c, occ, leg });
    await new Promise((r) => setTimeout(r, 200));
  }
  return out;
}

console.log(`\n[3] Grading TRAIN…`);
const trainGraded = [...(await gradeAll("TRAIN PASS", trainPass)), ...(await gradeAll("TRAIN REJECT", trainReject))];
console.log(`\n[4] Grading VALIDATION…`);
const valGraded = [...(await gradeAll("VAL PASS", valPass)), ...(await gradeAll("VAL REJECT", valReject))];

function statsFor(rows) {
  const graded = rows.filter((r) => r.leg.outcome === "WIN" || r.leg.outcome === "LOSS");
  if (!graded.length) return null;
  const wins = graded.filter((r) => r.leg.outcome === "WIN");
  const losses = graded.filter((r) => r.leg.outcome === "LOSS");
  const winRate = wins.length / graded.length;
  const netExpectancy = graded.reduce((s, r) => s + r.leg.pnlPct, 0) / graded.length;
  const avgLoss = losses.length ? losses.reduce((s, r) => s + r.leg.pnlPct, 0) / losses.length : null;
  let running = 0, peak = 0, maxDd = 0;
  for (const r of graded) { running += r.leg.pnlPct; peak = Math.max(peak, running); maxDd = Math.min(maxDd, running - peak); }
  return { n: graded.length, winRate, netExpectancy, avgLoss, maxDd };
}

function summarize(label, graded) {
  console.log(`\n${line()}`);
  console.log(`  ${label}`);
  console.log(line());
  const pass = graded.filter((r) => r.population === "PASS");
  const reject = graded.filter((r) => r.population === "REJECT_MIN_DOMINANCE");
  const p = statsFor(pass);
  const r = statsFor(reject);
  console.log(`    PASS (cleared evidence gates incl. min_dominance): n=${p?.n ?? 0}  win_rate=${pct(p?.winRate)}  net_expectancy=${p ? fmtPct(p.netExpectancy) : "—"}  avg_loss=${p?.avgLoss != null ? fmtPct(p.avgLoss) : "—"}  max_dd=${p ? fmtPct(p.maxDd) : "—"}`);
  console.log(`    REJECT_MIN_DOMINANCE (never cleared, final reason = min_dominance): n=${r?.n ?? 0}  win_rate=${pct(r?.winRate)}  net_expectancy=${r ? fmtPct(r.netExpectancy) : "—"}  avg_loss=${r?.avgLoss != null ? fmtPct(r.avgLoss) : "—"}  max_dd=${r ? fmtPct(r.maxDd) : "—"}`);
  const MIN_N = 20;
  let verdict;
  if (p && r && p.n >= MIN_N && r.n >= MIN_N) {
    verdict = r.netExpectancy <= p.netExpectancy
      ? `REJECT_MIN_DOMINANCE net expectancy ${fmtPct(r.netExpectancy)} <= PASS ${fmtPct(p.netExpectancy)} — the gate is correctly separating on this basis.`
      : `⚠ REJECT_MIN_DOMINANCE net expectancy ${fmtPct(r.netExpectancy)} > PASS ${fmtPct(p.netExpectancy)} — the gate rejected setups that graded BETTER net of the same real costs. Worth a closer look.`;
  } else {
    verdict = `INSUFFICIENT DATA — PASS n=${p?.n ?? 0}, REJECT n=${r?.n ?? 0} (need >=${MIN_N} each to trust a comparison).`;
  }
  console.log(`    Verdict: ${verdict}`);
  return { pass, reject, pStats: p, rStats: r, verdict };
}

const trainSummary = summarize("TRAIN", trainGraded);
const valSummary = summarize("VALIDATION — HELD OUT, UNSEEN", valGraded);

console.log(`\n${line("═")}`);
console.log(`  No gate, filter, or exit rule changed by this run — evidence-gathering only.`);
console.log(`  Exit management (PLAN_RULES stop/target) held IDENTICAL for both populations —`);
console.log(`  isolates the min_dominance EVIDENCE-GATE decision as the only variable under test.`);
console.log(line("═"));

if (EMIT_JSON) {
  console.log("\n<<<JSON>>>");
  console.log(JSON.stringify({
    days: sortedDays, train: trainGraded, validation: valGraded,
    train_verdict: trainSummary.verdict, validation_verdict: valSummary.verdict,
  }, null, 2));
}
