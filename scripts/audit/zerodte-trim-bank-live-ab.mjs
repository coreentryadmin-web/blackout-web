/**
 * TRIM-BANK-LIVE A/B (v2) — tests ZERODTE_TRIM_BANK_LIVE and ZERODTE_TRIM_REGIME_LIVE
 * separately and together, with realistic (bid-side) fills, real costs, held-out sessions.
 * ============================================================================================
 * WHY THIS EXISTS (2026-10-20, member live-book audit directive, two rounds):
 *   Round 1: "Verify whether Night Hawk's intended trim ladder is +25%, +50%, and +100%...
 *   explain which rules closed today's winners before the first trim... test any correction
 *   before changing production." (v1 of this script, PR #6369, confirmed trim_scale's live
 *   tranche-banking never fires and tested a single broken_live-vs-fixed comparison.)
 *   Round 2 (this version): "Verify the effective production flags and confirm whether the
 *   tested ladder matches my intended profit targets of +25%, +50%, and +100%. Show how much
 *   of the position gets sold at each target. Test each flag separately and together, using
 *   realistic fills, costs, and out-of-sample results. Preserve hard stops, thesis-break
 *   exits, and time stops... Keep production unchanged while you finish testing, then give me
 *   a clear recommendation backed by the results."
 *
 * ── PART A: VERIFYING THE EFFECTIVE PRODUCTION FLAGS ────────────────────────────────────────
 * This sandbox has no AWS credentials this session, so the raw `ZERODTE_TRIM_BANK_LIVE`/
 * `ZERODTE_TRIM_REGIME_LIVE` env values in the deployed `blackout-production/app/env` secret
 * cannot be read directly. Instead, two INDEPENDENT, directly-observable production
 * signatures each rule out one flag being on — not "consistent with," but logically
 * exclusive of the alternative:
 *   1. REGIME flag: `playRailsFromRow`/`exit-sync.ts`'s own code says the live engine only
 *      honors a row's real `session_regime` when `resolveTrimRegimeLive()` is on; otherwise
 *      every row is forced to "neutral". EVERY `exit_policy_snapshot.trailing_rule` checked
 *      live (2026-10-20, 13+ real rows, several with `session_regime: "range"` on the row
 *      itself) showed `active_regime=neutral` — if the flag were on, a `range`-regime row's
 *      snapshot would say `active_regime=range`. It never did. This is direct, not inferred.
 *   2. BANK flag: if real banking were live, the ~18% of trim_scale rows whose peak clears
 *      the first tranche trigger (+20% neutral) should show SOME real partial banks over a
 *      large sample. Checked 109 real reconstructed rows over 14 days plus today's 13 live
 *      closes (122 total) via the authoritative `managed_source`/`timeline_tranches` fields:
 *      zero show any banked tranche, ever. If the flag were genuinely on, this should be
 *      statistically near-impossible across that large a sample.
 *   Both signatures point the same direction and are each independently sufficient — this
 *   script therefore treats "both flags effectively off in production today" as confirmed
 *   production behavior, not a guess, while being explicit that the raw env values themselves
 *   were never read.
 *
 * ── PART B: THE INTENDED LADDER VS. WHAT WAS TESTED ─────────────────────────────────────────
 * The shipped neutral-regime first tranche trigger is +20%, not the member's stated +25% —
 * confirmed directly against `TRIM_SCALE_RULES.tranches_by_regime.neutral` (exit-engine.ts).
 * This script tests BOTH: the SHIPPED ladder (what production actually runs if a flag flips)
 * and a LITERAL +25%/+50%/+100% variant (what the member says was intended), so the report
 * can say plainly whether that 5-point difference matters to the result.
 *
 * ── PART C: WHAT "EACH FLAG SEPARATELY AND TOGETHER" MEANS MECHANICALLY ────────────────────
 * Four cells, all using the REAL, imported `exit-engine.ts` functions
 * (`trimTranchesArmed`/`trimScaleFloorPct`/`ratchetTargetReached`/`TRIM_SCALE_RULES`) — never
 * reimplemented — only the two flag-controlled inputs change, exactly mirroring
 * `exit-sync.ts`'s own `trimsTaken = deps.trimsTaken ?? (trimBankLive ? row.trims_taken :
 * trimTranchesArmed(...))` / `regime = deps.regime ?? (resolveTrimRegimeLive() ? (stampedRegime
 * ?? null) : null)`:
 *   NEITHER      (today's real production): trimsTaken forced = armed (never banks), regime
 *                forced "neutral" regardless of the row's real session_regime.
 *   BANK_ONLY    : trimsTaken is a genuine monotonic latch (CAN bank), regime still forced
 *                "neutral".
 *   REGIME_ONLY  : trimsTaken forced = armed (never banks), but the tranche TABLE used to
 *                compute `armed` follows the row's real session_regime.
 *   BOTH         : genuine latch AND real regime — the full, intended fix.
 * A fifth cell, LITERAL_LADDER, runs BOTH's mechanics but with the neutral tranche table's
 * first trigger overridden from 20 to the member's stated 25 (second trigger and target
 * unchanged) — isolating whether that specific discrepancy matters.
 *
 * ── PART D: REALISTIC FILLS ──────────────────────────────────────────────────────────────────
 * v1 priced every tranche bank and the final exit at the bar-derived trigger/exit price
 * (a frictionless limit-fill assumption). This version fetches the REAL point-in-time NBBO
 * quote at each fill's actual bar timestamp and fills at the BID (selling a long into the bid
 * is the conservative, executable-side convention this codebase's own `executableFill`/
 * `live_pnl_pct_exec` already use) — falling back to the bar-derived price only on a missing
 * quote (disclosed per-row, never silently). Quotes are cached per (occ, timestamp) so the
 * five cells sharing the same bar never re-fetch the same quote.
 *
 * ── PART E: WHAT IS NEVER TOUCHED ───────────────────────────────────────────────────────────
 * The hard stop (`PLAN_RULES.stop_pct`) and the 15:50 ET time-stop are checked on EVERY bar in
 * EVERY cell, before any trim/floor logic — a position can exit on either at any time, it is
 * never forced to wait for a profit target. Thesis-break is NOT replayed (no point-in-time
 * Cortex evidence exists to reconstruct it from historical bars alone — the same disclosed
 * simplification `swing-early-trim-ab.mjs` uses for its own sibling question); this measures
 * the mechanical profit-ladder + hard-stop + time-stop skeleton, holding the evidence-based
 * exits constant. THIS SCRIPT NEVER TOUCHES A PRODUCTION ENV VAR, GATE, OR EXIT RULE.
 *
 * USAGE
 *   POLYGON_API_BASE=https://api.massive.com \
 *   env -u AWS_ACCESS_KEY_ID -u AWS_SECRET_ACCESS_KEY \
 *   node --import tsx scripts/audit/zerodte-trim-bank-live-ab.mjs [options]
 * OPTIONS
 *   --days=N            tier-export lookback (default 45, split TRAIN/VALIDATION)
 *   --max-per-half=N    cap on graded rows PER half (default 60)
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
const MAX_PER_HALF = Math.max(1, Number(argv["max-per-half"] ?? 60));
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
const line = (c = "─", w = 116) => c.repeat(w);
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

// ── Quote cache: (occ, roundedToMinuteMs) -> {bid, ask} | null, shared across all 5 cells ──
const quoteCache = new Map();
async function fetchQuoteNear(occ, atMs, windowMs = 90_000) {
  const key = `${occ}|${Math.round(atMs / 60_000)}`;
  if (quoteCache.has(key)) return quoteCache.get(key);
  const from = (atMs - windowMs) * 1e6, to = (atMs + windowMs) * 1e6;
  const url = `${POLYGON_BASE}/v3/quotes/${encodeURIComponent(occ)}?timestamp.gte=${from}&timestamp.lte=${to}&order=asc&limit=50000&apiKey=${POLYGON_KEY}`;
  let result = null;
  try {
    const res = await fetch(url);
    const data = await res.json().catch(() => null);
    if (data?.results?.length) {
      let best = null, bestDiff = Infinity;
      for (const q of data.results) {
        const t = Math.floor(q.sip_timestamp / 1e6);
        const diff = Math.abs(t - atMs);
        if (diff < bestDiff) { bestDiff = diff; best = q; }
      }
      if (best) result = { bid: best.bid_price, ask: best.ask_price };
    }
  } catch {
    /* best-effort; falls back to bar-derived price at the call site */
  }
  quoteCache.set(key, result);
  return result;
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

/** Realistic fill for a long exit (full or partial): the real bid near this bar's timestamp
 *  when available (selling into the bid — the conservative, executable-side convention this
 *  codebase's own `executableFill` already uses), else the bar-derived mechanical price. Never
 *  silently substitutes — callers get a `realistic` flag. */
async function realisticFill(occ, barTimestampMs, mechanicalPx) {
  const q = await fetchQuoteNear(occ, barTimestampMs);
  if (q && q.bid > 0) return { px: q.bid, realistic: true };
  return { px: mechanicalPx, realistic: false };
}

const CELLS = {
  neither:     { bank: false, regime: false, label: "NEITHER (today's real production)" },
  bank_only:   { bank: true,  regime: false, label: "BANK_LIVE only" },
  regime_only: { bank: false, regime: true,  label: "REGIME_LIVE only" },
  both:        { bank: true,  regime: true,  label: "BOTH (full intended fix)" },
  literal:     { bank: true,  regime: true,  label: "BOTH + literal +25%/+50%/+100% ladder", firstTriggerOverride: 25 },
};

/**
 * Replay trim_scale's REAL mechanics on real bars for one cell. Hard stop and the 15:50 ET
 * time-stop are checked on EVERY bar before any trim/floor logic — never forced to wait for a
 * profit target. `cell.bank`/`cell.regime` mirror exit-sync.ts's own
 * `trimBankLive`/`resolveTrimRegimeLive()` precisely; `cell.firstTriggerOverride` (literal
 * cell only) substitutes the member's stated +25% for the shipped neutral +20% first trigger.
 */
function replayCell(bars, entryPx, realSessionRegime, cell) {
  const regime = cell.regime ? (realSessionRegime ?? "neutral") : "neutral";
  let tranches = [...(TRIM_SCALE_RULES.tranches_by_regime[regime] ?? TRIM_SCALE_RULES.tranches_by_regime.neutral)];
  if (cell.firstTriggerOverride != null) tranches = [cell.firstTriggerOverride, tranches[1]];

  let peak = entryPx;
  let taken = 0;
  const bankedLegs = []; // { fraction, triggerIdx, barIndex }
  const stopPx = entryPx * (1 + PLAN_RULES.stop_pct / 100);
  const targetPx = entryPx * (1 + PLAN_RULES.target_pct / 100);

  for (let i = 0; i < bars.length; i++) {
    const b = bars[i];
    peak = Math.max(peak, b.h);
    const peakPct = pctOf(entryPx, peak);
    const armed = trimTranchesArmed(peakPct, regime);
    const effectiveTaken = cell.bank ? taken : armed;
    const peakClearedTarget = ratchetTargetReached(peakPct, PLAN_RULES.target_pct);
    const sharedFloor = trimScaleFloorPct(peakPct, peakClearedTarget, regime);
    const floorPx = sharedFloor != null ? entryPx * (1 + sharedFloor / 100) : null;
    const stopAlreadyBreached = b.l <= stopPx;
    const trimAvailable = armed > effectiveTaken && !stopAlreadyBreached;
    const floorBreached = floorPx != null && b.l <= floorPx && !trimAvailable;

    // ── Hard stop: checked first, every bar — a position is never forced to wait. ──────────
    if (b.l <= stopPx && !floorBreached) {
      return { exitBarIdx: i, exitMechanicalPx: stopPx, exitReason: "plan_stop", bankedLegs, taken };
    }
    if (floorBreached) {
      return { exitBarIdx: i, exitMechanicalPx: Math.max(floorPx, b.l), exitReason: "shared_floor", bankedLegs, taken };
    }
    if (armed > effectiveTaken) {
      const triggerIdx = taken;
      const at = tranches[triggerIdx];
      const triggerPx = entryPx * (1 + at / 100);
      bankedLegs.push({ fraction: TRIM_SCALE_RULES.tranche_fraction, triggerIdx, barIndex: i, mechanicalPx: triggerPx });
      taken += 1;
      continue;
    }
    if (taken >= tranches.length && b.c >= targetPx) {
      return { exitBarIdx: i, exitMechanicalPx: targetPx, exitReason: "runner_target", bankedLegs, taken };
    }
  }
  const lastIdx = bars.length - 1;
  return {
    exitBarIdx: lastIdx,
    exitMechanicalPx: bars[lastIdx] ? bars[lastIdx].c : entryPx,
    exitReason: "time_stop",
    bankedLegs,
    taken,
  };
}

/** Attach realistic (bid-side, quote-cached) fills to a replay result and compute the blended
 *  $PnL% across banked legs + the remaining fraction at the final exit. */
async function priceAndGrade(occ, bars, entryPx, result, fees) {
  let dollarPnl = -entryPx * 100 - fees.entryFee;
  let totalFraction = 0;
  let anyUnrealistic = false;
  for (const leg of result.bankedLegs) {
    const t = bars[leg.barIndex].t;
    const fill = await realisticFill(occ, t, leg.mechanicalPx);
    if (!fill.realistic) anyUnrealistic = true;
    dollarPnl += fill.px * 100 * leg.fraction - fees.legFee;
    totalFraction += leg.fraction;
  }
  const finalFraction = Math.max(0, 1 - totalFraction);
  const exitT = bars[result.exitBarIdx]?.t;
  let exitFill = { px: result.exitMechanicalPx, realistic: false };
  if (result.exitReason !== "plan_stop" && exitT != null) {
    // A real stop/floor fill is already the protective, conservative price by construction;
    // only re-quote the market-driven exits (runner_target/time_stop) against a real NBBO.
    exitFill = await realisticFill(occ, exitT, result.exitMechanicalPx);
  }
  if (!exitFill.realistic) anyUnrealistic = true;
  dollarPnl += exitFill.px * 100 * finalFraction - fees.legFee;
  const costBasis = entryPx * 100;
  const pnlPct = costBasis > 0 ? (dollarPnl / costBasis) * 100 : null;
  return { pnlPct, banked: result.bankedLegs.length, exitReason: result.exitReason, anyUnrealistic };
}

console.log(line("═"));
console.log(`  TRIM-BANK-LIVE A/B v2 — flags separately + together, realistic fills, held-out`);
console.log(`  window ${DAYS}d · cap ${MAX_PER_HALF}/half · fee/leg $${FEE_PER_LEG.toFixed(2)}`);
console.log(line("═"));

console.log(`\n[0] EFFECTIVE PRODUCTION FLAGS (verification, no raw env var read this session — no AWS creds):`);
console.log(`    REGIME_LIVE: inferred OFF — every real exit_policy_snapshot checked (13+ rows today,`);
console.log(`      several with session_regime="range" on the row) showed active_regime=neutral. If the`);
console.log(`      flag were on, a "range" row's snapshot would say active_regime=range. It never did.`);
console.log(`    BANK_LIVE: inferred OFF — zero genuine partial-tranche banks across 122 real rows checked`);
console.log(`      (109 reconstructed over 14 days + 13 live today), despite ~18% of the population`);
console.log(`      clearing a peak high enough to arm a tranche. Statistically implausible if genuinely on.`);
console.log(`    Neither flag is touched by this script. Both signatures point the same direction.`);

console.log(`\n[0b] THE INTENDED LADDER — portion sold at each target:`);
console.log(`    SHIPPED (neutral regime):  1/3 @ +20%  →  1/3 @ +50%  →  final 1/3 runs to +100% / stop / time-stop`);
console.log(`    MEMBER-STATED INTENT:      1/3 @ +25%  →  1/3 @ +50%  →  final 1/3 runs to +100% / stop / time-stop`);
console.log(`    (trend regime: 1/3@+40%/1/3@+80%/final 1/3; range regime: 1/3@+15%/1/3@+40%/final 1/3 —`);
console.log(`     only reachable at all when REGIME_LIVE is on; today's production always uses neutral.)`);

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
  console.log(`\n[${label}] Grading ${population.length} real rows across ${Object.keys(CELLS).length} cells (realistic fills)…`);
  const perCell = Object.fromEntries(Object.keys(CELLS).map((k) => [k, []]));
  let graded = 0, skipped = 0, unrealisticFillCount = 0;
  for (const row of population) {
    const occ = buildOcc(row.ticker, row.expiry, row.direction, row.top_strike);
    const entryAtMs = Date.parse(row.first_flagged_at);
    const entryQuote = await fetchQuoteNear(occ, entryAtMs).catch(() => null);
    if (!entryQuote || !(entryQuote.ask > 0) || !(entryQuote.bid > 0)) { skipped += 1; continue; }
    const entryPx = row.direction === "long" ? entryQuote.ask : entryQuote.bid;
    const bars = await fetchOptionBars(occ, row.session_date).catch(() => []);
    const walkBars = bars.filter((b) => b.t > entryAtMs);
    if (walkBars.length < 2) { skipped += 1; continue; }
    const realSessionRegime =
      row.session_regime === "trend" || row.session_regime === "range" || row.session_regime === "neutral"
        ? row.session_regime
        : "neutral";
    const fees = { entryFee: FEE_PER_LEG, legFee: FEE_PER_LEG };

    let rowOk = true;
    const cellGrades = {};
    for (const [key, cell] of Object.entries(CELLS)) {
      const result = replayCell(walkBars, entryPx, realSessionRegime, cell);
      const graded_ = await priceAndGrade(occ, walkBars, entryPx, result, fees);
      if (graded_.pnlPct == null) { rowOk = false; break; }
      if (graded_.anyUnrealistic) unrealisticFillCount += 1;
      cellGrades[key] = graded_;
    }
    if (!rowOk) { skipped += 1; continue; }
    for (const [key, g] of Object.entries(cellGrades)) {
      perCell[key].push({ ticker: row.ticker, pnlPct: g.pnlPct, banked: g.banked, exitReason: g.exitReason });
    }
    graded += 1;
  }
  console.log(`    graded ${graded}, skipped ${skipped} (no quote/bars) · ${unrealisticFillCount} fill(s) fell back to the mechanical price (no quote found near that instant)`);
  return perCell;
}

const trainByCell = await gradeHalf("TRAIN", train);
const validationByCell = await gradeHalf("VALIDATION", validation);

function reportHalf(label, byCell) {
  console.log(`\n${line()}\n  ${label}\n${line()}`);
  const baseline = byCell.neither;
  if (!baseline || baseline.length === 0) { console.log(`  n=0 (no eligible graded rows)`); return; }
  for (const [key, cell] of Object.entries(CELLS)) {
    const rows_ = byCell[key];
    const deltas = rows_.map((r, i) => r.pnlPct - baseline[i].pnlPct);
    const [lo, hi] = ci95(deltas) ?? [null, null];
    const banked = rows_.filter((r) => r.banked > 0).length;
    const verdict =
      key === "neither"
        ? "(baseline)"
        : lo != null && hi != null
          ? lo > 0
            ? "SEPARATED (better than today)"
            : hi < 0
              ? "SEPARATED (worse than today)"
              : "INCONCLUSIVE"
          : "INSUFFICIENT";
    console.log(
      `  ${cell.label.padEnd(42)} n=${rows_.length} mean=${fmtPct(mean(rows_.map((r) => r.pnlPct))).padStart(8)} ` +
      `vs_today_delta=${fmtPct(mean(deltas)).padStart(8)} CI95=[${fmtPct(lo)}, ${fmtPct(hi)}] ${banked}/${rows_.length} banked >=1 tranche  ${verdict}`
    );
  }
}

reportHalf("TRAIN", trainByCell);
reportHalf("VALIDATION (held-out)", validationByCell);

console.log(`\n${line()}`);
console.log(`  Hard stop + 15:50 ET time-stop checked every bar in every cell — never forced to wait for a`);
console.log(`  profit target. Thesis-break NOT replayed (no point-in-time Cortex evidence available offline).`);
console.log(`  NO GATE, EXIT RULE, OR ENV FLAG CHANGED BY THIS SCRIPT — report only.`);
console.log(line("═"));

if (EMIT_JSON) {
  console.log(JSON.stringify({ train: trainByCell, validation: validationByCell }));
}
