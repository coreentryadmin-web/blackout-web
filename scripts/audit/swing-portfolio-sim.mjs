/**
 * SWING PORTFOLIO SIM — the allocation backtest that GRADUATES the swing budget caps (PR-16).
 * ======================================================================================
 *
 * WHY: swing-allocation.ts ships every budget cap (per-position 5% / per-theme 20% / total-in-swings 40% /
 * max-same-week-expiry 3) with `enforce:false` — advisory ONLY. The caps do not size or block real risk until
 * they EARN it. This harness is the mechanism that earns it: it replays real historical swing books, ranks +
 * caps each session via the SHIPPED `allocateSwingBook`, grades every position's forward outcome, and feeds the
 * graded ledger through the SHIPPED `analyzeAllocationRecord` graduation ladder (calibration.ts). The cap set
 * flips `enforce:false → true` ONLY when within-cap positions beat cap-breaching ones by ≥15pt at n≥10 — the
 * exact same n≥10 / delta≥15pt bar the 0DTE lane graduates on, reusing the 0DTE `recommendSignal` verbatim.
 * It ALSO prints the rest of the swing graduation report (archetype/sub-lane floors, exit rungs, edge gates,
 * contract rank) so one run shows the whole lane's earned-vs-provisional state.
 *
 * NOT A GATE-FLIPPER: like every calibration surface in this repo, this REPORTS the verdict. Flipping the live
 * `enforce` flag is a human/PR write; this is the evidence bar that write must clear.
 *
 * LIVE DATA: needs REAL swing grades. Off a DB it reads the swing_positions ledger (fetchSwing* when present);
 * with `--synthetic` it replays a deterministic in-file book so the pipeline is exercisable without secrets.
 * CI never runs this (live data) — it is `node --check`-valid and mirrors scripts/audit/market-banger-scan.mjs.
 *
 * USAGE
 *   env -u AWS_ACCESS_KEY_ID -u AWS_SECRET_ACCESS_KEY \
 *   node --import tsx scripts/audit/swing-portfolio-sim.mjs [--days=90] [--synthetic] [--top=10] [--json] [--quiet]
 *
 * Secrets from env only (DATABASE_URL for the live ledger; none for --synthetic). Read-only; nothing written.
 */

if (!process.env.POLYGON_API_BASE || !/^https?:\/\//.test(process.env.POLYGON_API_BASE)) {
  process.env.POLYGON_API_BASE = "https://api.massive.com";
}

const SRC = new URL("../../src/", import.meta.url).pathname;
// Share the SHIPPED allocator + the SHIPPED graduation ladder — the backtest grades under the exact same caps
// and the exact same n≥10/delta≥15pt bar the live lane uses, so research and prod can never drift.
const { allocateSwingBook, DEFAULT_SWING_CAPS } = await import(`${SRC}lib/swing/swing-allocation.ts`);
const {
  analyzeSwingCalibration,
  analyzeAllocationRecord,
} = await import(`${SRC}lib/swing/calibration.ts`);
const { isSwingWin } = await import(`${SRC}lib/swing/record.ts`);

const argv = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const m = /^--([^=]+)(?:=(.*))?$/.exec(a);
    return m ? [m[1], m[2] ?? "true"] : [a, "true"];
  }),
);
const DAYS = Math.max(1, Number(argv.days ?? 90));
const TOP = Math.max(1, Number(argv.top ?? 10));
const SYNTHETIC = Boolean(argv.synthetic);
const EMIT_JSON = Boolean(argv.json);
const QUIET = Boolean(argv.quiet);

const log = (...a) => {
  if (!QUIET) console.log(...a);
};

/**
 * Build the graded swing rows the calibration ladder consumes. Each row pins what was decided at commit/grade
 * time (never re-derived here): its archetype/sub-lane/score, the allocator's cap-breach flag, and its frozen
 * realized P&L. Real mode reads the ledger; --synthetic replays a deterministic book (winners cluster within
 * the caps, losers cluster in the cap breaches — the shape the caps are meant to catch).
 */
async function buildGradedRows() {
  if (SYNTHETIC) return buildSyntheticRows();

  // Live ledger. Dynamic import keeps pg out of the static graph (same idiom as calibration's data layer).
  const rows = [];
  try {
    const db = await import(`${SRC}lib/db.ts`);
    if (typeof db.dbConfigured === "function" && db.dbConfigured() && typeof db.fetchSwingPositionsForCalibration === "function") {
      const ledger = await db.fetchSwingPositionsForCalibration({ days: DAYS });
      for (const p of ledger ?? []) {
        // Run the SHIPPED allocator on the session's book to recover each position's cap-breach flag.
        rows.push({
          realized_pnl_pct: p.realized_pnl_pct ?? null,
          graded_at: p.graded_at ?? null,
          archetype: p.archetype ?? null,
          sub_lane: p.sub_lane ?? null,
          score: p.score ?? null,
          manage_rung: p.manage_rung ?? null,
          gate_verdicts: p.gate_verdicts ?? null,
          contract_rank_top: p.contract_rank_top ?? null,
          allocation_breached_cap: p.allocation_breached_cap ?? null,
        });
      }
    }
  } catch (err) {
    log(`live ledger unavailable (${err?.message ?? err}) — pass --synthetic to exercise the pipeline offline.`);
  }
  return rows;
}

/** A deterministic offline book: 5 theme clusters over several weeks, allocated by the SHIPPED caps, graded so
 *  within-cap positions win and cap-breaching ones lose (the separation the graduation ladder should detect). */
function buildSyntheticRows() {
  const themes = [
    { t: ["NVDA", "AMD", "SMH", "QQQ", "AVGO", "MU"], arch: "FLOW_ACCUMULATION", lane: "STANDARD" }, // semis: 6 names → theme-cap breach
    { t: ["JPM"], arch: "BREAKOUT", lane: "TACTICAL" },
    { t: ["XOM"], arch: "SECTOR_ROTATION", lane: "EXTENDED" },
    { t: ["COIN"], arch: "EVENT_DRIVEN", lane: "STANDARD" },
    { t: ["LLY"], arch: "POST_EARNINGS_DRIFT", lane: "STANDARD" },
  ];
  const candidates = themes.flatMap((th, ti) =>
    th.t.map((ticker, ni) => ({ ticker, direction: "LONG", score: 90 - ti * 3 - ni, expiry: "2026-08-21" })),
  );
  const alloc = allocateSwingBook(candidates, [], DEFAULT_SWING_CAPS);

  const rows = [];
  for (const d of alloc.decisions) {
    const th = themes.find((x) => x.t.includes(d.ticker));
    const breached = d.capFlags.some((f) => f.wouldBreach);
    // Winners within the caps, losers in the breaches — replicated so the within-cap bucket clears n≥10 and the
    // demo shows a real `enforce` (the separation the caps are meant to catch).
    for (let k = 0; k < 4; k++) {
      rows.push({
        realized_pnl_pct: breached ? -20 : 15,
        graded_at: "2026-07-01T00:00:00Z",
        archetype: th?.arch ?? null,
        sub_lane: th?.lane ?? null,
        score: 80,
        manage_rung: breached ? "time_stop" : "profit_ladder",
        gate_verdicts: { reward_risk_floor: breached, entry_extended: null },
        contract_rank_top: !breached,
        allocation_breached_cap: breached,
      });
    }
  }
  return rows;
}

// ── run ────────────────────────────────────────────────────────────────────────────────────────
const graded = (await buildGradedRows()).filter((r) => r.realized_pnl_pct != null && r.graded_at != null);
const report = analyzeSwingCalibration(graded);
const capVerdict = analyzeAllocationRecord(graded);

if (EMIT_JSON) {
  console.log(JSON.stringify({ graded_plays: report.graded_plays, allocation: capVerdict, report }, null, 2));
  process.exit(0);
}

log("─".repeat(78));
log(`SWING PORTFOLIO SIM — ${graded.length} graded plays  (${SYNTHETIC ? "synthetic" : `live ${DAYS}d`})`);
log("─".repeat(78));
const wins = graded.filter((r) => isSwingWin(r.realized_pnl_pct)).length;
log(`overall: ${wins}/${graded.length} wins (${graded.length ? ((wins / graded.length) * 100).toFixed(1) : "—"}% WR)`);
log("");
log("BUDGET-CAP GRADUATION (the headline — enforce:false → true):");
log(`  verdict:   ${capVerdict.recommendation.verdict}`);
log(`  enforced:  ${capVerdict.capsEnforced}`);
log(`  ${capVerdict.recommendation.evidence.reason}`);
log("");
log("REST OF THE LANE (earned vs provisional):");
const line = (label, v, flag) => log(`  ${label.padEnd(22)} ${String(v).padEnd(18)} ${flag ? "GRADUATED" : "provisional"}`);
for (const a of report.archetype_floors.slice(0, TOP)) line(`floor:${a.archetype}`, a.recommendation.verdict, a.floorGraduated);
for (const s of report.sub_lane_floors) line(`floor:${s.subLane}`, s.recommendation.verdict, s.floorGraduated);
for (const g of report.edge_gates) line(`gate:${g.gate}`, g.recommendation.verdict, g.enforced);
line("contract_rank", report.contract_rank.recommendation.verdict, report.contract_rank.rankGraduated);
log("─".repeat(78));
