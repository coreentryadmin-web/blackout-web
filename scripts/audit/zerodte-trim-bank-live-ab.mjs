/**
 * TRIM-BANK-LIVE A/B — does fixing the trim_scale ladder's live tranche-banking actually
 * help, under real option costs, point-in-time, on held-out sessions?
 * ============================================================================================
 * WHY THIS EXISTS (2026-10-20, member live-book audit directive: "Verify whether Night
 * Hawk's intended trim ladder is +25%, +50%, and +100%... Explain which rules closed today's
 * winners before the first trim, especially the ratchet exits. Check whether those rules
 * conflict with the intended ladder, and test any correction before changing production.")
 *
 * THE FINDING THIS TESTS (confirmed from REAL production data, not inferred):
 *   - exit-sync.ts's `resolveTrimBankLive()`/`resolveTrimRegimeLive()` gate whether the live
 *     engine reads a REAL, persisted `trims_taken` count or RECOMPUTES it fresh every tick
 *     via `trimTranchesArmed(peak, regime)` — the EXACT SAME function `decideTrimScale`
 *     (exit-engine.ts) calls to compute its own `armed` variable on the SAME inputs. When the
 *     flags are off, `trimsTaken === armed` BY CONSTRUCTION on every call, so
 *     `trimAvailable = armed > taken` can NEVER be true -- the trim-ladder's own TRIM action
 *     (bank 1/3 into strength) is structurally UNREACHABLE, and every position instead falls
 *     straight through to the SAME shared floor-breach EXIT ratchet mode uses (reason
 *     `ratchet_early_profit_floor`/`ratchet_breakeven_floor`/`ratchet_profit_floor` -- all
 *     categorized "ratchet" by `categorizeExitReason`, indistinguishable from a true ratchet
 *     row in the board's `closed_reason`/`exit_reason` fields).
 *   - Live evidence (checked directly against production, 2026-10-20): EVERY SINGLE
 *     trim_scale-committed row closed today exited via a ratchet-categorized floor reason
 *     with `timeline_tranches: null` (no partial bank ever recorded) and `mfe_capture_pct`
 *     landing consistently at ~0.35-0.46x of its own peak -- the signature of a pure
 *     `peak * 0.4` floor dump, not a 1/3-banked-then-run ladder. Cross-checked against 14 real
 *     days via `GET /api/market/zerodte/record`'s `managed_source`/`entry_context.executable`
 *     fields: `managed_source: "engine"` (the REAL, authoritative outcome -- not a display
 *     artifact) with a single whole-position exit on EVERY trim_scale row, while the SAME
 *     rows' own WS-11 bar-walk reconstruction (`entry_context.executable.tranches`) shows a
 *     real, achievable first-tranche trigger price the underlying genuinely reached during the
 *     position's real holding window (e.g. MSTR 2026-10-16: reconstruction shows tranche 1 at
 *     12:35 ET banking 1/3 at +16.13%, tranche 2 at 13:06 ET banking another 1/3 at +45.16% --
 *     real price levels that really occurred -- yet the row's REAL, live-managed outcome was a
 *     single "ratchet" exit at +5%, zero tranches ever actually banked).
 *   - `managedGradeView` (record.ts) correctly does NOT substitute the reconstruction's number
 *     for the real outcome when the real exit's reason needs live state a bar-walk can't
 *     replay (a ratchet-style floor, thesis-break, flat-timeout) -- the reconstruction is a
 *     counterfactual "if we'd kept riding past the real close," not a correction. So this is
 *     NOT a case of members being shown a wrong number; it is a case of the real, live
 *     position management never doing what its own frozen policy promises.
 *
 * WHAT THIS SCRIPT TESTS: flipping ZERODTE_TRIM_BANK_LIVE on is a LIVE EXIT-TIMING change for
 * every A/B-tier (highest-conviction) 0DTE play -- exactly the kind of change this codebase's
 * own calibration-first discipline (and the member's own directive) says must be measured
 * before shipping. This replays the REAL historical trim_scale-committed population under BOTH
 * the CURRENT (broken-live, trimsTaken forced equal to armed -- byte-reproducing today's real
 * shipped behavior) and FIXED (trimsTaken genuinely latched, only incrementing when a TRIM
 * decision actually fires) mechanics, using the REAL, imported exit-engine.ts pure functions
 * for every other rule (protective floor fraction, runner floor, target) -- never
 * reimplemented. Real point-in-time NBBO entry/exit quotes, real Polygon minute bars, the same
 * $100-multiplier-correct fee model this toolkit's sibling real-cost scripts already use.
 * Chronological TRAIN/VALIDATION split, held out.
 *
 * THIS SCRIPT NEVER CHANGES A GATE, FILTER, OR EXIT RULE, AND NEVER TOUCHES
 * ZERODTE_TRIM_BANK_LIVE/ZERODTE_TRIM_REGIME_LIVE -- evidence-gathering only.
 *
 * USAGE
 *   POLYGON_API_BASE=https://api.massive.com \
 *   env -u AWS_ACCESS_KEY_ID -u AWS_SECRET_ACCESS_KEY \
 *   node --import tsx scripts/audit/zerodte-trim-bank-live-ab.mjs [options]
 * OPTIONS
 *   --days=N            tier-export lookback (default 45, split TRAIN/VALIDATION)
 *   --max-per-half=N    cap on graded rows PER half (default 30)
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
const MAX_PER_HALF = Math.max(1, Number(argv["max-per-half"] ?? 30));
const FEE_PER_LEG = Math.max(0, Number(argv["fee-per-leg"] ?? 0.65));
const BASE = argv.base ?? "https://blackouttrades.com";
const EMIT_JSON = Boolean(argv.json);

const { TRIM_SCALE_RULES, ratchetTargetReached, trimTranchesArmed, trimScaleFloorPct } = await import(
  `${SRC}lib/zerodte/exit-engine.ts`
);
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
 * Replay trim_scale's REAL mechanics on real bars. `bankMode`:
 *   "broken_live" -- byte-reproduces TODAY'S REAL shipped behavior: trimsTaken is forced equal
 *     to `armed` every tick (ZERODTE_TRIM_BANK_LIVE off), so the TRIM action never fires and
 *     every position rides to the SAME shared floor the ratchet path uses.
 *   "fixed" -- trimsTaken is a genuine, monotonic latch: a tranche only counts as "taken" once
 *     the engine has actually returned a TRIM decision for it (armed > taken at that tick),
 *     after which `taken` increments for every subsequent tick -- exactly what `onTrimBank`
 *     is supposed to persist live.
 * Every other rule (protective floor fraction, runner floor, stop, target) is the REAL,
 * imported exit-engine.ts logic in both modes -- only the tranche-latch mechanics differ.
 */
function replayTrimScale(bars, entryPx, regime, bankMode) {
  let peak = entryPx;
  let taken = 0;
  const bankedLegs = [];
  const tranches = TRIM_SCALE_RULES.tranches_by_regime[regime] ?? TRIM_SCALE_RULES.tranches_by_regime.neutral;
  const stopPx = entryPx * (1 + PLAN_RULES.stop_pct / 100);
  const targetPx = entryPx * (1 + PLAN_RULES.target_pct / 100);

  for (const b of bars) {
    peak = Math.max(peak, b.h);
    const peakPct = pctOf(entryPx, peak);
    const armed = trimTranchesArmed(peakPct, regime);
    // This is the ONLY line that differs between the two modes — exactly the real code's own
    // `trimsTaken = deps.trimsTaken ?? (trimBankLive ? row.trims_taken : trimTranchesArmed(...))`.
    const effectiveTaken = bankMode === "broken_live" ? armed : taken;
    const peakClearedTarget = ratchetTargetReached(peakPct, PLAN_RULES.target_pct);
    const sharedFloor = trimScaleFloorPct(peakPct, peakClearedTarget, regime);
    const floorPx = sharedFloor != null ? entryPx * (1 + sharedFloor / 100) : null;
    const stopAlreadyBreached = b.l <= stopPx;
    const trimAvailable = armed > effectiveTaken && !stopAlreadyBreached;
    const floorBreached = floorPx != null && b.l <= floorPx && !trimAvailable;

    if (b.l <= stopPx && !floorBreached) {
      return { exitMark: stopPx, exitReason: "plan_stop", bankedLegs, finalFraction: 1 - taken * TRIM_SCALE_RULES.tranche_fraction };
    }
    if (floorBreached) {
      return { exitMark: Math.max(floorPx, b.l), exitReason: "shared_floor", bankedLegs, finalFraction: 1 - taken * TRIM_SCALE_RULES.tranche_fraction };
    }
    if (armed > effectiveTaken) {
      const at = tranches[taken];
      const triggerPx = entryPx * (1 + at / 100);
      bankedLegs.push({ fraction: TRIM_SCALE_RULES.tranche_fraction, px: triggerPx });
      taken += 1;
      continue;
    }
    if (taken >= tranches.length && b.c >= targetPx) {
      return { exitMark: targetPx, exitReason: "runner_target", bankedLegs, finalFraction: 1 - taken * TRIM_SCALE_RULES.tranche_fraction };
    }
  }
  const lastBar = bars[bars.length - 1];
  return {
    exitMark: lastBar ? lastBar.c : entryPx,
    exitReason: "time_stop",
    bankedLegs,
    finalFraction: 1 - taken * TRIM_SCALE_RULES.tranche_fraction,
  };
}

function blendedPnlPct(entryPx, result, fees) {
  let dollarPnl = -entryPx * 100 - fees.entryFee;
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
console.log(`  TRIM-BANK-LIVE A/B — does fixing live tranche-banking help? point-in-time, real NBBO, held-out`);
console.log(`  window ${DAYS}d · cap ${MAX_PER_HALF}/half · fee/leg $${FEE_PER_LEG.toFixed(2)}`);
console.log(line("═"));

console.log(`\n[1] Fetching real trim_scale-committed history from ${BASE}/api/admin/zerodte/tier-export (days=${DAYS})…`);
let rows = [];
try {
  const res = await fetchAuditJson(BASE, `/api/admin/zerodte/tier-export?days=${DAYS}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  rows = (res.json?.plays ?? []).filter(
    (r) =>
      r.status === "CLOSED" &&
      r.exit_policy_at_commit === "trim_scale" &&
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
console.log(`    ${rows.length} real CLOSED trim_scale-committed, non-condor rows with usable entry data`);

rows.sort((a, b) => Date.parse(a.first_flagged_at) - Date.parse(b.first_flagged_at));
const mid = Math.floor(rows.length / 2);
const train = rows.slice(0, mid).slice(-MAX_PER_HALF);
const validation = rows.slice(mid).slice(0, MAX_PER_HALF);
console.log(`    TRAIN n=${train.length} (older half, capped) · VALIDATION n=${validation.length} (newer half, capped, held out)`);

async function gradeHalf(label, population) {
  console.log(`\n[${label}] Grading ${population.length} real rows (broken_live vs fixed)…`);
  const results = [];
  let graded = 0, skipped = 0, tranchesEverArmedButUnbanked = 0;
  for (const row of population) {
    const occ = buildOcc(row.ticker, row.expiry, row.direction, row.top_strike);
    const entryAtMs = Date.parse(row.first_flagged_at);
    const entryQuote = await fetchQuoteNear(occ, entryAtMs).catch(() => null);
    if (!entryQuote || !(entryQuote.ask > 0) || !(entryQuote.bid > 0)) { skipped += 1; continue; }
    const entryPx = row.direction === "long" ? entryQuote.ask : entryQuote.bid;
    const bars = await fetchOptionBars(occ, row.session_date).catch(() => []);
    const walkBars = bars.filter((b) => b.t > entryAtMs);
    if (walkBars.length < 2) { skipped += 1; continue; }
    // Real engine resolves regime to "neutral" unless ZERODTE_TRIM_REGIME_LIVE is on — same
    // signature confirmed live today (every exit_policy_snapshot showed active_regime=neutral
    // regardless of the row's own session_regime column). Replay what the engine ACTUALLY uses.
    const regime = "neutral";
    const fees = { entryFee: FEE_PER_LEG, legFee: FEE_PER_LEG };
    const brokenLive = replayTrimScale(walkBars, entryPx, regime, "broken_live");
    const fixed = replayTrimScale(walkBars, entryPx, regime, "fixed");
    const brokenPnl = blendedPnlPct(entryPx, brokenLive, fees);
    const fixedPnl = blendedPnlPct(entryPx, fixed, fees);
    if (brokenPnl == null || fixedPnl == null) { skipped += 1; continue; }
    if (fixed.bankedLegs.length > 0) tranchesEverArmedButUnbanked += 1;
    results.push({
      ticker: row.ticker, brokenPnl, fixedPnl, delta: fixedPnl - brokenPnl,
      banked: fixed.bankedLegs.length, brokenReason: brokenLive.exitReason, fixedReason: fixed.exitReason,
    });
    graded += 1;
  }
  console.log(`    graded ${graded}, skipped ${skipped} (no quote/bars) · fixed-mode would have banked >=1 tranche on ${tranchesEverArmedButUnbanked}/${graded}`);
  return results;
}

const trainResults = await gradeHalf("TRAIN", train);
const validationResults = await gradeHalf("VALIDATION", validation);

function reportHalf(label, rows) {
  console.log(`\n${line()}\n  ${label}\n${line()}`);
  if (rows.length === 0) { console.log(`  n=0 (no eligible graded rows)`); return; }
  const deltas = rows.map((r) => r.delta);
  const [lo, hi] = ci95(deltas) ?? [null, null];
  console.log(
    `  n=${rows.length} · broken_live(today's real shipped behavior)=${fmtPct(mean(rows.map((r) => r.brokenPnl)))} ` +
    `fixed(genuine tranche-banking)=${fmtPct(mean(rows.map((r) => r.fixedPnl)))} mean_delta=${fmtPct(mean(deltas))} ` +
    `CI95=[${fmtPct(lo)}, ${fmtPct(hi)}] ${lo != null && hi != null ? (lo > 0 ? "FIXED SEPARATED (better)" : hi < 0 ? "BROKEN_LIVE SEPARATED (better)" : "INCONCLUSIVE") : "INSUFFICIENT"}`
  );
  const banked = rows.filter((r) => r.banked > 0);
  console.log(`  ${banked.length}/${rows.length} rows would have banked >=1 real tranche under the fix`);
}

reportHalf("TRAIN", trainResults);
reportHalf("VALIDATION (held-out)", validationResults);

console.log(`\n${line()}`);
console.log(`  NO GATE/EXIT RULE/ENV FLAG CHANGED BY THIS SCRIPT. ZERODTE_TRIM_BANK_LIVE stays as-is`);
console.log(`  in production regardless of this result — report only.`);
console.log(line("═"));

if (EMIT_JSON) {
  console.log(JSON.stringify({ train: trainResults, validation: validationResults }));
}
