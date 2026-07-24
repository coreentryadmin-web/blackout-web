import { test } from "node:test";
import assert from "node:assert/strict";

// record.ts is a pure-aggregation leaf (its only @/lib/db import is type-only,
// erased at runtime; ./plan's etMinutesOf is dependency-free) — no mocks needed.
import type { ZeroDteSetupLogRow } from "@/lib/db";
import {
  buildZeroDteRecord,
  isGradedZeroDteRow,
  isZeroDteWin,
  LOW_N_THRESHOLD,
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
