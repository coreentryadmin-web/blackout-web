import { test } from "node:test";
import assert from "node:assert/strict";

// record.ts is a pure-aggregation leaf (its only @/lib/db import is type-only,
// erased at runtime; ./plan's etMinutesOf is dependency-free) — no mocks needed.
import type { ZeroDteSetupLogRow } from "@/lib/db";
import {
  asManagedPnlPct,
  buildZeroDteRecord,
  extractMaxFavorablePct,
  isGradedZeroDteRow,
  isZeroDteWin,
  LOW_N_THRESHOLD,
  officialPlanPnlPct,
  readManagedExit,
  scoreBand,
  scoreForBanding,
  todBucket,
  ZERODTE_RECORD_METHODOLOGY,
} from "./record";
import { tierFromEntryContext } from "./tiers";

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

// ── conviction:null for BREAKOUT/PIN origins — RED→GREEN for the 2026-09-09 fix ─────────
// Root cause: board.ts's enrichSetup(setup, dossier) always resolves `conviction` from
// `dossier?.scored?.conviction`, and breakout-source.ts/pin-source.ts both call it with a
// hardcoded `null` dossier (no options-flow evidence exists to score for a bare price/volume
// breakout or a GEX pin) — so the DB `conviction` column is null for every BREAKOUT/PIN
// commit, forever, regardless of how strong the play was. Measured live 2026-09-09:
// GET /api/market/zerodte/record?days=14 showed 36/57 (63.2%) committed plays with
// conviction:null, essentially all BREAKOUT-origin, vs 18/18 FLOW-origin plays with a real
// letter. Fix: toPlay() falls back to the PR-F merit tier (tierFromEntryContext, the same
// origin-agnostic adapter the `tier` field already uses) instead of passing the null column
// straight through — a real signal, not a fabricated one.
test("toPlay: a null DB conviction (BREAKOUT/PIN, no dossier) falls back to the merit tier, not a bare null", () => {
  // Same shape a real BREAKOUT/PIN commit pins (buildZeroDteEntryContext runs unconditionally
  // on every origin) — prime score band + calm VIX + clean Cortex + midday commit → tier A,
  // the exact PINNED_FULL fixture tiers.test.ts already proves resolves to "A".
  const entryContext = {
    vix_open: 16.2,
    spy_bias: "up",
    score: 78,
    committed_at_et: "2026-07-10 12:10 ET",
    discovery_origin: ["BREAKOUT"],
    cortex: {
      abstained: false,
      score: 1.85,
      vetoes: [],
      supports: [{ source: "positioning" }, { source: "flow" }],
      absent: [],
    },
  };
  // Independently confirm what tier this blob resolves to, rather than hardcoding "A" twice —
  // a change to tiers.ts's bands would then fail this assertion instead of silently drifting.
  const expectedTier = tierFromEntryContext(entryContext)?.tier;
  assert.equal(expectedTier, "A");

  const rec = buildZeroDteRecord(
    [row({ ticker: "BRKO", conviction: null, entry_context: entryContext })],
    WINDOW
  );
  const play = rec.plays[0]!;
  assert.equal(play.conviction, "A", "null DB conviction must fall back to the real merit tier, not stay null");
  assert.equal(play.tier, "A", "conviction's fallback must agree with the independently-rendered tier field");
});

test("toPlay: a real dossier conviction (FLOW origin) is NEVER overridden by the merit tier", () => {
  // Same entry_context as above (would tier "A"), but the DB column already carries the
  // dossier-scored FLOW letter — that letter is the more specific signal and must win.
  const entryContext = {
    vix_open: 16.2,
    score: 78,
    committed_at_et: "2026-07-10 12:10 ET",
    cortex: { abstained: false, score: 1.85, vetoes: [], supports: [{ source: "positioning" }, { source: "flow" }], absent: [] },
  };
  const rec = buildZeroDteRecord(
    [row({ ticker: "FLOWX", conviction: "B", entry_context: entryContext })],
    WINDOW
  );
  assert.equal(rec.plays[0]!.conviction, "B");
});

// ── Fix (2026-10-26): historical pre-2026-10-06 rows still leaked the raw unrounded
// tranche_fraction float through the READ path (follow-up to the 2026-10-06 write-time fix
// in strategy-version.ts's buildResolvedExitPolicy) ───────────────────────────────────────
test("toPlay: a historical row's frozen exit_policy_snapshot.trailing_rule (pre-2026-10-06, raw unrounded float) is rounded for display WITHOUT touching config_hash", () => {
  // This is byte-for-byte what a row committed BEFORE 2026-10-06 froze into
  // entry_context.exit_policy_snapshot at commit time (scan.ts) — immutable, never rebuilt —
  // carrying the exact raw 16-digit IEEE-754 float the 2026-10-06 fix found
  // (tranche_fraction=0.3333333333333333). config_hash here is an arbitrary but REALISTIC
  // frozen fingerprint; the test's whole point is that this exact string must survive
  // byte-identical through the read path no matter what display fix runs alongside it.
  const staleSnapshot = {
    policy: "trim_scale",
    version: "ws02-v1",
    hard_stop_pct: -50,
    target_pct: 100,
    trim_levels: [
      { trigger_pct: 25, fraction: 0.3333333333333333 },
      { trigger_pct: 50, fraction: 0.3333333333333333 },
    ],
    runner_fraction: 0.3333333333333333,
    trailing_rule:
      "trim_scale:no_trailing_stop;active_regime=neutral;tranche_fraction=0.3333333333333333;" +
      "tranches trend=[25,50] neutral=[25,50] range=[25,50]",
    time_stop_et: "15:50",
    collision_rule: "stop_before_target_same_bar",
    config_hash: "exitcfg-deadbeef12",
  };
  const entryContext = {
    score: 70,
    exit_policy_at_commit: "trim_scale",
    exit_policy_snapshot: staleSnapshot,
  };

  const rec = buildZeroDteRecord(
    [row({ ticker: "STALEHIST", entry_context: entryContext })],
    WINDOW
  );
  const play = rec.plays[0]!;
  const servedSnapshot = (play.entry_context as Record<string, unknown>)
    .exit_policy_snapshot as Record<string, unknown>;

  assert.equal(
    servedSnapshot.trailing_rule,
    "trim_scale:no_trailing_stop;active_regime=neutral;tranche_fraction=0.33;" +
      "tranches trend=[25,50] neutral=[25,50] range=[25,50]",
    "the served display copy must round tranche_fraction to 2dp, same as a fresh commit"
  );
  // THE critical invariant: config_hash fingerprints the calibration cohort — a display-only
  // read-time fix must never move it, or a historical row would silently fork into a
  // different cohort than the one it actually graded under.
  assert.equal(
    servedSnapshot.config_hash,
    staleSnapshot.config_hash,
    "config_hash must be byte-identical to the frozen fixture value — this fix is display-only"
  );
  // And the original fixture object itself must be untouched (no in-place mutation of the
  // row's own entry_context — a sibling consumer of the SAME row object must never see this
  // read path's rounding bleed into its own, unrelated read).
  assert.equal(
    staleSnapshot.trailing_rule,
    "trim_scale:no_trailing_stop;active_regime=neutral;tranche_fraction=0.3333333333333333;" +
      "tranches trend=[25,50] neutral=[25,50] range=[25,50]",
    "the original fixture's trailing_rule must be unmutated"
  );
});

test("toPlay: a row with genuinely no pinned evidence stays honestly null (never fabricated)", () => {
  const rec = buildZeroDteRecord(
    [row({ ticker: "PRECTX", conviction: null, entry_context: null })],
    WINDOW
  );
  assert.equal(rec.plays[0]!.conviction, null);
  assert.equal(rec.plays[0]!.tier, null);
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

test("managedOutcomeLabel: a real trim_scale_runner_target exit (no reconstruction) buckets as 'doubled', not 'ratchet'", () => {
  // trim_scale_runner_target fires when BOTH tranches are already banked and the LAST third
  // also tags the plan target (exit-engine.ts decideTrimScale, action EXIT reason
  // "trim_scale_runner_target") — the trim-scale-mode analogue of ratchet mode's
  // "plan_target_final" ("doubled"): the position captured its full bullish target, just via
  // banked tranches instead of one lump. The OLD code bucketed it under "ratchet" purely
  // because its own ad hoc /ratchet|runner/ regex substring-matched "runner" inside
  // "trim_scale_runner_target" — conflating a profit-TARGET hit with a defensive ratchet
  // FLOOR exit, two economically different outcome shapes the by_outcome breakdown exists
  // specifically to keep apart (see BUCKET_ORDER's own doc comment). Reachable live any time
  // a trim_scale row's WS-11 reconstruction is absent/degenerate (readReconstructedTrimScale
  // returns null, or reconstructionShowsGenuinePartialBank is false) so managedGradeView falls
  // through to the real engine exit stamp instead of the reconstruction.
  const r = withExit(
    { ticker: "AAPL", plan_outcome: "time_stop", plan_pnl_pct: 60 },
    { reason: "trim_scale_runner_target", pnl_pct: 60 }
  );
  const rec = buildZeroDteRecord([r], WINDOW);
  assert.equal(rec.plays[0]!.managed_source, "engine");
  assert.equal(rec.plays[0]!.managed_outcome, "doubled");
  assert.equal(rec.wins, 1);
});

test("managedOutcomeLabel: a real trim_scale_dead_zone_floor exit (no reconstruction) buckets as 'ratchet', not a bare win/loss/breakeven sign", () => {
  // trim_scale_dead_zone_floor is the trim-scale-mode protective floor for the regime-
  // conditioned dead zone (exit-engine.ts's decideTrimScale, floored at HALF the peak when no
  // tranche has armed yet) — the trim-scale analogue of ratchet mode's
  // "ratchet_breakeven_floor"/"ratchet_early_profit_floor"/"ratchet_profit_floor" (all bucket
  // "ratchet"). The OLD code's ad hoc /ratchet|runner/ regex does not match this exact string
  // at all (no "ratchet" or "runner" substring), so it silently fell through to the bare
  // win/loss/breakeven-by-sign label instead of the named "ratchet" bucket every other
  // protective-floor exit gets — the ONE real EXIT reason exit-engine.ts can stamp that this
  // record.ts label function had no case for at all.
  const r = withExit(
    { ticker: "META", plan_outcome: "time_stop", plan_pnl_pct: 30 },
    { reason: "trim_scale_dead_zone_floor", pnl_pct: 5 }
  );
  const rec = buildZeroDteRecord([r], WINDOW);
  assert.equal(rec.plays[0]!.managed_source, "engine");
  assert.equal(rec.plays[0]!.managed_outcome, "ratchet");
  assert.equal(rec.wins, 1);
});

test("managedOutcomeLabel: a plan_stop reason with a POSITIVE pnl buckets by sign, not 'stopped' (frozen pre-existing-bug data, live 2026-11-01)", () => {
  // plan_stop (exit-engine.ts) only ever fires when the mark has fallen to/below the fixed
  // -50% plan stop — a positive pnl under this reason is impossible for a genuine stop-out.
  // Live 2026-11-01: a real META row from 2026-08-03 carries managed_pnl_pct=+3.41 with
  // managed_outcome="stopped" — the exact entryBasisDiverged-era contradiction this module's
  // own history already names (fixed going forward, 2026-08-06, but this frozen row predates
  // it and is never rebuilt). Read-time reconciliation prevents a future read from rendering
  // a self-contradictory label/bucket, without touching the frozen entry_context.exit data.
  const r = withExit(
    { ticker: "META", plan_outcome: "stopped", plan_pnl_pct: -50 },
    { reason: "plan_stop", pnl_pct: 3.41 }
  );
  const rec = buildZeroDteRecord([r], WINDOW);
  assert.equal(rec.plays[0]!.managed_outcome, "win");
  assert.equal(rec.wins, 1);
  assert.equal(rec.losses, 0);
});

test("managedOutcomeLabel: a genuine plan_stop loss still buckets as 'stopped'", () => {
  const r = withExit(
    { ticker: "AMD", plan_outcome: "stopped", plan_pnl_pct: -50 },
    { reason: "plan_stop", pnl_pct: -48.2 }
  );
  const rec = buildZeroDteRecord([r], WINDOW);
  assert.equal(rec.plays[0]!.managed_outcome, "stopped");
  assert.equal(rec.losses, 1);
});

test("managedOutcomeLabel: a target reason with a NON-POSITIVE pnl buckets by sign, not 'doubled'", () => {
  // plan_target*/trim_scale* are exclusively profit-taking exits — the symmetric contradiction
  // to the plan_stop case above.
  const r = withExit(
    { ticker: "NVDA", plan_outcome: "time_stop", plan_pnl_pct: 100 },
    { reason: "plan_target_final", pnl_pct: -1.2 }
  );
  const rec = buildZeroDteRecord([r], WINDOW);
  assert.equal(rec.plays[0]!.managed_outcome, "loss");
  assert.equal(rec.losses, 1);
  assert.equal(rec.wins, 0);
});

test("managedOutcomeLabel: a genuine target win still buckets as 'doubled'", () => {
  const r = withExit(
    { ticker: "TSLA", plan_outcome: "time_stop", plan_pnl_pct: 100 },
    { reason: "plan_target_final", pnl_pct: 103.5 }
  );
  const rec = buildZeroDteRecord([r], WINDOW);
  assert.equal(rec.plays[0]!.managed_outcome, "doubled");
  assert.equal(rec.wins, 1);
});

// ── FINDINGS 2026-11-01: the SAME sign contradiction, but through the RECONSTRUCTED (WS-11)
// path, not managedOutcomeLabel/the live engine exit — #7133 fixed only the latter. ───────────
test("reconstructedOutcomeLabel: a WS-11 trim-scale reconstruction with a POSITIVE blended pnl buckets by sign, not 'stopped' — live META 2026-08-03 evidence, bypasses #7133", () => {
  // Live GET /api/market/zerodte/record?days=90 (2026-11-01), play index 588: META,
  // session_date 2026-08-03, managed_source:"reconstructed" (entry_context carries NO
  // top-level `exit` key at all — readManagedExit returns null, so managedOutcomeLabel is
  // NEVER invoked for this row; #7133's sign guard lives entirely inside that function and
  // cannot reach this path). Two early trims banked large gains; the final tranche hit the
  // hard stop — but the BLENDED pnl across all three legs is still positive, while the
  // reconstruction's own `outcome` is the runner (final leg)'s bare reason, "stopped".
  const tranches = [
    { tranche: 1, fraction: 1 / 3, exit_pnl_pct: 19.32, exit_reason: "trim_scale_first", at_et: "10:05" },
    { tranche: 2, fraction: 1 / 3, exit_pnl_pct: 43.18, exit_reason: "trim_scale_second", at_et: "10:12" },
    { tranche: 3, fraction: 1 / 3, exit_pnl_pct: -52.27, exit_reason: "stopped", at_et: "11:40" },
  ];
  const r = withReconstruction(
    { ticker: "META", plan_outcome: "stopped", plan_pnl_pct: -50 },
    { plan_outcome: "stopped", plan_pnl_pct: 3.41, tranches }
  );
  // Blend check: (19.32 + 43.18 - 52.27) / 3 == 3.41666... -> rounds to 3.42, but the
  // frozen blob already carries the grader's own rounded 3.41 (round2 applied once, at
  // write time) — read verbatim, never re-derived here.
  assert.equal(officialPlanPnlPct(r), 3.41);
  assert.equal(asManagedPnlPct(r), 3.41);
  const rec = buildZeroDteRecord([r], WINDOW);
  const play = rec.plays[0]!;
  assert.equal(play.managed_source, "reconstructed");
  assert.equal(play.managed_pnl_pct, 3.41, "a real, positive blended win");
  // THE BUG: pre-fix this asserted "stopped" (the runner-leg label, sign-contradicting its
  // own positive pnl) — post-fix it falls back to the bare sign label, matching
  // managedOutcomeLabel's own "stop"/"target" sign-guard discipline (#7133).
  assert.equal(play.managed_outcome, "win", "a positive blended reconstruction must never render under the loss-implying 'stopped' label");
  assert.equal(play.plan_outcome, "win", "the OFFICIAL lane (calibration/feature-store/Largo) must agree with the as-managed headline");
  assert.equal(rec.wins, 1);
  assert.equal(rec.losses, 0);
  // The by_outcome bucket that used to silently carry a contradictory win: "stopped" must
  // now have NO rows at all for this single-row record, and "win" must carry it instead.
  const stoppedBucket = rec.by_outcome.find((b) => b.label === "stopped");
  assert.equal(stoppedBucket, undefined, "the loss-implying bucket must not carry this real win");
  const winBucket = rec.by_outcome.find((b) => b.label === "win");
  assert.ok(winBucket, "the sign-correct bucket must carry it instead");
  assert.equal(winBucket!.wins, 1);
});

test("reconstructedOutcomeLabel: a WS-11 reconstruction with a NON-POSITIVE blended pnl still buckets as 'stopped' (no regression)", () => {
  // Symmetric control: when the runner's reason and the blended sign actually agree (a
  // genuine stop-out), the label must be unchanged.
  const tranches = [
    { tranche: 1, fraction: 1 / 3, exit_pnl_pct: 5.0, exit_reason: "trim_scale_first", at_et: "10:05" },
    { tranche: 2, fraction: 2 / 3, exit_pnl_pct: -52.27, exit_reason: "stopped", at_et: "11:40" },
  ];
  const r = withReconstruction(
    { ticker: "COIN", plan_outcome: "stopped", plan_pnl_pct: -50 },
    { plan_outcome: "stopped", plan_pnl_pct: -33.18, tranches }
  );
  const rec = buildZeroDteRecord([r], WINDOW);
  assert.equal(rec.plays[0]!.managed_outcome, "stopped");
  assert.equal(rec.plays[0]!.plan_outcome, "stopped");
  assert.equal(rec.losses, 1);
  assert.equal(rec.wins, 0);
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

// ════════════════════════════════════════════════════════════════════════════════════
// max_favorable_pct / extractMaxFavorablePct — reporting that separates REALIZED exits
// from MAXIMUM FAVORABLE EXCURSION (member audit directive, point 6 of the original brief:
// "separate realized exits from maximum potential gains").
// ════════════════════════════════════════════════════════════════════════════════════

test("readManagedExit: carries peak_pnl_pct alongside pnl_pct/reason when the row has a real exit stamp", () => {
  const exit = readManagedExit({ exit: { reason: "thesis_break:gex-walls", pnl_pct: -22.57, peak_pnl_pct: 0 } });
  assert.deepEqual(exit, { reason: "thesis_break:gex-walls", pnl_pct: -22.57, peak_pnl_pct: 0 });
});

test("readManagedExit: a non-finite/missing peak_pnl_pct reads null, never fabricated", () => {
  assert.equal(readManagedExit({ exit: { reason: "plan_stop", pnl_pct: -50 } })?.peak_pnl_pct, null);
  assert.equal(readManagedExit({ exit: { reason: "plan_stop", pnl_pct: -50, peak_pnl_pct: "NaN" } })?.peak_pnl_pct, null);
});

test("extractMaxFavorablePct: reads the real peak off a live-managed exit stamp", () => {
  assert.equal(extractMaxFavorablePct({ exit: { reason: "ratchet_profit_floor", pnl_pct: 34.54, peak_pnl_pct: 86.27 } }), 86.27);
});

test("extractMaxFavorablePct: null when the row never carried a live-managed exit at all (absence, not zero)", () => {
  assert.equal(extractMaxFavorablePct(null), null);
  assert.equal(extractMaxFavorablePct({}), null);
  assert.equal(extractMaxFavorablePct({ exit: "not-an-object" }), null);
});

test("buildZeroDteRecord: a play's max_favorable_pct is reported SEPARATELY from managed_pnl_pct, never conflated", () => {
  // The real TSLA 2026-10-19 shape investigated this session: peak_pnl_pct=0 ("never moved
  // favorably") alongside a -22.57% realized exit -- both numbers are real and must both survive
  // to the public record, not be collapsed into one.
  const rec = buildZeroDteRecord(
    [
      row({
        ticker: "TSLA",
        plan_outcome: "stopped",
        plan_pnl_pct: -22.57,
        entry_context: {
          exit: { reason: "thesis_break:gex-walls", pnl_pct: -22.57, peak_pnl_pct: 0 },
        } as unknown as ZeroDteSetupLogRow["entry_context"],
      }),
    ],
    { since: "2026-10-19", through: "2026-10-19", days: 1 },
  );
  const play = rec.plays.find((p) => p.ticker === "TSLA");
  assert.ok(play);
  assert.equal(play!.max_favorable_pct, 0);
  assert.equal(play!.managed_pnl_pct, -22.57);
});

test("buildZeroDteRecord: max_favorable_pct is null (not 0) for a row with no live-managed exit stamp", () => {
  const rec = buildZeroDteRecord(
    [row({ ticker: "NVDA", plan_outcome: "stopped", plan_pnl_pct: -50, entry_context: null })],
    { since: "2026-07-13", through: "2026-07-13", days: 1 },
  );
  const play = rec.plays.find((p) => p.ticker === "NVDA");
  assert.ok(play);
  assert.equal(play!.max_favorable_pct, null);
});

// ── FINDINGS 2026-10-31: managed_pnl_pct must never display as exceeding its own peak ──
// A live audit of GET /api/market/zerodte/record?days=90 found 7 real rows where the
// as-managed headline read BETTER than the position's own recorded maximum favorable
// excursion -- a mathematical impossibility (see clampManagedPnlToPeak's doc). Every one
// of the 7 was a frozen pre-2026-09-04 cent-rounding artifact (exit-engine.ts's
// buildExitContext, commit f42a3892b/#3445); this reproduces the exact shape (NVDA
// 2026-08-28: managed 0 vs peak -1.14) off a bare fixture, not live data, so the test
// stays meaningful even after that row ages out of any live 90-day window.

test("buildZeroDteRecord: a frozen pre-2026-09-04 exit stamp whose pnl_pct exceeds its own peak_pnl_pct is clamped to the peak (NVDA 2026-08-28 repro)", () => {
  const rec = buildZeroDteRecord(
    [
      withExit(
        { ticker: "NVDA", session_date: "2026-08-28", plan_outcome: "stopped", plan_pnl_pct: -50 },
        { reason: "plan_stop", pnl_pct: 0, peak_pnl_pct: -1.14 } as unknown as { reason: string; pnl_pct: number }
      ),
    ],
    { since: "2026-08-28", through: "2026-08-28", days: 1 },
  );
  const play = rec.plays.find((p) => p.ticker === "NVDA");
  assert.ok(play);
  // The peak (reliable — the 09-04 bug never touched peak_pnl_pct's own formula) is
  // reported unchanged; the realized number is capped to agree with it, never left to
  // claim a better outcome than the row's own documented best moment.
  assert.equal(play!.max_favorable_pct, -1.14);
  assert.equal(play!.managed_pnl_pct, -1.14, "managed_pnl_pct must never exceed max_favorable_pct");
  assert.equal(play!.managed_source, "engine");
  assert.equal(rec.wins, 0);
  assert.equal(rec.losses, 1, "a clamped-negative exit must book as a loss, not the pre-clamp breakeven");
  assert.equal(rec.avg_pnl_pct, -1.14);
});

test("buildZeroDteRecord: the same clamp caps a POSITIVE frozen pnl_pct to its own peak too (HIMS 2026-08-19 repro) — still a win, just not an impossible one", () => {
  const rec = buildZeroDteRecord(
    [
      withExit(
        { ticker: "HIMS", session_date: "2026-08-19", plan_outcome: "doubled", plan_pnl_pct: 100 },
        { reason: "ratchet_profit_floor", pnl_pct: 5.68, peak_pnl_pct: 5.11 } as unknown as {
          reason: string;
          pnl_pct: number;
        }
      ),
    ],
    { since: "2026-08-19", through: "2026-08-19", days: 1 },
  );
  const play = rec.plays.find((p) => p.ticker === "HIMS");
  assert.ok(play);
  assert.equal(play!.max_favorable_pct, 5.11);
  assert.equal(play!.managed_pnl_pct, 5.11);
  assert.equal(rec.wins, 1, "still a real win — clamping only removes the impossible excess, not the win itself");
  assert.equal(rec.avg_pnl_pct, 5.11);
});

test("buildZeroDteRecord: the clamp is a no-op when pnl_pct already sits at or below its own peak (the correct, post-fix and honored-floor shape)", () => {
  // Same TSLA shape as the "reported SEPARATELY" test above (peak=0, realized=-22.57) plus
  // a second, POSITIVE-peak row (ratchet-floor exit at +22.5%, peak +30% — the ordinary
  // "closed off the all-time high" shape) — neither should move under the clamp.
  const rec = buildZeroDteRecord(
    [
      withExit(
        { ticker: "TSLA", session_date: "2026-10-19", plan_outcome: "stopped", plan_pnl_pct: -22.57 },
        { reason: "thesis_break:gex-walls", pnl_pct: -22.57, peak_pnl_pct: 0 } as unknown as {
          reason: string;
          pnl_pct: number;
        }
      ),
      withExit(
        { ticker: "AMZN", session_date: "2026-10-19", plan_outcome: "stopped", plan_pnl_pct: -50 },
        { reason: "ratchet_profit_floor", pnl_pct: 22.5, peak_pnl_pct: 30 } as unknown as {
          reason: string;
          pnl_pct: number;
        }
      ),
    ],
    { since: "2026-10-19", through: "2026-10-19", days: 1 },
  );
  const tsla = rec.plays.find((p) => p.ticker === "TSLA");
  const amzn = rec.plays.find((p) => p.ticker === "AMZN");
  assert.equal(tsla!.managed_pnl_pct, -22.57);
  assert.equal(amzn!.managed_pnl_pct, 22.5);
});

// ── FINDINGS 2026-11-01: officialOverridingRealExit (the calibration/feature-store/Largo lane)
// must apply the SAME peak clamp managedGradeView() already does (clampManagedPnlToPeak,
// 2026-10-31) to the IDENTICAL frozen entry_context.exit blob, on the same rows — otherwise the
// two "official" numbers for one position disagree, and plan_pnl_pct (the number calibration/
// feature-store/Largo's get_zerodte_record read, per the module comment near line 193) can read
// as BETTER than the position's own highest-ever recorded excursion, which is impossible. Live
// audit (GET /api/market/zerodte/record?days=90, 2026-11-01) found 8 real violating rows; 5 of
// them (HIMS/KORU/SPCH/RIOT/FIG) are the EXACT rows the 2026-10-31 fix already named as fixed for
// managed_pnl_pct — proving that fix's blast radius never reached this sibling lane.

test("FINDINGS 2026-11-01: officialPlanPnlPct clamps a real-exit-outranking-a-GENUINE-reconstruction row to its own peak (HIMS 2026-08-19 live-shape repro)", () => {
  // Live shape: HIMS 2026-08-19 — a GENUINE (2-tranche) reconstruction exists, but a real,
  // live-only ratchet-floor exit outranks it (officialOverridingRealExit's own precedence,
  // identical to managedGradeView's) — and that real exit's raw pnl_pct (5.68) sits ABOVE its
  // own recorded peak (5.11), the exact frozen pre-2026-09-04 cent-rounding artifact
  // clampManagedPnlToPeak's doc describes. Before this fix, officialPlanPnlPct returned the raw
  // 5.68 while the sibling asManagedPnlPct (already fixed 2026-10-31) returned the clamped
  // 5.11 — the two "official" numbers for the SAME position disagreed.
  const r = row({
    ticker: "HIMS",
    session_date: "2026-08-19",
    plan_outcome: "time_stop",
    plan_pnl_pct: 40,
    entry_context: {
      exit: { reason: "ratchet_profit_floor", pnl_pct: 5.68, peak_pnl_pct: 5.11 },
      executable: {
        lane: "conservative",
        exit_policy: "trim_scale",
        plan_outcome: "time_stop",
        plan_pnl_pct: 25.61,
        tranches: [
          { tranche: 1, fraction: 1 / 2, exit_pnl_pct: 10.0, exit_reason: "trim_scale_first", at_et: "10:00" },
          { tranche: 2, fraction: 1 / 2, exit_pnl_pct: 41.22, exit_reason: "time_stop", at_et: "15:15" },
        ],
      },
    },
  });
  assert.equal(officialPlanPnlPct(r), 5.11, "plan_pnl_pct must never exceed the row's own peak_pnl_pct");
  assert.equal(asManagedPnlPct(r), 5.11, "the sibling as-managed lane was already clamped 2026-10-31");
  assert.equal(
    officialPlanPnlPct(r),
    asManagedPnlPct(r),
    "the calibration/feature-store/Largo number and the member-facing number must agree for the same frozen exit"
  );

  const rec = buildZeroDteRecord([r], { since: "2026-08-19", through: "2026-08-19", days: 1 });
  const play = rec.plays[0]!;
  assert.equal(play.plan_pnl_pct, 5.11);
  assert.equal(play.managed_pnl_pct, 5.11);
  assert.equal(play.max_favorable_pct, 5.11);
});

test("FINDINGS 2026-11-01: officialPlanPnlPct is unaffected when the real exit already sits within its own peak (no regression)", () => {
  // Same APLD-shaped real-thesis-break-outranks-a-GENUINE-reconstruction case this module's own
  // 2026-08-27 fix covers, now carrying a peak (25.0) comfortably ABOVE the real exit's pnl
  // (19.0) — the ordinary, correct shape every post-2026-09-04 fresh exit produces. The clamp
  // must be a provable no-op here, exactly like clampManagedPnlToPeak's own doc promises.
  const r = row({
    ticker: "APLD",
    plan_outcome: "time_stop",
    plan_pnl_pct: -0.98,
    entry_context: {
      exit: { reason: "thesis_break:gex-walls", pnl_pct: 19.0, peak_pnl_pct: 25.0 },
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
  assert.equal(officialPlanPnlPct(r), 19.0, "pnl already sits below its own peak — the clamp must not move it");
  assert.equal(asManagedPnlPct(r), 19.0);
  assert.equal(isZeroDteWin(r), true, "a correctly-unclamped real win must still grade as a win");
});

test("FINDINGS 2026-11-01: plan_pnl_pct and managed_pnl_pct agree on a negative-peak override row too (CRCL 2026-09-03 live-shape repro)", () => {
  // CRCL 2026-09-03 live shape: a position that never moved favorably (peak -0.22) whose real
  // exit's raw pnl_pct (0) would otherwise read as a false breakeven instead of its own honest
  // small loss — the negative-peak analogue of the HIMS repro above, and the sign this bug's
  // clamp must handle correctly (peak itself negative, not just smaller than a positive pnl).
  const crcl = row({
    ticker: "CRCL",
    session_date: "2026-09-03",
    plan_outcome: "time_stop",
    plan_pnl_pct: 40,
    entry_context: {
      exit: { reason: "flat_theta_bleed", pnl_pct: 0, peak_pnl_pct: -0.22 },
      executable: {
        lane: "conservative",
        exit_policy: "trim_scale",
        plan_outcome: "time_stop",
        plan_pnl_pct: 27.07,
        tranches: [
          { tranche: 1, fraction: 1 / 2, exit_pnl_pct: 20.0, exit_reason: "trim_scale_first", at_et: "10:00" },
          { tranche: 2, fraction: 1 / 2, exit_pnl_pct: 34.14, exit_reason: "time_stop", at_et: "15:15" },
        ],
      },
    },
  });
  const rec = buildZeroDteRecord([crcl], { since: "2026-09-03", through: "2026-09-03", days: 1 });
  const play = rec.plays[0]!;
  assert.equal(
    play.plan_pnl_pct,
    play.managed_pnl_pct,
    "the two official lanes must never disagree for the same frozen exit"
  );
  assert.equal(play.plan_pnl_pct, -0.22);
  assert.equal(play.managed_pnl_pct, -0.22);
  assert.equal(officialPlanPnlPct(crcl), asManagedPnlPct(crcl));
  assert.equal(rec.losses, 1, "a clamped-negative override must book as a loss, not the pre-clamp breakeven");
});
