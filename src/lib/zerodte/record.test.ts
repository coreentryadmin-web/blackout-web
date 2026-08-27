import { test } from "node:test";
import assert from "node:assert/strict";

// record.ts is a pure-aggregation leaf (its only @/lib/db import is type-only,
// erased at runtime; ./plan's etMinutesOf is dependency-free) — no mocks needed.
import type { ZeroDteSetupLogRow } from "@/lib/db";
import {
  asManagedPnlPct,
  buildZeroDteRecord,
  isGradedZeroDteRow,
  isZeroDteWin,
  LOW_N_THRESHOLD,
  officialPlanPnlPct,
  scoreBand,
  scoreForBanding,
  todBucket,
  ZERODTE_RECORD_METHODOLOGY,
} from "./record";

function row(overrides: Partial<ZeroDteSetupLogRow>): ZeroDteSetupLogRow {
  return {
    session_date: "2026-07-13",
    ticker: "TEST",
    direction: "long",
    top_strike: 100,
    expiry: "2026-07-13",
    score: 60,
    score_max: 60,
    dossier_score: null,
    conviction: "C",
    gross_premium: 1_000_000,
    spike: false,
    underlying_at_flag: 100,
    underlying_latest: 100,
    flags_json: null,
    first_flagged_at: "2026-07-13T14:00:00.000Z", // 10:00 ET (EDT)
    last_seen_at: "2026-07-13T14:00:00.000Z",
    close_price: null,
    move_pct: null,
    direction_hit: null,
    graded_at: "2026-07-14T00:00:00.000Z",
    entry_premium: 1,
    flow_avg_fill: 1,
    plan_json: null,
    plan_outcome: "stopped",
    plan_pnl_pct: -50,
    status: "CLOSED",
    last_mark: null,
    peak_premium: null,
    trough_premium: null,
    entry_context: null,
    ...overrides,
  };
}

// The REAL 2026-07-13 session ledger (docs/audit/NIGHTHAWK-VS-SLAYER-0DTE.md §2.2):
// 8 committed plays, 1W/7L — the session whose shape motivated this whole record
// surface. Flagged times are the live ET stamps (July = EDT, so ET+4h = UTC);
// P&L values are the session's live premium moves, here as their plan grades.
const LEDGER_7_13: ZeroDteSetupLogRow[] = [
  row({ ticker: "SPY", direction: "long", first_flagged_at: "2026-07-13T13:55:00Z", score_max: 72, plan_outcome: "stopped", plan_pnl_pct: -52.7 }),
  row({ ticker: "SPXW", direction: "long", first_flagged_at: "2026-07-13T14:00:00Z", score_max: 68, plan_outcome: "stopped", plan_pnl_pct: -69.4 }),
  // Entry-context row (C-2): commit-time score 54 must band this row <55 even
  // though its ratcheted score_max later reached 61.
  row({ ticker: "MU", direction: "long", first_flagged_at: "2026-07-13T13:55:00Z", score_max: 61, plan_outcome: "stopped", plan_pnl_pct: -46.0, entry_context: { score: 54, vix_open: 17.2, spy_bias: "down" } }),
  row({ ticker: "META", direction: "short", first_flagged_at: "2026-07-13T14:40:00Z", score_max: 66, plan_outcome: "stopped", plan_pnl_pct: -50.1 }),
  // Float-noise on purpose: the record must round at the data layer.
  row({ ticker: "QQQ", direction: "short", first_flagged_at: "2026-07-13T14:20:00Z", score_max: 77, plan_outcome: "doubled", plan_pnl_pct: 76.60000000000001 }),
  row({ ticker: "INTC", direction: "short", first_flagged_at: "2026-07-13T16:51:00Z", score_max: 58, plan_outcome: "stopped", plan_pnl_pct: -50.0 }),
  row({ ticker: "AMD", direction: "long", first_flagged_at: "2026-07-13T13:50:00Z", score_max: 70, plan_outcome: "stopped", plan_pnl_pct: -47.9 }),
  row({ ticker: "NVDA", direction: "long", first_flagged_at: "2026-07-13T16:40:00Z", score_max: 63, plan_outcome: "stopped", plan_pnl_pct: -57.3 }),
];

const WINDOW = { since: "2026-06-13", through: "2026-07-13", days: 30 };

test("7/13 fixture ledger: headline aggregates match the audited session (1W/7L)", () => {
  const rec = buildZeroDteRecord(LEDGER_7_13, WINDOW);
  assert.equal(rec.total_flagged, 8);
  assert.equal(rec.graded, 8);
  assert.equal(rec.ungraded, 0);
  assert.equal(rec.wins, 1);
  assert.equal(rec.losses, 7);
  assert.equal(rec.win_rate_pct, 12.5);
  // (-52.7 -69.4 -46.0 -50.1 +76.6 -50.0 -47.9 -57.3) / 8 = -37.1
  assert.equal(rec.avg_pnl_pct, -37.1);
  assert.equal(rec.window.sessions, 1);
  assert.equal(rec.methodology, ZERODTE_RECORD_METHODOLOGY);
  assert.equal(rec.available, true);
});

test("7/13 fixture ledger: direction cut shows the counter-tape long wipeout", () => {
  const rec = buildZeroDteRecord(LEDGER_7_13, WINDOW);
  const long = rec.by_direction.find((b) => b.label === "long");
  const short = rec.by_direction.find((b) => b.label === "short");
  assert.ok(long && short);
  assert.equal(long.n, 5);
  assert.equal(long.wins, 0);
  assert.equal(long.win_rate_pct, 0);
  assert.equal(long.low_n, false); // n=5 is exactly at the threshold — not low-N
  assert.equal(short.n, 3);
  assert.equal(short.wins, 1);
  assert.equal(short.low_n, true);
  // Deterministic ordering: long before short regardless of ledger order.
  assert.deepEqual(rec.by_direction.map((b) => b.label), ["long", "short"]);
});

test("7/13 fixture ledger: time-of-day buckets (9:50 boundary is prime, not open)", () => {
  const rec = buildZeroDteRecord(LEDGER_7_13, WINDOW);
  const prime = rec.by_time_of_day.find((b) => b.label === "prime 9:50-11:00");
  const midday = rec.by_time_of_day.find((b) => b.label === "midday 11:00-14:00");
  assert.ok(prime && midday);
  // AMD flagged exactly 9:50 ET belongs to prime (the open window is [9:30, 9:50)).
  assert.equal(prime.n, 6);
  assert.equal(prime.wins, 1); // QQQ
  assert.equal(midday.n, 2); // INTC 12:51, NVDA 12:40
  assert.equal(midday.low_n, true);
  assert.equal(rec.by_time_of_day.find((b) => b.label === "open 9:30-9:50"), undefined);
});

test("7/13 fixture ledger: outcome + score-band cuts, entry_context score wins banding", () => {
  const rec = buildZeroDteRecord(LEDGER_7_13, WINDOW);
  assert.deepEqual(
    rec.by_outcome.map((b) => [b.label, b.n, b.low_n]),
    [
      ["doubled", 1, true],
      ["stopped", 7, false],
    ]
  );
  // 65+: SPY 72, SPXW 68, META 66, QQQ 77, AMD 70. 55-64: INTC 58, NVDA 63.
  // <55: MU — score_max 61 but entry_context.score 54 (commit-time) must win.
  assert.deepEqual(
    rec.by_score_band.map((b) => [b.label, b.n, b.low_n]),
    [
      ["score 65+", 5, false],
      ["score 55-64", 2, true],
      ["score <55", 1, true],
    ]
  );
});

test("per-play rows: rounding at the data layer + ET rendering + context passthrough", () => {
  const rec = buildZeroDteRecord(LEDGER_7_13, WINDOW);
  const qqq = rec.plays.find((p) => p.ticker === "QQQ");
  assert.ok(qqq);
  assert.equal(qqq.plan_pnl_pct, 76.6); // 76.60000000000001 → rounded where the data is built
  assert.equal(qqq.flagged_et, "10:20 ET");
  const mu = rec.plays.find((p) => p.ticker === "MU");
  assert.ok(mu);
  assert.deepEqual(mu.entry_context, { score: 54, vix_open: 17.2, spy_bias: "down" });
  const amd = rec.plays.find((p) => p.ticker === "AMD");
  assert.equal(amd?.flagged_et, "09:50 ET");
});

test("ungraded and ungradeable rows appear per-play but never in aggregates", () => {
  const withExtras = [
    ...LEDGER_7_13,
    // Live/ungraded (today's session, grading is lazy next session).
    row({ ticker: "LIVE", session_date: "2026-07-14", plan_outcome: null, plan_pnl_pct: null, graded_at: null }),
    // Plan couldn't be measured — neither a win nor a loss.
    row({ ticker: "UNGR", plan_outcome: "ungradeable", plan_pnl_pct: null }),
  ];
  const rec = buildZeroDteRecord(withExtras, WINDOW);
  assert.equal(rec.total_flagged, 10);
  assert.equal(rec.graded, 8);
  assert.equal(rec.ungraded, 2);
  assert.equal(rec.wins, 1);
  assert.equal(rec.losses, 7);
  assert.equal(rec.window.sessions, 2);
  assert.ok(rec.plays.some((p) => p.ticker === "LIVE" && p.plan_outcome == null));
  // Newest session first in the per-play list.
  assert.equal(rec.plays[0]!.ticker, "LIVE");
});

test("empty ledger: available=false, no NaN/throw", () => {
  const rec = buildZeroDteRecord([], WINDOW);
  assert.equal(rec.available, false);
  assert.equal(rec.win_rate_pct, null);
  assert.equal(rec.avg_pnl_pct, null);
  assert.deepEqual(rec.by_outcome, []);
});

test("todBucket boundaries (ET): open/prime/midday/late/other", () => {
  // July ⇒ EDT ⇒ ET = UTC−4.
  assert.equal(todBucket("2026-07-13T13:29:00Z"), "other"); // 9:29 pre-open
  assert.equal(todBucket("2026-07-13T13:30:00Z"), "open 9:30-9:50");
  assert.equal(todBucket("2026-07-13T13:49:00Z"), "open 9:30-9:50");
  assert.equal(todBucket("2026-07-13T13:50:00Z"), "prime 9:50-11:00");
  assert.equal(todBucket("2026-07-13T15:00:00Z"), "midday 11:00-14:00");
  assert.equal(todBucket("2026-07-13T18:00:00Z"), "late 14:00-15:30");
  assert.equal(todBucket("2026-07-13T19:30:00Z"), "late 14:00-15:30"); // 15:30 inclusive
  assert.equal(todBucket("2026-07-13T19:31:00Z"), "other");
});

test("scoreBand + scoreForBanding + graded/win predicates", () => {
  assert.equal(scoreBand(65), "score 65+");
  assert.equal(scoreBand(64), "score 55-64");
  assert.equal(scoreBand(55), "score 55-64");
  assert.equal(scoreBand(54), "score <55");
  // Pre-context rows band by score_max; context rows by the committed score.
  assert.equal(scoreForBanding(row({ score_max: 70, entry_context: null })), 70);
  assert.equal(scoreForBanding(row({ score_max: 70, entry_context: { score: 58 } })), 58);
  assert.equal(scoreForBanding(row({ score_max: 70, entry_context: { score: "58" } })), 70); // non-number ctx ignored
  assert.equal(isGradedZeroDteRow(row({ plan_outcome: "time_stop" })), true);
  assert.equal(isGradedZeroDteRow(row({ plan_outcome: "ungradeable" })), false);
  assert.equal(isGradedZeroDteRow(row({ plan_outcome: null })), false);
  assert.equal(isZeroDteWin(row({ plan_pnl_pct: 0.01 })), true);
  assert.equal(isZeroDteWin(row({ plan_pnl_pct: 0 })), false);
  assert.equal(isZeroDteWin(row({ plan_pnl_pct: null })), false);
  assert.equal(LOW_N_THRESHOLD, 5);
});

// ── Fix 5: the graded predicate requires a FINITE plan_pnl_pct (partial-write guard) ──
// isGradedZeroDteRow keyed on plan_outcome while isZeroDteWin keyed on plan_pnl_pct, so a
// PARTIAL write (outcome stamped, pnl still NULL) counted as graded-but-not-a-win → a
// phantom LOSS. The two predicates must agree: no finite pnl ⇒ not graded (retried, not lost).
test("Fix 5: a plan_outcome with a NULL plan_pnl_pct is NOT graded — never a phantom loss", () => {
  assert.equal(isGradedZeroDteRow(row({ plan_outcome: "stopped", plan_pnl_pct: null })), false);
  assert.equal(isGradedZeroDteRow(row({ plan_outcome: "doubled", plan_pnl_pct: 100 })), true);
  const rec = buildZeroDteRecord([row({ ticker: "PART", plan_outcome: "stopped", plan_pnl_pct: null })], WINDOW);
  assert.equal(rec.graded, 0, "a partial-write row is ungraded, not a loss");
  assert.equal(rec.losses, 0);
  assert.equal(rec.ungraded, 1);
  assert.equal(rec.mechanical.graded, 0);
});

// ── Fix 1: the HEADLINE record is the AS-MANAGED (executed) exit, mechanical is a label ─
/** Stamp a realized engine exit (exit-engine.ts buildExitContext shape) onto a row. */
function withExit(
  over: Partial<ZeroDteSetupLogRow>,
  exit: { reason: string; pnl_pct: number }
): ZeroDteSetupLogRow {
  return row({ ...over, entry_context: { ...((over.entry_context as Record<string, unknown>) ?? {}), exit } });
}

test("Fix 1: a ratchet exit books the REALIZED win even though the mechanical plan stopped out", () => {
  // The member was ratcheted out at +22.5% (green never finished red); the fixed
  // -50/+100/15:30 plan grade later books -50%. Headline = the exit actually traded;
  // mechanical = the labeled hold-to-stop comparison.
  const r = withExit(
    { ticker: "AMZN", plan_outcome: "stopped", plan_pnl_pct: -50 },
    { reason: "ratchet_profit_floor", pnl_pct: 22.5 }
  );
  const rec = buildZeroDteRecord([r], WINDOW);
  assert.equal(rec.wins, 1);
  assert.equal(rec.losses, 0);
  assert.equal(rec.win_rate_pct, 100);
  assert.equal(rec.avg_pnl_pct, 22.5);
  assert.deepEqual(rec.by_outcome.map((b) => b.label), ["ratchet"]);
  // Mechanical comparison = the fixed plan grade: a loss.
  assert.equal(rec.mechanical.wins, 0);
  assert.equal(rec.mechanical.losses, 1);
  assert.equal(rec.mechanical.win_rate_pct, 0);
  assert.equal(rec.mechanical.avg_pnl_pct, -50);
  assert.deepEqual(rec.mechanical.by_outcome.map((b) => b.label), ["stopped"]);
  // Per-play carries BOTH grades + the source.
  const play = rec.plays[0]!;
  assert.equal(play.managed_outcome, "ratchet");
  assert.equal(play.managed_pnl_pct, 22.5);
  assert.equal(play.managed_source, "engine");
  assert.equal(play.plan_outcome, "stopped");
  assert.equal(play.plan_pnl_pct, -50);
});

test("Fix 1: with NO engine exit the record falls back to the mechanical plan (source=plan) — the clean path is unchanged", () => {
  const rec = buildZeroDteRecord(LEDGER_7_13, WINDOW);
  // 7/13 rows carry no entry_context.exit → as-managed == mechanical (1W/7L both ways).
  assert.equal(rec.wins, 1);
  assert.equal(rec.losses, 7);
  assert.equal(rec.win_rate_pct, 12.5);
  assert.equal(rec.mechanical.wins, 1);
  assert.equal(rec.mechanical.losses, 7);
  assert.equal(rec.mechanical.win_rate_pct, 12.5);
  const graded = rec.plays.filter((p) => p.managed_source != null);
  assert.equal(graded.length, 8);
  assert.ok(graded.every((p) => p.managed_source === "plan"));
  assert.ok(graded.every((p) => p.managed_pnl_pct === p.plan_pnl_pct));
});

// ── Fix 2: card (peak-first TRIM) vs grade (stop-first) divergence is reconciled by the
// reported record being the AS-MANAGED grade — what the member saw is what is booked. ──
test("Fix 2: a play shown TRIM (target tagged) books the engine's WIN, not the mechanical stop-first -50%", () => {
  const r = withExit(
    { ticker: "TSLA", plan_outcome: "stopped", plan_pnl_pct: -50 },
    { reason: "plan_target_final", pnl_pct: 100 }
  );
  const rec = buildZeroDteRecord([r], WINDOW);
  assert.equal(rec.wins, 1, "member saw a trimmed winner → the record books a win");
  assert.equal(rec.plays[0]!.managed_outcome, "doubled");
  assert.equal(rec.mechanical.losses, 1, "the conservative hold-to-stop grade is kept as the -50% comparison");
});

// ── WS-11: the OFFICIAL executable grade of a TRIM-SCALE row IS a reconstructed as-managed path ──
// scan.ts writes the reconstruction (per-leg `tranches` + blended plan_pnl_pct/plan_outcome) into
// entry_context.executable for a trim_scale row. record.ts routes the AS-MANAGED headline to that
// reconstruction, so the member number == the calibration OFFICIAL number (officialPlanPnlPct).

/** Stamp a WS-11 reconstructed TRIM-SCALE executable grade (the blob scan.ts builds) onto a row. */
function withReconstruction(
  over: Partial<ZeroDteSetupLogRow>,
  exec: { plan_outcome: string; plan_pnl_pct: number; tranches: unknown[] }
): ZeroDteSetupLogRow {
  return row({
    ...over,
    entry_context: {
      ...((over.entry_context as Record<string, unknown>) ?? {}),
      executable: { lane: "conservative", entry_basis: "ask", exit_basis: "bid", exit_policy: "trim_scale", ...exec },
    },
  });
}

// ── REQUIRED TEST 2: mechanical grade == as-managed on the same reconstructed row (delta ≈ 0) ──
test("WS-11 #2: a reconstructed TRIM-SCALE row — as-managed == official mechanical grade (grade_vs_asmanaged_delta ≈ 0)", () => {
  // The three-leg reconstruction from the grader test (blended +25.61%, runner time-stopped).
  const tranches = [
    { tranche: 1, fraction: 1 / 3, exit_pnl_pct: 13.64, exit_reason: "trim_scale_first", at_et: "10:00" },
    { tranche: 2, fraction: 1 / 3, exit_pnl_pct: 36.36, exit_reason: "trim_scale_second", at_et: "10:05" },
    { tranche: 3, fraction: 1 / 3, exit_pnl_pct: 26.82, exit_reason: "time_stop", at_et: "10:10" },
  ];
  const r = withReconstruction(
    // The MID columns still carry the (different) single-walk grade — proving the headline reads
    // the executable reconstruction, not the mid column.
    { ticker: "SPY", plan_outcome: "time_stop", plan_pnl_pct: 40 },
    { plan_outcome: "time_stop", plan_pnl_pct: 25.61, tranches }
  );
  // The reconciliation invariant the scan telemetry records: official − as-managed ≈ 0.
  assert.equal(officialPlanPnlPct(r), 25.61);
  assert.equal(asManagedPnlPct(r), 25.61);
  assert.equal((officialPlanPnlPct(r)! - asManagedPnlPct(r)!) * 100, 0, "grade_vs_asmanaged_delta is 0 bps");

  const rec = buildZeroDteRecord([r], WINDOW);
  const play = rec.plays[0]!;
  assert.equal(play.managed_pnl_pct, 25.61, "member as-managed == the reconstruction");
  assert.equal(play.managed_source, "reconstructed");
  assert.equal(play.managed_outcome, "time_stop");
  assert.equal(play.plan_pnl_pct, 25.61, "the per-play plan column is the executable reconstruction too");
  // Headline == mechanical for a reconstructed row (they are the SAME official number now).
  assert.equal(rec.wins, 1);
  assert.equal(rec.avg_pnl_pct, 25.61);
  assert.equal(rec.mechanical.avg_pnl_pct, 25.61);
});

// ── REQUIRED TEST 3: ratchet mode still single-exit (the reconstruction path does NOT engage) ──
test("WS-11 #3: a RATCHET row (no tranches) is unregressed — as-managed = the live single exit, not a reconstruction", () => {
  // A ratchet row carries a single-walk executable grade (NO tranches) + a live ratchet exit stamp.
  const r = row({
    ticker: "QQQ",
    plan_outcome: "stopped",
    plan_pnl_pct: -50,
    entry_context: {
      executable: { lane: "conservative", plan_outcome: "stopped", plan_pnl_pct: -54.5, exit_policy: "ratchet" },
      exit: { reason: "ratchet_profit_floor", pnl_pct: 22.5 },
    },
  });
  // Official = the single-walk executable grade (the mid fallback is superseded by the exec blob).
  assert.equal(officialPlanPnlPct(r), -54.5);
  // As-managed = the LIVE ratchet exit (source "engine"), untouched by WS-11 (no tranches present).
  assert.equal(asManagedPnlPct(r), 22.5);
  const rec = buildZeroDteRecord([r], WINDOW);
  assert.equal(rec.plays[0]!.managed_source, "engine");
  assert.equal(rec.plays[0]!.managed_pnl_pct, 22.5);
  assert.equal(rec.wins, 1, "the ratchet exit still books its realized win");
});

// ── REQUIRED TEST 4: a row with NO executable reconstruction falls back to the prior behavior ──
test("WS-11 #4: back-compat — a row with no executable blob / no tranches keeps the mid+engine fallback", () => {
  // Legacy row: no entry_context.executable at all, no engine exit → mid columns, source "plan".
  const legacy = row({ ticker: "AMD", plan_outcome: "doubled", plan_pnl_pct: 100, entry_context: null });
  assert.equal(officialPlanPnlPct(legacy), 100); // mid column fallback
  assert.equal(asManagedPnlPct(legacy), 100); // mechanical fallback
  const rec = buildZeroDteRecord([legacy], WINDOW);
  assert.equal(rec.plays[0]!.managed_source, "plan");
  // A malformed executable blob (tranches present but non-array) is ignored — never a fabricated grade.
  const malformed = row({
    ticker: "MU",
    plan_outcome: "stopped",
    plan_pnl_pct: -50,
    entry_context: { executable: { plan_outcome: "stopped", plan_pnl_pct: -55, tranches: "oops" } },
  });
  const rec2 = buildZeroDteRecord([malformed], WINDOW);
  // tranches non-array → not a reconstruction → as-managed falls back to the mechanical exec grade.
  assert.notEqual(rec2.plays[0]!.managed_source, "reconstructed");
  assert.equal(officialPlanPnlPct(malformed), -55);
});

// ── FINDINGS 2026-08-06: a DEGENERATE trim_scale reconstruction must NOT bury a real, better
// (or differently bad) live exit the bar-only reconstruction structurally cannot replay ──────

test("FINDINGS 2026-08-06: a degenerate (single, fraction=1) trim_scale reconstruction defers to the real ratchet-floor exit (MU repro)", () => {
  // Live repro 2026-08-05: MU peaked +16.73%, the ratchet profit floor closed it green at
  // +4.99% ("the protective floor exits so the green trade cannot finish red") — but the
  // bar-only trim_scale reconstruction (which has NO ratchet-floor logic at all) walked the
  // whole session and found a plain -52.02% stop, as ONE full-fraction tranche (no trim ever
  // armed in the replay). Before this fix, that degenerate reconstruction won precedence and
  // silently erased the real green exit from the AS-MANAGED headline.
  const r = row({
    ticker: "MU",
    plan_outcome: "stopped",
    plan_pnl_pct: -52.02,
    entry_context: {
      exit: { reason: "ratchet_early_profit_floor", pnl_pct: 4.99, peak_pnl_pct: 16.73 },
      executable: {
        lane: "conservative",
        exit_policy: "trim_scale",
        plan_outcome: "stopped",
        plan_pnl_pct: -52.02,
        tranches: [{ tranche: 1, fraction: 1, exit_reason: "stopped", exit_pnl_pct: -52.02, at_et: "15:46" }],
      },
    },
  });
  assert.equal(asManagedPnlPct(r), 4.99, "the real ratchet-floor exit wins, not the degenerate reconstruction");
  const rec = buildZeroDteRecord([r], WINDOW);
  assert.equal(rec.plays[0]!.managed_source, "engine");
  assert.equal(rec.plays[0]!.managed_pnl_pct, 4.99);
  assert.equal(rec.wins, 1, "the AS-MANAGED headline books this as a win, matching what actually happened live");
});

test("FINDINGS 2026-08-06: a degenerate trim_scale reconstruction defers to a real thesis-break exit (QQQ repro)", () => {
  // Live repro 2026-08-05: QQQ's thesis broke (a GEX-wall veto) and the engine cut the loss at
  // -12.43% — but the reconstruction (blind to live GEX-wall state) rode the bars to a plain
  // -50.29% stop.
  const r = row({
    ticker: "QQQ",
    plan_outcome: "stopped",
    plan_pnl_pct: -50.29,
    entry_context: {
      exit: { reason: "thesis_break:gex-walls", pnl_pct: -12.43, peak_pnl_pct: 3.39 },
      executable: {
        lane: "conservative",
        exit_policy: "trim_scale",
        plan_outcome: "stopped",
        plan_pnl_pct: -50.29,
        tranches: [{ tranche: 1, fraction: 1, exit_reason: "stopped", exit_pnl_pct: -50.29, at_et: "12:30" }],
      },
    },
  });
  assert.equal(asManagedPnlPct(r), -12.43, "the real, smaller thesis-break loss wins, not the degenerate reconstruction's full stop");
  const rec = buildZeroDteRecord([r], WINDOW);
  assert.equal(rec.plays[0]!.managed_source, "engine");
  assert.equal(rec.plays[0]!.managed_outcome, "thesis_break");
});

// ── FINDINGS 2026-08-27: reconstructionShowsGenuinePartialBank alone is NOT enough — a real,
// TERMINAL live-only exit must still outrank the reconstruction, or the "genuine" partial bank
// becomes a fictitious continuation of a position the live engine already closed. This is the
// correction to the 2026-08-06 fix's over-broad "GENUINE reconstruction always wins" framing:
// live evidence (90-day prod pull) showed 94/104 reconstructed rows also carried a real
// entry_context.exit, 43/94 (46%) sign-flipping the displayed outcome (APLD/MU/SPXW repros in
// the PR). The corrected rule: the reconstruction only outranks a real exit when that real
// exit's OWN reason is one the bar-walk can faithfully reproduce (a plain premium stop, or the
// trim-scale ladder's own target/tranche exits) — see realExitIsBarWalkReproducible.

test("FINDINGS 2026-08-27: a real THESIS-BREAK exit outranks a GENUINE (2+ tranche) reconstruction (APLD-shaped)", () => {
  // The bar-walk reconstruction is structurally blind to live GEX-wall/Cortex thesis state — a
  // real thesis_break exit is not "a stray stamp the reconstruction supersedes", it is the
  // record of the position actually being closed before the reconstruction's bar-walk got there.
  const r = row({
    ticker: "APLD",
    plan_outcome: "time_stop",
    plan_pnl_pct: -0.98,
    entry_context: {
      exit: { reason: "thesis_break:gex-walls", pnl_pct: 19.0 },
      executable: {
        lane: "conservative",
        exit_policy: "trim_scale",
        plan_outcome: "time_stop",
        plan_pnl_pct: -0.98,
        tranches: [
          { tranche: 1, fraction: 1 / 3, exit_pnl_pct: 10.0, exit_reason: "trim_scale_first", at_et: "10:00" },
          { tranche: 2, fraction: 2 / 3, exit_pnl_pct: -6.47, exit_reason: "time_stop", at_et: "15:15" },
        ],
      },
    },
  });
  assert.equal(asManagedPnlPct(r), 19.0, "the real thesis-break exit wins, not the genuine-looking reconstruction");
  const rec = buildZeroDteRecord([r], WINDOW);
  assert.equal(rec.plays[0]!.managed_source, "engine");
  assert.equal(rec.plays[0]!.managed_outcome, "thesis_break");
  assert.equal(rec.wins, 1, "this play is a real win — the reconstruction alone would have booked it as a small loss");
});

test("FINDINGS 2026-08-27: a real RATCHET-FLOOR exit (exactly breakeven) outranks a GENUINE reconstruction (SPXW-shaped)", () => {
  const r = row({
    ticker: "SPXW",
    plan_outcome: "time_stop",
    plan_pnl_pct: 56.07,
    entry_context: {
      exit: { reason: "ratchet_breakeven_floor", pnl_pct: 0 },
      executable: {
        lane: "conservative",
        exit_policy: "trim_scale",
        plan_outcome: "time_stop",
        plan_pnl_pct: 56.07,
        tranches: [
          { tranche: 1, fraction: 1 / 3, exit_pnl_pct: 40.0, exit_reason: "trim_scale_first", at_et: "10:00" },
          { tranche: 2, fraction: 2 / 3, exit_pnl_pct: 64.1, exit_reason: "time_stop", at_et: "15:15" },
        ],
      },
    },
  });
  assert.equal(asManagedPnlPct(r), 0, "the real ratchet-floor exit wins — the position closed at breakeven, not +56%");
  const rec = buildZeroDteRecord([r], WINDOW);
  assert.equal(rec.plays[0]!.managed_source, "engine");
  assert.equal(rec.plays[0]!.managed_outcome, "ratchet");
  assert.equal(rec.breakeven, 1, "breakeven, neither win nor loss — not the fictitious +56% the reconstruction alone would report");
});

test("FINDINGS 2026-08-27: a real FLAT-TIMEOUT exit outranks a genuine reconstruction (live-only reason, unreproducible by the bar-walk)", () => {
  const r = row({
    ticker: "MU",
    plan_outcome: "time_stop",
    plan_pnl_pct: 56.93,
    entry_context: {
      exit: { reason: "flat_theta_bleed", pnl_pct: -21.92 },
      executable: {
        lane: "conservative",
        exit_policy: "trim_scale",
        plan_outcome: "time_stop",
        plan_pnl_pct: 56.93,
        tranches: [
          { tranche: 1, fraction: 1 / 3, exit_pnl_pct: 13.64, exit_reason: "trim_scale_first", at_et: "10:00" },
          { tranche: 2, fraction: 2 / 3, exit_pnl_pct: 78.75, exit_reason: "time_stop", at_et: "15:15" },
        ],
      },
    },
  });
  assert.equal(asManagedPnlPct(r), -21.92, "the real, live-only flat-timeout exit wins, not the reconstruction's fictitious +56.93%");
  const rec = buildZeroDteRecord([r], WINDOW);
  assert.equal(rec.plays[0]!.managed_source, "engine");
  assert.equal(rec.plays[0]!.managed_outcome, "flat_scratch");
  assert.equal(rec.losses, 1);
});

test("FINDINGS 2026-08-27: a GENUINE partial-bank reconstruction still wins when the real exit's reason IS bar-walk-reproducible (no regression)", () => {
  // The reconstruction and the real exit are both trim-scale-family here — the real exit did
  // NOT need any live-only signal, so the reconstruction's own richer per-tranche math (which
  // this real single-exit stamp cannot express) is legitimately preferred. This is the case
  // the 2026-08-06 fix was actually protecting, correctly kept intact by this fix.
  const r = row({
    ticker: "NVDA",
    plan_outcome: "time_stop",
    plan_pnl_pct: 40,
    entry_context: {
      // A real trim_scale_runner_target stamp — mechanical, premium-threshold-driven, exactly
      // what the bar-walk reconstruction itself models — so it does NOT block the reconstruction.
      exit: { reason: "trim_scale_runner_target", pnl_pct: 1 },
      executable: {
        lane: "conservative",
        exit_policy: "trim_scale",
        plan_outcome: "time_stop",
        plan_pnl_pct: 25.61,
        tranches: [
          { tranche: 1, fraction: 1 / 3, exit_pnl_pct: 13.64, exit_reason: "trim_scale_first", at_et: "10:00" },
          { tranche: 2, fraction: 1 / 3, exit_pnl_pct: 36.36, exit_reason: "trim_scale_second", at_et: "10:05" },
          { tranche: 3, fraction: 1 / 3, exit_pnl_pct: 26.82, exit_reason: "time_stop", at_et: "10:10" },
        ],
      },
    },
  });
  assert.equal(asManagedPnlPct(r), 25.61);
  const rec = buildZeroDteRecord([r], WINDOW);
  assert.equal(rec.plays[0]!.managed_source, "reconstructed");
});

test("FINDINGS 2026-08-27: officialPlanPnlPct/isZeroDteWin (calibration + feature-store lane) inherit the fix, not just the as-managed headline", () => {
  // Before this fix, officialPlanPnlPct read entry_context.executable.plan_pnl_pct directly —
  // the RECONSTRUCTION's own blended number — regardless of managedGradeView's precedence, so
  // fixing only the headline would have left the calibration/learning-store base rate corrupted.
  const r = row({
    ticker: "APLD",
    plan_outcome: "time_stop",
    plan_pnl_pct: -0.98,
    entry_context: {
      exit: { reason: "thesis_break:gex-walls", pnl_pct: 19.0 },
      executable: {
        lane: "conservative",
        exit_policy: "trim_scale",
        plan_outcome: "time_stop",
        plan_pnl_pct: -0.98,
        tranches: [
          { tranche: 1, fraction: 1 / 3, exit_pnl_pct: 10.0, exit_reason: "trim_scale_first", at_et: "10:00" },
          { tranche: 2, fraction: 2 / 3, exit_pnl_pct: -6.47, exit_reason: "time_stop", at_et: "15:15" },
        ],
      },
    },
  });
  assert.equal(officialPlanPnlPct(r), 19.0, "official pnl follows the real thesis-break exit, not the fictitious reconstruction");
  assert.equal(isZeroDteWin(r), true, "calibration/feature-store must grade this a WIN, matching what actually happened live");
});

test("FINDINGS 2026-08-27: officialPlanPnlPct stays on the reconstruction when the real exit IS bar-walk-reproducible (no regression)", () => {
  const r = row({
    ticker: "NVDA",
    plan_outcome: "time_stop",
    plan_pnl_pct: 40,
    entry_context: {
      exit: { reason: "trim_scale_runner_target", pnl_pct: 1 },
      executable: {
        lane: "conservative",
        exit_policy: "trim_scale",
        plan_outcome: "time_stop",
        plan_pnl_pct: 25.61,
        tranches: [
          { tranche: 1, fraction: 1 / 3, exit_pnl_pct: 13.64, exit_reason: "trim_scale_first", at_et: "10:00" },
          { tranche: 2, fraction: 1 / 3, exit_pnl_pct: 36.36, exit_reason: "trim_scale_second", at_et: "10:05" },
          { tranche: 3, fraction: 1 / 3, exit_pnl_pct: 26.82, exit_reason: "time_stop", at_et: "10:10" },
        ],
      },
    },
  });
  assert.equal(officialPlanPnlPct(r), 25.61);
  assert.equal(isZeroDteWin(r), true);
});

test("FINDINGS 2026-08-27: officialPlanPnlPct is untouched for ratchet-mode rows (no tranches — pre-existing mechanical-vs-managed divergence, not this bug)", () => {
  // WS-11 #3's own fixture: officialPlanPnlPct deliberately reads the single-walk executable
  // grade (-54.5), NOT the live ratchet exit (+22.5) — that split is the documented, INTENTIONAL
  // mechanical-vs-as-managed distinction (OUTCOME-GRADING-SPEC.md), untouched by this fix, which
  // only ever fires when a GENUINE multi-tranche (or partial-fraction) reconstruction exists.
  const r = row({
    ticker: "QQQ",
    plan_outcome: "stopped",
    plan_pnl_pct: -50,
    entry_context: {
      executable: { lane: "conservative", plan_outcome: "stopped", plan_pnl_pct: -54.5, exit_policy: "ratchet" },
      exit: { reason: "ratchet_profit_floor", pnl_pct: 22.5 },
    },
  });
  assert.equal(officialPlanPnlPct(r), -54.5);
});

test("FINDINGS 2026-08-27: a GENUINE reconstruction wins outright when there is NO real exit stamp at all", () => {
  const r = row({
    ticker: "TSLA",
    plan_outcome: "time_stop",
    plan_pnl_pct: 40,
    entry_context: {
      executable: {
        lane: "conservative",
        exit_policy: "trim_scale",
        plan_outcome: "time_stop",
        plan_pnl_pct: 25.61,
        tranches: [
          { tranche: 1, fraction: 1 / 3, exit_pnl_pct: 13.64, exit_reason: "trim_scale_first", at_et: "10:00" },
          { tranche: 2, fraction: 1 / 3, exit_pnl_pct: 36.36, exit_reason: "trim_scale_second", at_et: "10:05" },
          { tranche: 3, fraction: 1 / 3, exit_pnl_pct: 26.82, exit_reason: "time_stop", at_et: "10:10" },
        ],
      },
    },
  });
  assert.equal(asManagedPnlPct(r), 25.61);
  const rec = buildZeroDteRecord([r], WINDOW);
  assert.equal(rec.plays[0]!.managed_source, "reconstructed");
});

// ── Fix 4a: pnl exactly 0 is a BREAKEVEN — neither win nor loss (SPX 3-way parity) ─────
test("Fix 4a: an exactly-breakeven managed exit is NOT booked as a loss", () => {
  const scratch = withExit(
    { ticker: "GOOG", plan_outcome: "time_stop", plan_pnl_pct: -20 },
    { reason: "flat_theta_bleed", pnl_pct: 0 }
  );
  const win = withExit({ ticker: "NVDA", plan_outcome: "doubled", plan_pnl_pct: 100 }, { reason: "plan_target_final", pnl_pct: 100 });
  const loss = withExit({ ticker: "META", plan_outcome: "stopped", plan_pnl_pct: -50 }, { reason: "plan_stop", pnl_pct: -50 });
  const rec = buildZeroDteRecord([scratch, win, loss], WINDOW);
  assert.equal(rec.graded, 3);
  assert.equal(rec.wins, 1);
  assert.equal(rec.losses, 1);
  assert.equal(rec.breakeven, 1);
  assert.equal(rec.wins + rec.losses + rec.breakeven, rec.graded, "wins+losses+breakeven == graded");
  assert.equal(rec.win_rate_pct, 33.3, "win rate is wins/graded with breakeven in the denominator (SPX parity)");
  const flat = rec.by_outcome.find((b) => b.label === "flat_scratch");
  assert.ok(flat);
  assert.equal(flat.breakeven, 1);
  assert.equal(flat.losses, 0);
  assert.equal(flat.wins, 0);
});

test("Fix 4a: a MECHANICAL exact-0 plan pnl is a breakeven too, not a loss", () => {
  const rec = buildZeroDteRecord([row({ ticker: "FLAT", plan_outcome: "time_stop", plan_pnl_pct: 0 })], WINDOW);
  assert.equal(rec.breakeven, 1);
  assert.equal(rec.losses, 0);
  assert.equal(rec.mechanical.breakeven, 1);
  assert.equal(rec.mechanical.losses, 0);
});

test("buildZeroDteRecord: condor rows stay OUT of the directional headline and populate their own record", () => {
    const rec = buildZeroDteRecord(
      [
        // Two directional plays: one win, one loss.
        row({ ticker: "SPY", plan_outcome: "doubled", plan_pnl_pct: 80 }),
        row({ ticker: "QQQ", plan_outcome: "stopped", plan_pnl_pct: -50 }),
        // Two condors, tagged by entry_context.play_type — one closed inside, one breached.
        row({ ticker: "SPX", plan_outcome: "condor_win", plan_pnl_pct: 12, entry_context: { play_type: "CONDOR" } }),
        row({ ticker: "NDX", plan_outcome: "condor_breach_loss", plan_pnl_pct: -60, entry_context: { play_type: "CONDOR" } }),
      ],
      { since: "2026-07-01", through: "2026-07-13", days: 13 },
    );
    // The directional headline sees ONLY the two directional plays — the condor breach is NOT a
    // directional loss, and the condor credit is NOT a directional win.
    assert.equal(rec.total_flagged, 2, "condors are not in the directional row count");
    assert.equal(rec.graded, 2);
    assert.equal(rec.wins, 1);
    assert.equal(rec.losses, 1);
    assert.equal(rec.win_rate_pct, 50);
    // No condor outcome leaked into the directional by_outcome buckets.
    const labels = rec.by_outcome.map((b) => b.label);
    assert.ok(!labels.some((l) => /condor/i.test(l)), `condor leaked into directional buckets: ${labels}`);
    // The condor lane carries its own realized record.
    assert.equal(rec.condor.committed, 2);
    assert.equal(rec.condor.graded, 2);
    assert.equal(rec.condor.wins, 1);
    assert.equal(rec.condor.breach_losses, 1);
    assert.equal(rec.condor.win_rate_pct, 50);
    assert.equal(rec.condor.breach_rate_pct, 50);
  });

test("buildZeroDteRecord: an all-directional window reports an empty condor lane with no live record", () => {
    const rec = buildZeroDteRecord(
      [row({ ticker: "SPY", plan_outcome: "doubled", plan_pnl_pct: 80 })],
      { since: "2026-07-01", through: "2026-07-13", days: 13 },
    );
    assert.equal(rec.total_flagged, 1, "the directional numbers are untouched by the condor lane");
    assert.equal(rec.condor.committed, 0);
    assert.equal(rec.condor.no_live_record, true);
  });
